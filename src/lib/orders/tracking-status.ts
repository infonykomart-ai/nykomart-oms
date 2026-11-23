// 2026-11-23 — "TRACKING DALE TO VO UPDATE HO JAYE HAR JAGH PAR, ORDER STATUS
// BHI UPDATE HO JAYE, DISPATCHED AUTO, DELIVER MARK" — the pure half of the
// one tracking → order-status rule set.
//
// src/lib/orders/tracking-status-sync.ts does the I/O (order_shipments +
// orders + dispatch_invoices) and calls these functions. Keeping the rules
// here means they can be unit-tested without Next.js or a database.
//
// The four states below are exactly the shipping states the Order detail
// page shows, so a manual entry, a courier webhook and the nightly poll all
// speak the same language.
export type TrackingState = "Shipped" | "In Transit" | "Delivered" | "Returned";

export const TRACKING_STATES: readonly TrackingState[] = [
  "Shipped",
  "In Transit",
  "Delivered",
  "Returned",
];

export function isTrackingState(value: string | null | undefined): value is TrackingState {
  return !!value && (TRACKING_STATES as readonly string[]).includes(value);
}

export type TrackingOrderSnapshot = {
  status: string | null;
  shipment_status: string | null;
};

/**
 * The order.status a tracking state implies. "Shipped" and "In Transit" both
 * mean the parcel is moving, which is the "Dispatched" bucket the Orders hub
 * uses; Delivered/Returned are their own terminal statuses.
 */
export function nextOrderStatus(state: TrackingState): "Dispatched" | "Delivered" | "Returned" {
  if (state === "Delivered") return "Delivered";
  if (state === "Returned") return "Returned";
  return "Dispatched";
}

/**
 * Whether a tracking event is allowed to move this order.
 *
 *  - A Cancelled order never moves automatically (an explicit staff action
 *    passes force=true).
 *  - Delivered / Returned always apply — they are progress or a terminal
 *    courier signal, never a downgrade.
 *  - A late "Shipped"/"In Transit" event must never pull an order back out
 *    of Delivered/Returned (the same guard the old webhook handler had).
 */
export function shouldApplyTrackingState(
  current: TrackingOrderSnapshot,
  state: TrackingState,
  force = false
): boolean {
  if (force) return true;
  if (current.status === "Cancelled") return false;
  if (state === "Delivered" || state === "Returned") return true;
  if (current.status === "Delivered" || current.status === "Returned") return false;
  if (current.shipment_status === "Delivered" || current.shipment_status === "Returned") return false;
  return true;
}
