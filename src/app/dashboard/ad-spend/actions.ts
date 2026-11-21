"use server";

// Store-level Daily Spend tracking (pending item 3 — see
// claude/order-lifecycle-inventory-tracking-adspend-requests-2026-08-08.md
// and db/2026-08-08-store-ad-spend.sql). Only Budget/Spend (USD) are real
// data here — QTY ORD / USD (order count / order value) are computed live
// from `orders` by the report queries in page.tsx/report data functions
// below, never stored in store_ad_spend.

import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
// 2026-10-15 — Amazon is entered per marketplace country (see
// db/2026-10-15-ad-spend-amazon-country.sql).
import { AMAZON_COUNTRY_CODES, AMAZON_CURRENCIES, isAmazonStore } from "./amazon-countries";
// 2026-10-15b — live rate snapshot for the Amazon country-wise totals.
import { loadFxSnapshot } from "@/lib/fx/rates";
// 2026-11-21 — the same store-scope rule the page uses, so a login can only
// save/delete for a store that all three Ad Spend tabs would actually show it.
import { canWorkOnAdSpendStore, type AdSpendStoreScope } from "./store-scope";
// 2026-11-21 — the marketplace-specific numbers typed on the Daily Entry
// (Amazon / eBay / Etsy). Only the selected store's own channel columns are
// written, so saving an Amazon day can never blank an Etsy store's numbers.
import {
  CHANNEL_METRIC_KEYS,
  parseMetricNumber,
  storeChannel,
  type ChannelMetrics,
} from "./channel-metrics";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function numOrZero(formData: FormData, key: string): number {
  const v = str(formData, key);
  return v ? Number(v) : 0;
}

export type AdSpendFormState = { error: string | null; success: boolean };
const ok: AdSpendFormState = { error: null, success: true };
const fail = (error: string): AdSpendFormState => ({ error, success: false });

/**
 * Upsert one (store, date) row — the form re-submitting the same store+date
 * simply overwrites the previous Budget/Spend for that day (matches the
 * old spreadsheet's "just re-type the cell" correction pattern; no
 * separate edit screen needed).
 *
 * 2026-10-15 — for an AMAZON store the same re-type-the-cell rule applies
 * per (store, date, COUNTRY): Amazon runs one ad budget per marketplace
 * country, so the key carries country_code and one day can hold 12 rows.
 */
