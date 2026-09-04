// Data-fetch for the Pickup Request tab (EGS-integration round,
// 2026-09-04 — mirrors EGS's own "Pickup Request" page:
// /logistic-partners-create-pickup). See
// db/2026-09-04-egs-integration-pickup-and-cancel.sql and
// pickup-request-actions.ts for the "internal request log, not a live
// courier API call" scope note.
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { CourierKey } from "@/lib/couriers/credentials";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type PickupCandidateAwb = {
  orderShipmentId: string;
  orderId: string;
  refNo: string;
  awbNo: string;
  serviceCode: string | null;
  buyerNameAddress: string | null;
  totalPriceInr: number | null;
  weightKg: number | null;
};

// AWBs eligible for a NEW pickup request: booked with this courier, not
// yet delivered/returned, and not already covered by an earlier pickup
// request (courier_pickup_request_awbs) — same "not yet acted on" shape
// as Pending Orders' own "not yet booked" definition.
export async function getPickupCandidateAwbs(supabase: ServiceClient, companyIds: string[], courier: CourierKey): Promise<PickupCandidateAwb[]> {
  const { data: shipments } = await supabase
    .from("order_shipments")
    .select("id, order_id, awb_no")
    .ilike("courier_name", `%${courier}%`)
    .not("awb_no", "is", null)
    .is("delivered_status", null);
  if (!shipments || shipments.length === 0) return [];

  const shipmentIds = shipments.map((s) => s.id);
  const orderIds = Array.from(new Set(shipments.map((s) => s.order_id)));

  const [{ data: alreadyRequested }, { data: orders }, { data: courierShipments }, { data: packages }] = await Promise.all([
    supabase.from("courier_pickup_request_awbs").select("order_shipment_id").in("order_shipment_id", shipmentIds),
    supabase.from("orders").select("id, ref_no, buyer_name_address, order_value_inr, company_id").in("id", orderIds).in("company_id", companyIds),
    supabase.from("courier_shipments").select("order_id, service_code").in("order_id", orderIds).eq("courier", courier),
    supabase.from("order_packages").select("order_shipment_id, weight_kg").in("order_shipment_id", shipmentIds).eq("package_no", 1),
  ]);

  const requestedIds = new Set((alreadyRequested ?? []).map((r) => r.order_shipment_id));
  const orderById = new Map((orders ?? []).map((o) => [o.id, o]));
  const serviceByOrder = new Map((courierShipments ?? []).map((c) => [c.order_id, c.service_code]));
  const weightByShipment = new Map((packages ?? []).map((p) => [p.order_shipment_id, p.weight_kg]));

  const rows: PickupCandidateAwb[] = [];
  for (const s of shipments) {
    if (requestedIds.has(s.id)) continue;
    const order = orderById.get(s.order_id);
    if (!order) continue; // not in a company this employee can see
    rows.push({
      orderShipmentId: s.id,
      orderId: s.order_id,
      refNo: order.ref_no,
      awbNo: s.awb_no!,
      serviceCode: serviceByOrder.get(s.order_id) ?? null,
      buyerNameAddress: order.buyer_name_address,
      totalPriceInr: order.order_value_inr,
      weightKg: weightByShipment.get(s.id) ?? null,
    });
  }
  return rows;
}

export type PickupRequestRow = {
  id: string;
  courier: CourierKey;
  pickupAddress: string;
  bookingDate: string;
  scheduledPickupDate: string;
  status: "requested" | "confirmed" | "cancelled";
  remark: string | null;
  createdAt: string;
  awbCount: number;
};

export async function listPickupRequests(supabase: ServiceClient, companyId: string): Promise<PickupRequestRow[]> {
  const { data: requests } = await supabase
    .from("courier_pickup_requests")
    .select("id, courier, pickup_address, booking_date, scheduled_pickup_date, status, remark, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (!requests || requests.length === 0) return [];

  const requestIds = requests.map((r) => r.id);
  const { data: links } = await supabase.from("courier_pickup_request_awbs").select("pickup_request_id").in("pickup_request_id", requestIds);
  const countByRequest = new Map<string, number>();
  for (const l of links ?? []) countByRequest.set(l.pickup_request_id, (countByRequest.get(l.pickup_request_id) ?? 0) + 1);

  return requests.map((r) => ({
    id: r.id,
    courier: r.courier as CourierKey,
    pickupAddress: r.pickup_address,
    bookingDate: r.booking_date,
    scheduledPickupDate: r.scheduled_pickup_date,
    status: r.status as PickupRequestRow["status"],
    remark: r.remark,
    createdAt: r.created_at,
    awbCount: countByRequest.get(r.id) ?? 0,
  }));
}
