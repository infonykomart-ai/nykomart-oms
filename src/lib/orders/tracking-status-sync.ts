// 2026-11-23 — ONE place that turns "this parcel is now In Transit /
// Delivered / Returned" into every order-level field the app shows.
//
// Before this file, each caller wrote a different subset:
//   • the courier webhook / poll wrote order_shipments.delivered_status and
//     orders.shipment_status, never orders.status or dispatch_date;
//   • the bulk CSV wrote orders.shipment_status only;
//   • the manual shipping form set orders.status='Dispatched' but had no way
//     to record Delivered / Returned at all.
// The result was the reported "manual tracking update kahin dikh nahi rahi":
// the Order detail's Status line and Track Shipments' Order Status column
// disagreed, and a delivered parcel never flipped the order itself.
//
// Every path below now goes through syncOrderTrackingState():
//   • orders.status               Dispatched / Delivered / Returned
//   • orders.dispatch_date        stamped the first time a parcel moves
//   • orders.shipment_status      the shipping state itself
//   • order_shipments            delivered_status / delivered_date /
//                                last_update_date (all, or just the AWBs the
//                                caller actually matched)
//   • dispatch_invoices          recomputed by resyncDispatchSummary's
//                                weakest-link rule
//
// Nothing here invents data: a Delivered state only flips orders.status once
// EVERY shipment on the order is delivered, the same weakest-link rule
// resync-dispatch-summary.ts documents.
import type { createServiceRoleClient } from "@/lib/supabase/server";
import { resyncDispatchSummary } from "@/lib/order-packages/resync-dispatch-summary";
import {
  nextOrderStatus,
  shouldApplyTrackingState,
  type TrackingState,
} from "@/lib/orders/tracking-status";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type TrackingSyncOptions = {
  /** Date the courier reported delivery (YYYY-MM-DD); today when omitted. */
  deliveredDate?: string | null;
  /** Staff explicitly chose this state — bypasses the terminal-state guard. */
  force?: boolean;
  /**
   * false = only the ORDER row is updated; the caller already wrote
   * order_shipments itself (bulk CSV update). Defaults to true.
   */
  writeShipments?: boolean;
  /** Only these order_shipments rows move (webhook matched specific AWBs). */
  shipmentIds?: string[];
};

export async function syncOrderTrackingState(
  supabase: ServiceClient,
  orderId: string,
  state: TrackingState,
  options: TrackingSyncOptions = {}
): Promise<void> {
  if (!orderId) return;

  const { data: order } = await supabase
    .from("orders")
    .select("status, dispatch_date, shipment_status")
    .eq("id", orderId)
    .maybeSingle();
  if (!order) return;
  if (!shouldApplyTrackingState(order, state, options.force ?? false)) return;

  const today = new Date().toISOString().slice(0, 10);
  const deliveredDate = options.deliveredDate ?? today;

  if (options.writeShipments !== false) {
    const shipmentPatch: {
      last_update_date: string;
      delivered_status?: "Delivered";
      delivered_date?: string;
    } = { last_update_date: today };
    if (state === "Delivered") {
      shipmentPatch.delivered_status = "Delivered";
      shipmentPatch.delivered_date = deliveredDate;
    }
    const target = options.shipmentIds?.length
      ? supabase.from("order_shipments").update(shipmentPatch).in("id", options.shipmentIds)
      : supabase.from("order_shipments").update(shipmentPatch).eq("order_id", orderId);
    await target;
  }

  const orderPatch: {
    status?: "Dispatched" | "Delivered" | "Returned";
    dispatch_date?: string;
    shipment_status: TrackingState;
  } = { shipment_status: state };

  if (state === "Delivered") {
    // resync applies the order-level weakest-link rule and mirrors the
    // dispatch summary; afterwards only a FULLY delivered order moves on.
    await resyncDispatchSummary(supabase, orderId);
    const { data: rows } = await supabase
      .from("order_shipments")
      .select("delivered_status")
      .eq("order_id", orderId);
    const allDelivered =
      (rows ?? []).length === 0 || (rows ?? []).every((row) => row.delivered_status === "Delivered");
    if (!allDelivered) {
      // 2026-11-23b — a partial delivery must not describe the WHOLE order as
      // Delivered. Only the targeted shipment moved above; the order keeps its
      // existing dispatch/shipment status until its last AWB is delivered.
      // resyncDispatchSummary has already stamped the order-level summary with
      // 'NOT Delivered', so nothing below is needed here.
      return;
    }
    orderPatch.status = "Delivered";
    orderPatch.dispatch_date = order.dispatch_date ?? deliveredDate;
  } else {
    orderPatch.status = nextOrderStatus(state);
    if (state !== "Returned") orderPatch.dispatch_date = order.dispatch_date ?? today;
  }

  await supabase.from("orders").update(orderPatch).eq("id", orderId);
}
