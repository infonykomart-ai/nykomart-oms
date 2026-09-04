// Shared "5 fields per order" helper (2026-09-04) — a non-technical user
// asked why they could no longer easily see, for each order: store expense/
// freight cost, which vendor Party it was purchased from, whether a
// Purchase Bill entry was made against it, delivered status, and the
// tracking number. All 5 already existed in the schema, just scattered
// across 3+ tables with no single read path — this is that one path, so
// the Orders list, the order detail page and the Orders Report can all
// call the SAME function instead of re-deriving the sourcing rules 3 times
// (and inevitably drifting out of sync, the way the Orders list's old
// dispatch_invoices-only "More details" panel already had).
//
// Sourcing decision (each field, in priority order):
//
//  - Delivered status / tracking no. / courier: order_shipments FIRST (see
//    db/2026-08-20-order-shipments-and-packages.sql + resyncDispatchSummary,
//    src/lib/order-packages/resync-dispatch-summary.ts) — it's the current,
//    multi-shipment-aware source (one order can have several AWBs/packages).
//    Applies the EXACT same "weakest link" + "comma-join when shipments
//    disagree" rules resyncDispatchSummary already established and keeps
//    dispatch_invoices synced with, so this reads as the same facts that
//    module writes: Delivered only once EVERY shipment for the order is
//    Delivered; courier/AWB shown as a single value when every shipment
//    agrees, else a comma-joined list.
//    Falls back to dispatch_invoices (the pre-order_shipments per-order
//    summary row) ONLY when an order has zero order_shipments rows — i.e.
//    orders entered before the 2026-08-20 multi-shipment model existed.
//    This is deliberately a direct read of order_shipments/dispatch_invoices
//    rather than trusting resyncDispatchSummary's dispatch_invoices mirror
//    for shipment-having orders too: that mirror doesn't carry freight at
//    all, and reading order_shipments directly here means this function
//    doesn't depend on that sync job having run/succeeded.
//    Final fallback for tracking NO. only (not delivered status, which has
//    no equivalent free-text field): orders.advance_tracking /
//    orders.final_tracking — the oldest, freeform-text fields carried over
//    from the original system, used only when neither shipment table has
//    anything for that order.
//
//  - Store expense / freight: order_shipments.booked_freight_amt is the
//    ONLY source (added 2026-09-01) — no equivalent exists on
//    dispatch_invoices or orders, so there is no fallback tier for this one.
//    Summed across every shipment on the order (NULL treated as 0 in the
//    sum), but if EVERY shipment's booked_freight_amt is NULL, the result is
//    null (displayed as "—" by callers) rather than 0 — a real recorded
//    zero-freight shipment and "freight was never captured" are different
//    facts and shouldn't look the same.
//
//  - Purchased-from vendor / Purchase Bill entry: purchase_bills.order_id is
//    the ACTUAL vendor (one row per Purchase Bill raised against the
//    order — the same "order_id now required" link the Orders hub's old
//    vendorText()/purchasesByOrder already read from, see order-list-table
//    .tsx's history). orders.vendor_party_id is the PLANNED/expected vendor
//    entered at order time, shown only when no Purchase Bill exists yet
//    (labelled "(planned)" — never confused with a real purchase). Whether
//    a Purchase Bill entry exists at all is just "purchase_bills.order_id
//    has >=1 row for this order" — no separate status field needed.
//
// A plain function (not "use server") — callers already sit behind their
// own requireCapability()/getAuthedEmployee() gate and already scope which
// orders they hand in here (e.g. `.in("company_id", employee.companyIds)`
// on the orders query that produced `orders` below), so this only ever
// touches rows for order ids the caller has already established the
// employee may see. It does not re-check company scoping itself, same as
// the purchasesByOrder/trackingByOrder helpers in orders/page.tsx it
// replaces — company scoping happens once, upstream, on the orders query.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type OrderStatusSummary = {
  // Purchased-from vendor Party + whether a Purchase Bill entry exists.
  purchasedFromName: string | null; // null = no actual OR planned vendor known
  purchasedFromIsPlanned: boolean; // true = this is orders.vendor_party_id, no Purchase Bill yet
  purchaseBillCount: number; // 0 = "no Purchase Bill yet"
  purchaseBillLabel: string | null; // e.g. "INV-123 (2026-08-12)"; joined if >1; null if purchaseBillCount is 0

  // Delivered status (weakest-link across shipments — see header comment).
  deliveredStatus: "Delivered" | "NOT Delivered" | null; // null = not tracked anywhere yet
  deliveredDate: string | null;

  // Tracking / courier.
  trackingNo: string | null; // AWB(s), comma-joined if the order's shipments disagree
  courierName: string | null;
  trackingSource: "order_shipments" | "dispatch_invoices" | "legacy" | null;

  // Store expense / freight (order_shipments only — see header comment).
  freightAmt: number | null; // null = not captured at all; a real 0 is shown as 0, never as "—"
  freightCurrency: string | null;
};

