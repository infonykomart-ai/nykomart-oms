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

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type TrackedShipment = {
  id: string;
  courier: CourierKey;
  status: "pending" | "created" | "failed" | "cancelled";
  awbNo: string | null;
  labelUrl: string | null;
  bookedAmt: number | null;
  bookedCurrency: string | null;
  createdAt: string;
  orderId: string;
  refNo: string;
  shipmentStatus: string;
  deliveredStatus: "Delivered" | "NOT Delivered" | null;
};

export type TrackingFilters = {
  courier?: CourierKey | "";
  status?: "pending" | "created" | "failed" | "cancelled" | "";
  q?: string; // matches AWB or Ref No.
};

const MAX_ROWS = 200;

export async function getTrackedShipments(
  supabase: ServiceClient,
  companyIds: string[],
  filters: TrackingFilters
): Promise<TrackedShipment[]> {
  let query = supabase
    .from("courier_shipments")
    .select("id, courier, status, awb_no, label_url, booked_amt, booked_currency, created_at, order_id")
    .order("created_at", { ascending: false })
    .limit(MAX_ROWS);

  if (filters.courier) query = query.eq("courier", filters.courier);
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.q) query = query.ilike("awb_no", `%${filters.q}%`);

  const { data: shipments } = await query;
  if (!shipments || shipments.length === 0) return [];

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
    if (filters.q && !order.ref_no.toLowerCase().includes(filters.q.toLowerCase()) && !(s.awb_no ?? "").toLowerCase().includes(filters.q.toLowerCase())) {
      continue;
    }
    result.push({
      id: s.id,
      courier: s.courier as CourierKey,
      status: s.status,
      awbNo: s.awb_no,
      labelUrl: s.label_url,
      bookedAmt: s.booked_amt,
      bookedCurrency: s.booked_currency,
      createdAt: s.created_at,
      orderId: s.order_id,
      refNo: order.ref_no,
      shipmentStatus: order.shipment_status,
      deliveredStatus: deliveredByOrder.get(s.order_id) ?? null,
    });
  }
  return result;
}
