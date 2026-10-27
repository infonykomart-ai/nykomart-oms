// Data-fetch for the "Track Shipments" tab — server-only, no "use server"
// directive (this is a read, not a Server Action bound to a <form>, so it
// doesn't need one — only called from courier-booking/page.tsx, a Server
// Component). There was previously no dedicated cross-order "Shipments" or
// "Tracking" list page anywhere in this app (confirmed during this round's
// investigation) — order-level status only ever showed as a small badge on
// the Orders list/detail pages. This is the first one.
//
// Plain queries, not an embedded-resource join — see require-capability.ts's
// own comment on why this codebase's hand-rolled Database type doesn't emit
// Relationships metadata for join shapes (`orders!inner(...)` would type as
// `never`).
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { CourierKey } from "@/lib/couriers/credentials";
import { sanitizeSearchTerm } from "@/lib/orders/find-order";
// 2026-10-26 — tolerant reads/writes for forwarding_no (see the fallback in
// fetchShipments and db/2026-10-26-order-shipment-forwarding-no.sql).
import { isMissingSchemaPiece } from "@/lib/db/missing-column";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type TrackedShipment = {
  id: string;
  courier: CourierKey | "other";
  // Only set when courier === "other" — the free-text name from a Manual
  // Entry (Booked Outside) row. See manual-booking-actions.ts.
  manualCourierName: string | null;
  status: "pending" | "created" | "failed" | "cancelled";
  awbNo: string | null;
  // 2026-10-26 — the forwarder/aggregator's own number for the same parcel
  // (Shiprocket shipment id, Shipglobal order number, …), searched and
  // displayed beside the carrier's AWB. See
  // db/2026-10-26-order-shipment-forwarding-no.sql.
  forwardingNo: string | null;
  labelUrl: string | null;
  bookedAmt: number | null;
  bookedCurrency: string | null;
  bookedAmountSource: "api" | "rate_card_estimate" | "manual" | null;
  createdAt: string;
  orderId: string;
  refNo: string;
  shipmentStatus: string;
  deliveredStatus: "Delivered" | "NOT Delivered" | null;
};

export type TrackingFilters = {
  courier?: CourierKey | "other" | "";
  status?: "pending" | "created" | "failed" | "cancelled" | "";
  q?: string; // matches AWB or Ref No.
};

const MAX_ROWS = 200;