const EMPTY_SUMMARY: OrderStatusSummary = {
  purchasedFromName: null,
  purchasedFromIsPlanned: false,
  purchaseBillCount: 0,
  purchaseBillLabel: null,
  deliveredStatus: null,
  deliveredDate: null,
  trackingNo: null,
  courierName: null,
  trackingSource: null,
  freightAmt: null,
  freightCurrency: null,
};

function joinDistinct(values: (string | null | undefined)[]): string | null {
  const distinct = Array.from(new Set(values.filter((v): v is string => !!v)));
  return distinct.length ? distinct.join(", ") : null;
}

// Minimal shape callers need to supply — a subset of the `orders` columns
// most order queries in this app already select. advance_tracking/
// final_tracking are optional since not every caller's query selects them
// (the legacy-tracking fallback simply doesn't apply for those callers).
export type OrderStatusSummaryInput = {
  id: string;
  vendor_party_id: string | null;
  advance_tracking?: string | null;
  final_tracking?: string | null;
};

/**
 * Batch-fetches the 5 order-status fields (purchased-from vendor, Purchase
 * Bill entry, delivered status, tracking no., freight/store expense) for a
 * set of orders in one round trip per source table (never one query per
 * order) — see the header comment for the sourcing decision per field.
 */
export async function getOrderStatusSummaries(
  supabase: Client,
  orders: OrderStatusSummaryInput[]
): Promise<Record<string, OrderStatusSummary>> {
  const orderIds = orders.map((o) => o.id);
  if (orderIds.length === 0) return {};

  const [{ data: purchaseBills }, { data: shipments }, { data: dispatchInvoices }] = await Promise.all([
    supabase
      .from("purchase_bills")
      .select("order_id, vendor_party_id, vendor_invoice_no, vendor_invoice_date")
      .in("order_id", orderIds),
    supabase
      .from("order_shipments")
      .select("order_id, courier_name, awb_no, delivered_status, delivered_date, booked_freight_amt, booked_currency")
      .in("order_id", orderIds),
    supabase
      .from("dispatch_invoices")
      .select("order_id, awb_no, courier_name, delivered_status, delivered_date")
      .in("order_id", orderIds),
  ]);

  // Party names — needed both for the actual (Purchase Bill) vendor and the
  // planned (orders.vendor_party_id) fallback. parties has no company
  // scoping in this schema (shared vendor master across companies, same as
  // every other caller that reads it — e.g. orders/page.tsx's own `parties`
  // fetch), so a plain `.in("id", ...)` is correct here, not a gap.
  const partyIds = Array.from(
    new Set([
      ...(purchaseBills ?? []).map((p) => p.vendor_party_id).filter((v): v is string => !!v),
      ...orders.map((o) => o.vendor_party_id).filter((v): v is string => !!v),
    ])
  );
  const { data: parties } = partyIds.length
    ? await supabase.from("parties").select("id, name").in("id", partyIds)
    : { data: [] };
  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name]));

  const purchaseBillsByOrder = new Map<string, NonNullable<typeof purchaseBills>>();
  for (const pb of purchaseBills ?? []) {
    if (!pb.order_id) continue;
    const list = purchaseBillsByOrder.get(pb.order_id) ?? [];
    list.push(pb);
    purchaseBillsByOrder.set(pb.order_id, list);
  }

  const shipmentsByOrder = new Map<string, NonNullable<typeof shipments>>();
  for (const s of shipments ?? []) {
    const list = shipmentsByOrder.get(s.order_id) ?? [];
    list.push(s);
    shipmentsByOrder.set(s.order_id, list);
  }

  const dispatchByOrder = new Map((dispatchInvoices ?? []).map((d) => [d.order_id, d]));

  const result: Record<string, OrderStatusSummary> = {};

  for (const order of orders) {
    const summary: OrderStatusSummary = { ...EMPTY_SUMMARY };

    // --- Purchased-from vendor + Purchase Bill entry ---
    const pbRows = purchaseBillsByOrder.get(order.id) ?? [];
    if (pbRows.length > 0) {
      summary.purchasedFromName = pbRows.map((p) => partyName.get(p.vendor_party_id) ?? "—").join(", ");
      summary.purchasedFromIsPlanned = false;
      summary.purchaseBillCount = pbRows.length;
      summary.purchaseBillLabel = pbRows
        .map((p) => (p.vendor_invoice_date ? `${p.vendor_invoice_no} (${p.vendor_invoice_date})` : p.vendor_invoice_no))
        .join(", ");
    } else if (order.vendor_party_id) {
      summary.purchasedFromName = partyName.get(order.vendor_party_id) ?? "—";
      summary.purchasedFromIsPlanned = true;
    }

    // --- Delivered status / tracking / freight ---
    const orderShipments = shipmentsByOrder.get(order.id) ?? [];
    if (orderShipments.length > 0) {
      summary.trackingSource = "order_shipments";
      summary.trackingNo = joinDistinct(orderShipments.map((s) => s.awb_no));
      summary.courierName = joinDistinct(orderShipments.map((s) => s.courier_name));

      const anyStatusSet = orderShipments.some((s) => s.delivered_status != null);
      const allDelivered = orderShipments.every((s) => s.delivered_status === "Delivered");
      summary.deliveredStatus = !anyStatusSet ? null : allDelivered ? "Delivered" : "NOT Delivered";
      summary.deliveredDate = allDelivered
        ? orderShipments.reduce<string | null>(
            (latest, s) => (s.delivered_date && (!latest || s.delivered_date > latest) ? s.delivered_date : latest),
            null
          )
        : null;

      const allFreightNull = orderShipments.every((s) => s.booked_freight_amt == null);
      summary.freightAmt = allFreightNull
        ? null
        : orderShipments.reduce((sum, s) => sum + (s.booked_freight_amt != null ? Number(s.booked_freight_amt) : 0), 0);
      summary.freightCurrency = joinDistinct(orderShipments.map((s) => s.booked_currency));
    } else {
      const di = dispatchByOrder.get(order.id);
      if (di) {
        summary.trackingSource = "dispatch_invoices";
        summary.trackingNo = di.awb_no;
        summary.courierName = di.courier_name;
        summary.deliveredStatus = di.delivered_status;
        summary.deliveredDate = di.delivered_date;
        // No freight equivalent on dispatch_invoices — freightAmt stays null.
      } else {
        const legacyTracking = order.final_tracking || order.advance_tracking || null;
        if (legacyTracking) {
          summary.trackingSource = "legacy";
          summary.trackingNo = legacyTracking;
        }
        // No delivered status equivalent in the legacy freeform fields.
      }
    }

    result[order.id] = summary;
  }

  return result;
}
