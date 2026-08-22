// Bulk Courier Tracking Update via CSV (2026-08-08, pending item 8 —
// companion to item 6's Bulk Order Entry, reusing the same downloadable-
// template pattern). Matches existing orders by Ref No. (PO/RF/RG) and
// updates their tracking info — no new orders are created here.
//
// Two homes for the fields, per db/schema.sql:
//  - Shipment Status lives on `orders.shipment_status` directly — this is
//    the simple status the Orders hub badge shows (item 7's "In Transit /
//    Delivered / red alert" ask).
//  - AWB No. / Courier Name / Delivered Status / Delivered Date / Remark
//    live on `dispatch_invoices` (one row per order) — upserted here.
// Item 7 itself (pulling this automatically from a courier's own API) is
// still blocked on courier+API details from the user; this is the manual
// path in the meantime, and stays useful as a backfill/fallback either way.
export type TrackingColumn = {
  label: string;
  example: string;
  required: boolean;
  help?: string;
};

export const SHIPMENT_STATUSES = [
  "Order Placed",
  "In Production",
  "Ready to Ship",
  "Shipped",
  "In Transit",
  "Delivered",
  "Returned",
  "Cancelled",
] as const;

export const DELIVERED_STATUSES = ["Delivered", "NOT Delivered"] as const;

export const TRACKING_COLUMNS: TrackingColumn[] = [
  { label: "Ref No", example: "PO-0001", required: true, help: "The exact PO/RF/RG number (with any -1/2 suffix if applicable)." },
  { label: "Shipment Status", example: "In Transit", required: false, help: SHIPMENT_STATUSES.join(" / ") },
  {
    label: "Shipment No",
    example: "",
    required: false,
    // Gap 1 (2026-08-20): an order can now have more than one AWB/shipment
    // — see claude/gap1-multipackage-design-2026-08-20.md. Leave blank for
    // the (still overwhelmingly common) single-shipment order; this
    // targets shipment 1 automatically, same as before this column existed.
    help: "Leave blank for a single-shipment order (defaults to 1). Only set this if the order has multiple AWBs.",
  },
  { label: "AWB No", example: "", required: false },
  { label: "Courier Name", example: "", required: false },
  { label: "Delivered Status", example: "", required: false, help: DELIVERED_STATUSES.join(" / ") },
  { label: "Delivered Date", example: "", required: false, help: "YYYY-MM-DD" },
  { label: "Remark", example: "", required: false },
];
