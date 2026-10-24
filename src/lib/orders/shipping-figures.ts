// 2026-10-24 — one shared place that answers, per order: what is the order
// worth, what did WE charge/estimate for shipping, and what did the COURIER
// actually bill (pre-GST / GST / gross) — plus the live destination country.
//
// Why this exists: the Courier Bill sheet and the Purchase Bill sheet both
// need these four numbers on the same row ("SHIPPING CHARGES", "SHIPPING
// CHARGES COURIER", "ORDER VALUE", "PURCHASE %"), and they must never drift
// apart. Both pages now read from here instead of each re-deriving them.
//
// COUNTRY IS READ LIVE FROM `orders`, NOT from dispatch_invoices: the
// dispatch row keeps its own copy of buyer_country, captured when the
// dispatch was recorded. When someone corrects a mistake on the order
// afterwards ("order me country mistake thi or sheet generate hone ke baad
// thik karte hai to vo update nahi hoti") that copy went stale and the
// courier sheet kept printing the wrong country. orders.destination_country
// / orders.buyer_country are the order's own current values; the dispatch
// copy is only the last-resort fallback (legacy orders with neither set).
//
// COURIER FIGURES follow the Courier Bill report's established rules
// exactly (see freight-bills/[id]/report/page.tsx): pre-GST is the
// captured billed_freight_amt, else the sum of the captured component
// columns; GST is the captured billed_gst_amt, else 18% of that real bill
// total; gross = pre-GST + GST. When NOTHING was captured for an AWB (a
// legacy row), the dispatch estimate stands in so the sheet shows a sane
// number instead of a misleading zero — and the caller can tell the
// difference via `courierBillSourced`.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export type OrderShippingFigures = {
  orderId: string;
  orderRef: string;
  /** orders.order_value_inr — the app-computed INR order value. */
  orderValueInr: number;
  /** Our dispatch-time shipping estimate (fully loaded: base − discount + fuel + surcharge + GST). */
  ourShippingInr: number;
  /** Courier's pre-GST charge for this order's AWB(s). */
  courierPreGstInr: number;
  /** GST charged by the courier (captured, else 18% of the captured bill total). */
  courierGstInr: number;
  /** What we actually owe the courier for this order, GST included. */
  courierGrossInr: number;
  /** true = the courier figures came off a real bill; false = dispatch estimate fallback. */
  courierBillSourced: boolean;
  /** Live destination country: order's own value first, dispatch copy last. */
  country: string;
  /** Shipping % of order value (courier gross ÷ order value). */
  shippingPct: number | null;
};

export async function loadOrderShippingFigures(
  supabase: Client,
  orderIds: string[]
): Promise<Map<string, OrderShippingFigures>> {
  const ids = Array.from(new Set(orderIds.filter(Boolean)));
  const out = new Map<string, OrderShippingFigures>();
  if (ids.length === 0) return out;

  const [{ data: orders }, { data: dispatches }, { data: assignments }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, ref_no, order_value_inr, buyer_country, destination_country")
      .in("id", ids),
    supabase
      .from("dispatch_invoices")
      .select("order_id, buyer_country, our_freight_amt, gst_18pct")
      .in("order_id", ids),
    supabase
      .from("freight_bill_awb_assignments")
      .select(
        "order_id, billed_freight_amt, billed_base_amt, billed_fuel_amt, billed_remote_amt, billed_other_amt, billed_gst_amt"
      )
      .in("order_id", ids),
  ]);

  const dispatchByOrder = new Map((dispatches ?? []).map((d) => [d.order_id, d] as const));

  // Courier charges roll up across every AWB on the order (a split shipment
  // has several assignments under the same order).
  const courierByOrder = new Map<
    string,
    { preGst: number; gst: number; sourced: boolean }
  >();
  for (const a of assignments ?? []) {
    const breakup =
      Number(a.billed_base_amt ?? 0) +
      Number(a.billed_fuel_amt ?? 0) +
      Number(a.billed_remote_amt ?? 0) +
      Number(a.billed_other_amt ?? 0);
    const billTotal = a.billed_freight_amt != null ? Number(a.billed_freight_amt) : breakup > 0 ? breakup : null;
    const billGst = a.billed_gst_amt != null ? Number(a.billed_gst_amt) : billTotal != null ? billTotal * 0.18 : null;
    if (billTotal == null && billGst == null) continue; // nothing captured on this AWB
    const cur = courierByOrder.get(a.order_id) ?? { preGst: 0, gst: 0, sourced: true };
    cur.preGst += billTotal ?? 0;
    cur.gst += billGst ?? 0;
    cur.sourced = cur.sourced || billTotal != null;
    courierByOrder.set(a.order_id, cur);
  }

  for (const o of orders ?? []) {
    const dispatch = dispatchByOrder.get(o.id);
    const ourShipping = Number(dispatch?.our_freight_amt ?? 0) + 0; // our_freight_amt is already fully loaded
    const ourGst = Number(dispatch?.gst_18pct ?? 0);
    const courier = courierByOrder.get(o.id);
    const billSourced = !!courier?.sourced;
    // Legacy AWB with no bill captured: show the dispatch estimate rather
    // than 0.00, split back out of its own GST-inclusive total.
    const courierGross = billSourced ? courier!.preGst + courier!.gst : ourShipping;
    const courierPre = billSourced ? courier!.preGst : Math.max(ourShipping - ourGst, 0);
    const courierGst = billSourced ? courier!.gst : ourGst;
    const orderValue = Number(o.order_value_inr ?? 0);
    out.set(o.id, {
      orderId: o.id,
      orderRef: o.ref_no,
      orderValueInr: orderValue,
      ourShippingInr: ourShipping,
      courierPreGstInr: courierPre,
      courierGstInr: courierGst,
      courierGrossInr: courierGross,
      courierBillSourced: billSourced,
      country: o.destination_country || o.buyer_country || dispatch?.buyer_country || "",
      shippingPct: orderValue > 0 ? (courierGross / orderValue) * 100 : null,
    });
  }
  return out;
}
