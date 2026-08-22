// Vercel Cron hits this on a schedule (see vercel.json). It:
//   1. Loops over every active marketplace_credentials row
//   2. Fetches new orders since that store's last_synced_at watermark
//   3. Inserts each one through the SAME createOrderCore() used by manual
//      entry and CSV bulk-upload — so ref_no reservation, duplicate-buyer
//      detection, and currency conversion all behave identically
//   4. Skips anything whose marketplace_order_no already exists (idempotent
//      — safe to re-run, safe if a run overlaps the next one)
//   5. Logs every run to marketplace_sync_log, success or failure
//
// SECURITY: only callable with the correct bearer token — Vercel Cron
// sends `Authorization: Bearer $CRON_SECRET` automatically when CRON_SECRET
// is set as both a Vercel env var and referenced in vercel.json. Anyone
// else calling this URL without the token gets 401.

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { createOrderCore } from "@/app/dashboard/orders/new/actions";
import { decryptSecret } from "@/lib/crypto/secret-box";
import { WooCommerceConnector } from "@/lib/connectors/woocommerce";
import type { MarketplaceConnector, NormalizedOrder } from "@/lib/connectors/types";
import type { AuthedEmployee } from "@/lib/auth/require-capability";

export const maxDuration = 60; // seconds — Hobby plan's hard cap; Vercel rejects the whole deployment if this exceeds the plan limit (see vercel.json's cron-frequency note for the same class of bug)

function buildConnector(
  provider: string,
  apiKey: string,
  apiSecret: string | null,
  extraConfig: Record<string, unknown>
): MarketplaceConnector {
  switch (provider) {
    case "woocommerce":
      return new WooCommerceConnector(String(extraConfig.storeUrl ?? ""), apiKey, apiSecret ?? "");
    // TODO: add as each marketplace is wired up. Same pattern each time —
    // one new file in src/lib/connectors/, one new case here.
    // case "amazon":  return new AmazonSpApiConnector(...)
    // case "etsy":    return new EtsyConnector(...)
    // case "ebay":    return new EbayConnector(...)
    // case "walmart": return new WalmartConnector(...)
    default:
      throw new Error(`No connector implemented yet for provider "${provider}"`);
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const summary: Array<{ storeId: string; created: number; skipped: number; error?: string }> = [];

  const { data: credentials, error: credError } = await supabase
    .from("marketplace_credentials")
    .select("id, store_id, provider, api_key_enc, api_secret_enc, extra_config, last_synced_at, stores(company_id)")
    .eq("is_active", true);

  if (credError) {
    return NextResponse.json({ error: credError.message }, { status: 500 });
  }

  for (const cred of credentials ?? []) {
    const { data: logRow } = await supabase
      .from("marketplace_sync_log")
      .insert({ store_id: cred.store_id, status: "RUNNING" })
      .select("id")
      .single();

    let created = 0;
    let skipped = 0;
    let fetched = 0;

    try {
      const apiKey = decryptSecret(cred.api_key_enc as unknown as Buffer);
      const apiSecret = cred.api_secret_enc ? decryptSecret(cred.api_secret_enc as unknown as Buffer) : null;
      const connector = buildConnector(cred.provider, apiKey, apiSecret, cred.extra_config as Record<string, unknown>);

      // First-ever sync for a store: default to 24h back, not "all time" —
      // avoids accidentally bulk-importing years of historical orders the
      // first time a connector is switched on.
      const since = cred.last_synced_at ? new Date(cred.last_synced_at) : new Date(Date.now() - 24 * 60 * 60 * 1000);

      const orders: NormalizedOrder[] = await connector.fetchNewOrders(since);
      fetched = orders.length;

      // companyId comes from the store's own company — every store belongs
      // to exactly one company (see db/schema.sql stores.company_id).
      const companyId = (cred as unknown as { stores: { company_id: string } }).stores.company_id;

      // Minimal stub AuthedEmployee — createOrderCore only reads `.id` off
      // this (see actions.ts), used for orders.entry_by_employee_id.
      // SETUP REQUIRED: create one real employee row per company named
      // e.g. "System / API Sync" (active=false so it can't log in) and put
      // its id in SYSTEM_SYNC_EMPLOYEE_ID below, or look it up here by a
      // fixed employee_code — either works, just don't leave this as a
      // fake uuid that violates the FK.
      const systemEmployee = { id: process.env.SYSTEM_SYNC_EMPLOYEE_ID! } as AuthedEmployee;

      for (const o of orders) {
        const { data: existing } = await supabase
          .from("orders")
          .select("id")
          .eq("company_id", companyId)
          .eq("marketplace_order_no", o.marketplaceOrderNo)
          .maybeSingle();

        if (existing) {
          skipped += 1;
          continue;
        }

        const result = await createOrderCore(systemEmployee, supabase, companyId, {
          storeId: cred.store_id,
          orderDate: o.orderDate,
          marketplaceOrderNo: o.marketplaceOrderNo,
          buyerNameAddress: o.buyerNameAddress,
          contactNo: o.contactNo,
          manualRefNo: null,
          poDate: null,
          deliveryDate: null,
          emailId: o.emailId,
          taxId: null,
          addressType: o.addressType,
          // 2026-08-11 additions — no reliable source from most marketplace
          // sync APIs either; left null, same as taxId above. Fillable
          // later via the order edit panel if needed.
          vatNumber: null,
          eoriNumber: null,
          iossNumber: null,
          destinationCountry: null,
          vendorPartyId: null, // no reliable source from marketplace sync — fillable later via the order edit panel, see Gap 2 note in new/actions.ts.
          remark: "Auto-imported by marketplace sync",
          items: [
            {
              // NOTE: item_category_id has no reliable source from most
              // marketplace APIs — this needs a real default per store
              // (or a SKU->category lookup table) before going live.
              // Leaving unset here will fail the NOT NULL constraint on
              // purpose, so this gets caught in testing rather than
              // silently mis-categorizing real orders.
              itemCategoryId: String(
                (cred.extra_config as Record<string, unknown> | null)?.["defaultItemCategoryId"] ?? ""
              ),
              skuLabel: o.skuLabel,
              sizeLabel: null,
              qty: o.qty,
              colour: null,
              photoType: null,
              photoUrl: null,
              tasselFringes: false,
              orderCurrency: o.orderCurrency,
              orderValueOriginal: o.orderValueOriginal,
            },
          ],
        });

        if (result.error) {
          skipped += 1;
        } else {
          created += 1;
        }
      }

      await supabase
        .from("marketplace_credentials")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("id", cred.id);

      if (logRow) {
        await supabase
          .from("marketplace_sync_log")
          .update({ finished_at: new Date().toISOString(), orders_fetched: fetched, orders_created: created, orders_skipped_dup: skipped, status: "SUCCESS" })
          .eq("id", logRow.id);
      }

      summary.push({ storeId: cred.store_id, created, skipped });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (logRow) {
        await supabase
          .from("marketplace_sync_log")
          .update({ finished_at: new Date().toISOString(), orders_fetched: fetched, orders_created: created, orders_skipped_dup: skipped, status: "FAILED", error_message: message })
          .eq("id", logRow.id);
      }
      summary.push({ storeId: cred.store_id, created, skipped, error: message });
    }
  }

  return NextResponse.json({ summary });
}