export async function getTrackedShipments(
  supabase: ServiceClient,
  companyIds: string[],
  filters: TrackingFilters
): Promise<TrackedShipment[]> {
  // 2026-10-22 — "AWB assign courier vale section me order hote hue bhi order
  // show nahi hota ... filter laga kar dekhte hai to pata chalta hai": this
  // searched the AWB in SQL but matched the ORDER'S ref no. in JS, AFTER
  // `.limit(MAX_ROWS)` — so a PO/RF/RG search only ever looked at the newest
  // 200 shipments, and a courier/status filter (which narrows in the
  // database) pulled the row into that window, which is exactly the reported
  // behaviour. The ref/marketplace search now resolves in the database too.
  const term = filters.q ? sanitizeSearchTerm(filters.q) : "";

  type ShipmentQueryRow = {
    id: string;
    courier: string;
    manual_courier_name: string | null;
    status: string;
    awb_no: string | null;
    forwarding_no: string | null;
    label_url: string | null;
    booked_amt: number | null;
    booked_currency: string | null;
    booked_amount_source: string | null;
    created_at: string;
    order_id: string;
  };

  // One query shape, used twice when searching: once for the AWB itself, once
  // for the shipment rows of every order whose ref/marketplace no. matched.
  async function fetchShipments(orderIds?: string[]): Promise<ShipmentQueryRow[]> {
    let q = supabase
      .from("courier_shipments")
      .select("id, courier, manual_courier_name, status, awb_no, forwarding_no, label_url, booked_amt, booked_currency, booked_amount_source, created_at, order_id")
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);
    if (filters.courier) q = q.eq("courier", filters.courier);
    if (filters.status) q = q.eq("status", filters.status);
    if (orderIds) q = q.in("order_id", orderIds);
    // Both numbers match — an aggregator parcel is just as likely to be
    // looked up by its forwarding ref as by the carrier's AWB.
    else if (term) q = q.or(`awb_no.ilike.%${term}%,forwarding_no.ilike.%${term}%`);
    const { data, error } = await q;
    if (!error) return (data ?? []) as ShipmentQueryRow[];
    // 2026-10-26 — on a database where
    // db/2026-10-26-order-shipment-forwarding-no.sql has not been run,
    // forwarding_no does not exist and PostgREST rejects the whole select:
    // this list would go EMPTY over rows that were never missing (the failure
    // BRAIN.md §5p describes for the leave screens). Retry with the base
    // columns and no forwarding_no in the search, so the tab still lists
    // everything it did before this round (src/lib/db/missing-column.ts).
    if (!isMissingSchemaPiece(error)) return [];
    let base = supabase
      .from("courier_shipments")
      .select("id, courier, manual_courier_name, status, awb_no, label_url, booked_amt, booked_currency, booked_amount_source, created_at, order_id")
      .order("created_at", { ascending: false })
      .limit(MAX_ROWS);
    if (filters.courier) base = base.eq("courier", filters.courier);
    if (filters.status) base = base.eq("status", filters.status);
    if (orderIds) base = base.in("order_id", orderIds);
    else if (term) base = base.ilike("awb_no", `%${term}%`);
    const { data: baseRows } = await base;
    return (baseRows ?? []).map((r) => ({ ...r, forwarding_no: null }));
  }

  let shipments: ShipmentQueryRow[];
  if (!term) {
    shipments = await fetchShipments();
  } else {
    const { data: matchingOrders } = await supabase
      .from("orders")
      .select("id")
      .in("company_id", companyIds)
      .or(`ref_no.ilike.%${term}%,marketplace_order_no.ilike.%${term}%`)
      .limit(500);
    const matchingOrderIds = (matchingOrders ?? []).map((o) => o.id);
    // 2026-10-26 — order_shipments is the source of truth for the forwarding
    // no. (a booking written before the mirror existed, or a flow that never
    // writes courier_shipments at all, only has it there), so a forwarding
    // ref is ALSO resolved to its order and that order's bookings pulled in.
    const { data: fwdShipments } = await supabase
      .from("order_shipments")
      .select("order_id")
      .ilike("forwarding_no", `%${term}%`)
      .limit(500);
    const searchOrderIds = Array.from(new Set([...matchingOrderIds, ...(fwdShipments ?? []).map((r) => r.order_id)]));
    const [byAwb, byOrder] = await Promise.all([
      fetchShipments(),
      searchOrderIds.length ? fetchShipments(searchOrderIds) : Promise.resolve([] as ShipmentQueryRow[]),
    ]);
    const merged = new Map<string, ShipmentQueryRow>();
    for (const s of [...byAwb, ...byOrder]) merged.set(s.id, s);
    shipments = Array.from(merged.values())
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
      .slice(0, MAX_ROWS);
  }

  if (shipments.length === 0) return [];

  const orderIds = Array.from(new Set(shipments.map((s) => s.order_id)));
  const { data: orders } = await supabase
    .from("orders")
    .select("id, ref_no, company_id, shipment_status")
    .in("id", orderIds)
    .in("company_id", companyIds);
  const orderById = new Map((orders ?? []).map((o) => [o.id, o]));

  const { data: shipmentRows } = await supabase
    .from("order_shipments")
    .select("order_id, delivered_status")
    .in("order_id", orderIds);
  const deliveredByOrder = new Map((shipmentRows ?? []).map((r) => [r.order_id, r.delivered_status]));

  const result: TrackedShipment[] = [];
  for (const s of shipments) {
    const order = orderById.get(s.order_id);
    if (!order) continue; // not in a company this employee can see
    result.push({
      id: s.id,
      courier: s.courier as CourierKey | "other",
      manualCourierName: s.manual_courier_name,
      // 2026-09-19 — status/booked_amount_source are plain `text` columns in
      // Postgres (no DB-level enum), so database.ts types them as bare
      // `string`; cast to the app's own narrower literal union here, same
      // convention as the `courier` cast just above.
      status: s.status as TrackedShipment["status"],
      awbNo: s.awb_no,
      // `?? null` covers the un-migrated read above, where the column is absent
      // rather than null.
      forwardingNo: s.forwarding_no ?? null,
      labelUrl: s.label_url,
      bookedAmt: s.booked_amt,
      bookedCurrency: s.booked_currency,
      bookedAmountSource: s.booked_amount_source as TrackedShipment["bookedAmountSource"],
      createdAt: s.created_at,
      orderId: s.order_id,
      refNo: order.ref_no,
      shipmentStatus: order.shipment_status,
      deliveredStatus: deliveredByOrder.get(s.order_id) ?? null,
    });
  }
  return result;
}
