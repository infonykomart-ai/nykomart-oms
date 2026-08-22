// Shared "a courier told us something happened to AWB X" handler — used by
// every per-courier webhook/poller (Delhivery push, UPS push, FedEx poll —
// see src/app/api/webhooks/courier/*/route.ts and
// src/app/api/cron/poll-fedex-tracking/route.ts). Each courier has its own
// payload shape and its own auth scheme, but once normalized down to
// {awbNo, bucket, deliveredDate}, updating our own tables is identical
// regardless of source — this is that one shared path, so a bug fixed here
// is fixed for every courier at once.
//
// order_shipments.awb_no is the link (Gap 1, 2026-08-20 — see
// claude/gap1-multipackage-design-2026-08-20.md; this used to match on
// dispatch_invoices.awb_no directly, before an order could have more than
// one AWB). courier_webhook_log always gets a row first, before we even
// try to find a matching order_shipments row — so nothing is ever
// silently lost, even for an AWB that doesn't exist yet (webhook arriving
// before the dispatch entry was made is a normal race, not a bug).
//
// NOT .maybeSingle() — a shared-AWB order can have >1 order_shipments row
// with the same awb_no is NOT how this is modeled (one AWB = one
// order_shipments row; multiple PACKAGES share that one row via
// order_packages.order_shipment_id), so in practice this will match at
// most one row per order. It COULD still match >1 row across different
// orders if the same AWB text was mistakenly entered twice (a pre-existing
// data-quality risk, no worse than before) — handling every match keeps
// that case a "processed all of them" rather than a silent pick-one.
import { resyncDispatchSummary } from "@/lib/order-packages/resync-dispatch-summary";
import type { createServiceRoleClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type TrackingBucket = "IN_TRANSIT" | "DELIVERED" | "RTO" | "LOST" | "OTHER";

export type NormalizedTrackingEvent = {
  awbNo: string;
  bucket: TrackingBucket;
  deliveredDate: string | null; // YYYY-MM-DD
  rawStatusText: string | null; // for the log row / debugging — not parsed further
};

export async function logCourierWebhook(
  supabase: ServiceClient,
  courierName: string,
  awbNo: string | null,
  rawPayload: unknown
): Promise<string | null> {
  const { data } = await supabase
    .from("courier_webhook_log")
    .insert({
      courier_name: courierName,
      awb_no: awbNo,
      raw_payload: rawPayload as never,
    })
    .select("id")
    .single();
  return data?.id ?? null;
}

export async function markCourierWebhookError(
  supabase: ServiceClient,
  logId: string | null,
  message: string
): Promise<void> {
  if (!logId) return;
  await supabase.from("courier_webhook_log").update({ error_message: message }).eq("id", logId);
}

export async function markCourierWebhookProcessed(supabase: ServiceClient, logId: string | null): Promise<void> {
  if (!logId) return;
  await supabase.from("courier_webhook_log").update({ processed: true, processed_at: new Date().toISOString() }).eq("id", logId);
}

/**
 * Applies a normalized tracking event to dispatch_invoices + orders.
 * Returns whether a matching dispatch_invoices row was found (the caller
 * logs "matched"/"unmatched" accordingly — an unmatched AWB is a normal
 * race, not an error, per the header comment above).
 *
 * Deliberately conservative about what it writes:
 *  - DELIVERED: sets delivered_status/delivered_date on dispatch_invoices,
 *    shipment_status='Delivered' on the order.
 *  - RTO: shipment_status='Returned' on the order (delivered_status left
 *    alone — the enum only has 'Delivered'/'NOT Delivered', RTO isn't
 *    really either).
 *  - IN_TRANSIT: shipment_status='In Transit', but ONLY if the order isn't
 *    already Delivered/Returned/Cancelled — a late/out-of-order IN_TRANSIT
 *    event should never downgrade a real terminal status.
 *  - LOST / OTHER: not written anywhere (no clean, courier-confirmed
 *    signal for either across Delhivery/FedEx/UPS per the research this
 *    was built from) — logged to courier_webhook_log only, for manual
 *    follow-up.
 */
export async function applyTrackingEvent(
  supabase: ServiceClient,
  event: NormalizedTrackingEvent
): Promise<{ matched: boolean }> {
  const { data: shipmentRows } = await supabase
    .from("order_shipments")
    .select("id, order_id")
    .ilike("awb_no", event.awbNo);

  if (!shipmentRows || shipmentRows.length === 0) return { matched: false };

  const today = new Date().toISOString().slice(0, 10);
  const shipmentIds = shipmentRows.map((s) => s.id);
  const orderIds = Array.from(new Set(shipmentRows.map((s) => s.order_id)));

  if (event.bucket === "DELIVERED") {
    await supabase
      .from("order_shipments")
      .update({ delivered_status: "Delivered", delivered_date: event.deliveredDate, last_update_date: today })
      .in("id", shipmentIds);
    // resyncDispatchSummary applies the weakest-link rule — orders.shipment_status
    // only flips to 'Delivered' once EVERY shipment on that order is delivered.
    for (const orderId of orderIds) await resyncDispatchSummary(supabase, orderId);
  } else if (event.bucket === "RTO") {
    await supabase.from("order_shipments").update({ last_update_date: today }).in("id", shipmentIds);
    // RTO on any one AWB is treated as an order-level exception, same as before
    // this became multi-shipment-aware — a partial return still needs eyes on it.
    for (const orderId of orderIds) await supabase.from("orders").update({ shipment_status: "Returned" }).eq("id", orderId);
  } else if (event.bucket === "IN_TRANSIT") {
    await supabase.from("order_shipments").update({ last_update_date: today }).in("id", shipmentIds);
    for (const orderId of orderIds) {
      const { data: order } = await supabase.from("orders").select("shipment_status").eq("id", orderId).single();
      if (order && !["Delivered", "Returned", "Cancelled"].includes(order.shipment_status)) {
        await supabase.from("orders").update({ shipment_status: "In Transit" }).eq("id", orderId);
      }
    }
  }
  // LOST / OTHER: logged only, nothing written — see doc comment above.

  return { matched: true };
}
