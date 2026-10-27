"use server";

// 2026-10-26 — "AWB NO JAB SHIPMENT ME ADD HO GAYA TO ... TRACKING CHECK
// HOKAR STATUS SHOW HO JAYE JAB API USE HORI TRACKING KI".
//
// The nightly cron (/api/cron/poll-fedex-tracking) already asks FedEx /
// Aramex / DHL for every pending AWB once a day. This action is the same
// check, on demand, for ONE order — so someone looking at an order can pull
// the courier's current status without waiting for tomorrow's run.
//
// It deliberately reuses lib/couriers/tracking-poll.ts's fetchers and
// applyPolledEvents() — the exact code path the cron uses — so the DB writes
// (order_shipments.delivered_status/date, orders.shipment_status, the
// dispatch_invoices mirror, courier_webhook_log) are identical.
//
// UPS / Delhivery / Shiprocket are push-only (their webhooks already update
// us continuously), so their AWBs are reported as "not polled" rather than
// silently ignored.
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAramexClientInfo } from "@/lib/couriers/aramex-tracking";
import { getDhlApiKey } from "@/lib/couriers/dhl-tracking";
import { getFedexAccessToken } from "@/lib/couriers/fedex-auth";
import {
  applyPolledEvents,
  fetchAramexBatchNormalized,
  fetchDhlBatchNormalized,
  fetchFedexBatchNormalized,
  pollableFamilyForCourierName,
} from "@/lib/couriers/tracking-poll";

export type TrackingRefreshState = { error: string | null; message: string | null };

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function refreshOrderTracking(
  _prev: TrackingRefreshState,
  formData: FormData
): Promise<TrackingRefreshState> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClient();

  const orderId = String(formData.get("order_id") ?? "").trim();
  if (!orderId) return { error: "Missing order.", message: null };

  const { data: order } = await supabase
    .from("orders")
    .select("id, company_id, ref_no")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { error: "Order not found (or not in a company you can access).", message: null };
  }

  const { data: shipments } = await supabase
    .from("order_shipments")
    .select("awb_no, courier_name")
    .eq("order_id", orderId);

  const awbRows = (shipments ?? []).filter((s) => !!s.awb_no);
  if (awbRows.length === 0) {
    return { error: "No AWB on this order yet — save one in the shipping form first.", message: null };
  }

  const groups: Record<"fedex" | "aramex" | "dhl", string[]> = { fedex: [], aramex: [], dhl: [] };
  const notPollable: string[] = [];
  for (const row of awbRows) {
    const awb = row.awb_no as string;
    const family = pollableFamilyForCourierName(row.courier_name);
    if (!family) {
      notPollable.push(`${awb} (${row.courier_name ?? "courier not set"})`);
      continue;
    }
    if (!groups[family].includes(awb)) groups[family].push(awb);
  }

  const checked: string[] = [];
  const errors: string[] = [];
  let updated = 0;

  if (groups.fedex.length > 0) {
    try {
      const token = await getFedexAccessToken();
      const applied = await applyPolledEvents(supabase, "FedEx", await fetchFedexBatchNormalized(token, groups.fedex));
      checked.push(`FedEx: ${applied.polled} AWB checked`);
      updated += applied.updated;
    } catch (err) {
      errors.push(`FedEx: ${errorMessage(err)}`);
    }
  }

  if (groups.aramex.length > 0) {
    try {
      const client = getAramexClientInfo();
      const applied = await applyPolledEvents(supabase, "Aramex", await fetchAramexBatchNormalized(client, groups.aramex));
      checked.push(`Aramex: ${applied.polled} AWB checked`);
      updated += applied.updated;
    } catch (err) {
      errors.push(`Aramex: ${errorMessage(err)}`);
    }
  }

  if (groups.dhl.length > 0) {
    try {
      const apiKey = getDhlApiKey();
      const applied = await applyPolledEvents(supabase, "DHL", await fetchDhlBatchNormalized(apiKey, groups.dhl));
      checked.push(`DHL: ${applied.polled} AWB checked`);
      updated += applied.updated;
    } catch (err) {
      errors.push(`DHL: ${errorMessage(err)}`);
    }
  }

  revalidatePath(`/dashboard/orders/${orderId}`);
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/courier-booking");

  const skipNote = notPollable.length > 0 ? ` Not polled (these couriers push updates instead): ${notPollable.join(", ")}.` : "";

  if (checked.length === 0 && errors.length > 0) {
    return { error: errors.join(" · "), message: null };
  }

  return {
    error: errors.length > 0 ? errors.join(" · ") : null,
    message: `${checked.join(" · ")} — ${updated} status update(s) applied.${skipNote}`,
  };
}