export async function saveAdSpendAction(_prev: AdSpendFormState, formData: FormData): Promise<AdSpendFormState> {
  const employee = await requireCapability("ad_spend_entry");
  const supabase = createServiceRoleClient();

  const storeId = str(formData, "store_id");
  const spendDate = str(formData, "spend_date");
  if (!storeId) return fail("Select a store.");
  if (!spendDate) return fail("Date is required.");

  const budgetUsd = numOrZero(formData, "budget_usd");
  const spendUsd = numOrZero(formData, "spend_usd");
  if (budgetUsd < 0 || spendUsd < 0) return fail("Budget/Spend cannot be negative.");

  // 2026-11-20 — optional ad-platform attributed orders (see
  // db/2026-11-20e-store-ad-spend-attributed-orders.sql). Blank means "not
  // recorded" (NULL), which is what lets the report hide the ad/organic
  // split instead of pretending the day had zero ad orders.
  const adOrdersRaw = str(formData, "ad_orders");
  const adOrders = adOrdersRaw === "" ? null : Number(adOrdersRaw);
  if (adOrders !== null && (!Number.isFinite(adOrders) || !Number.isInteger(adOrders) || adOrders < 0)) {
    return fail("Ad orders must be a whole number (0 or more), or left blank.");
  }

  // Confirm this store is one the login may actually work on before writing —
  // same defense-in-depth check used across every other module (e.g.
  // lookupOrderForEntry's employee.companyIds filter) rather than trusting the
  // client-submitted store_id alone. The rule itself lives in store-scope.ts
  // (order-entry store access, narrowed by an explicit Store Access
  // assignment, bypassed by the ad_spend_report_all approval).
  const { data: store } = await supabase.from("stores").select("id, name, company_id").eq("id", storeId).maybeSingle();
  const storeScope: AdSpendStoreScope = {
    companyIds: employee.companyIds,
    assignedStoreIds: employee.storeIds,
    canSeeAllStores: employee.capabilities.includes("ad_spend_report_all"),
  };
  if (!store || !canWorkOnAdSpendStore(store, storeScope)) {
    return fail("You do not have access to this store.");
  }

  // 2026-11-21 — channel metrics (Amazon clicks/impressions/visiting, eBay
  // visits/impressions/clicks, Etsy's daily+monthly block). A blank box is
  // "not recorded" (null); something that is not a non-negative number is
  // rejected rather than silently turning into 0. CTR and the Etsy monthly
  // spend % are NEVER accepted from the form — both are derived on read.
  const channel = storeChannel(store.name);
  const metricLabels: Record<keyof ChannelMetrics, string> = {
    clicks: "Clicks",
    impressions: "Impressions / Views",
    visits: "Visits",
    etsy_visits_daily: "Etsy visits (daily)",
    etsy_visits_monthly: "Etsy visits (monthly)",
    etsy_conversion_rate_monthly: "Etsy conversion rate (monthly)",
    etsy_revenue_usd: "Etsy revenue (USD)",
    etsy_orders: "Etsy orders",
    etsy_ad_clicks: "Etsy ads clicks",
  };
  const metrics: Partial<ChannelMetrics> = {};
  for (const key of CHANNEL_METRIC_KEYS[channel]) {
    const parsed = parseMetricNumber(str(formData, key));
    if (parsed === undefined) {
      return fail(`${metricLabels[key]} must be zero or a positive number, or left blank.`);
    }
    metrics[key] = parsed;
  }

  // 2026-10-15 — an Amazon store's numbers are per marketplace country, so
  // the country is mandatory there and must be one of the 12 codes; every
  // other store keeps the single per-day row (country_code ''), which the
  // unique key (store, date, country) then still enforces one-per-day.
  const isAmazon = isAmazonStore(store.name);
  const submittedCountry = str(formData, "country_code").toUpperCase();
  if (isAmazon && !AMAZON_COUNTRY_CODES.includes(submittedCountry)) {
    return fail("Amazon entries need a Country (US / UK / DE …).");
  }
  const countryCode = isAmazon ? submittedCountry : "";

  const base = {
    store_id: storeId,
    spend_date: spendDate,
    country_code: countryCode,
    budget_usd: budgetUsd,
    spend_usd: spendUsd,
    entry_by_employee_id: employee.id,
    updated_at: new Date().toISOString(),
  };

  const upsert = (payload: Record<string, unknown>) =>
    supabase.from("store_ad_spend").upsert(payload as never, { onConflict: "store_id,spend_date,country_code" });

  let { error } = await upsert({ ...base, ad_orders: adOrders, ...metrics });

  if (error) {
    // The ad-orders and channel-metric columns each ship in their own
    // migration. Until those are run, Budget/Spend must still save exactly
    // as before rather than failing the whole entry: retry with the optional
    // columns dropped, ending at the original two-number row.
    ({ error } = await upsert({ ...base, ad_orders: adOrders }));
    if (error) ({ error } = await upsert(base));
    if (error) return fail(`Failed to save: ${error.message}`);
  }
  revalidatePath("/dashboard/ad-spend");
  return ok;
}

export type SimpleResult = { error: string | null };

/**
 * 2026-10-15b — "ACTUAL CONVERSION KE HISAB SE JO DAILY BASIS PAR UPDATE HO
 * AUTOMATICLLY": the Amazon Country-wise section converts its USD figures at
 * a live market rate, refreshed automatically once the cached snapshot is
 * older than 12 hours (see src/lib/fx/rates.ts). This action is the manual
 * "Refresh rates" button next to those numbers, for the case where someone
 * wants today's rate right now.
 */
export async function refreshFxRatesAction(): Promise<SimpleResult> {
  await requireCapability("ad_spend_entry");
  const supabase = createServiceRoleClient();
  const snapshot = await loadFxSnapshot(supabase, AMAZON_CURRENCIES, { force: true });
  revalidatePath("/dashboard/ad-spend");
  if (snapshot.stale) return { error: snapshot.warning ?? "Could not refresh the exchange rates." };
  return { error: null };
}

/** Clears a day's entry entirely (rather than leaving a stray 0/0 row). */
export async function deleteAdSpendAction(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("ad_spend_entry");
  const supabase = createServiceRoleClient();

  const { data: row } = await supabase.from("store_ad_spend").select("id, store_id").eq("id", id).maybeSingle();
  if (!row) return { error: "Entry not found." };
  const { data: store } = await supabase.from("stores").select("company_id").eq("id", row.store_id).maybeSingle();
  const storeScope: AdSpendStoreScope = {
    companyIds: employee.companyIds,
    assignedStoreIds: employee.storeIds,
    canSeeAllStores: employee.capabilities.includes("ad_spend_report_all"),
  };
  if (!store || !canWorkOnAdSpendStore({ id: row.store_id, company_id: store.company_id }, storeScope)) {
    return { error: "You do not have access to this entry." };
  }

  const { error } = await supabase.from("store_ad_spend").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/ad-spend");
  return { error: null };
}
