// Data-fetch for the Pickup Request tab (EGS-integration round,
// 2026-09-04 — mirrors EGS's own "Pickup Request" page:
// /logistic-partners-create-pickup). See
// db/2026-09-04-egs-integration-pickup-and-cancel.sql and
// pickup-request-actions.ts for the "internal request log, not a live
// courier API call" scope note.
import { createServiceRoleClient } from "@/lib/supabase/server";
import { COURIERS, type CourierKey } from "@/lib/couriers/credentials";

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

export type PickupCandidatesByCourier = Record<CourierKey, PickupCandidateAwb[]>;

// AWBs eligible for a NEW pickup request: booked with this courier, not
// yet delivered/returned, and not already covered by an earlier pickup
// request (courier_pickup_request_awbs) — same "not yet acted on" shape
// as Pending Orders' own "not yet booked" definition.
//
// 2026-09-10 perf fix — this used to be `getPickupCandidateAwbs(...,
// courier)`, called once PER COURIER (6x) from courier-booking/page.tsx as
// a SEPARATE `Promise.all` after the page's main data-fetch had already
// resolved (a fully avoidable extra sequential round-trip on every load).
// Each of those 6 calls also independently re-scanned `order_shipments`
// with an unindexable leading-wildcard `ILIKE '%courier%'` and no
// `.limit()`/company scoping in the query itself — 6 near-full-table
// scans on every visit to a page the user also wants near-live
// auto-refresh on (which would repeat this cost every 10-20s). This does
// the exact same match — a courier key as a case-insensitive substring of
// the free-text `courier_name` column (that column has no CHECK
// constraint; see BRAIN.md §4's `source`-discriminator note for the same
// "free text, matched by convention" shape) — but as ONE base query plus
// ONE round of follow-up lookups, partitioned per courier in memory
// afterward. Row-for-row output is unchanged; only the query COUNT
// dropped (was 6 base + up to 24 follow-up queries, now 1 base + 4
// follow-up), and the base query now has a `.limit()` as a safety cap.
export async function getPickupCandidatesForAllCouriers(
  supabase: ServiceClient,
  companyIds: string[]
): Promise<PickupCandidatesByCourier> {
  const result = Object.fromEntries(COURIERS.map((c) => [c.key, [] as PickupCandidateAwb[]])) as PickupCandidatesByCourier;

  const { data: shipments } = await supabase
    .from("order_shipments")
    .select("id, order_id, awb_no, courier_name")
    .not("awb_no", "is", null)
    .not("courier_name", "is", null)
    .is("delivered_status", null)
    .limit(2000);
  if (!shipments || shipments.length === 0) return result;

  const shipmentIds = shipments.map((s) => s.id);
  const orderIds = Array.from(new Set(shipments.map((s) => s.order_id)));

  const [{ data: alreadyRequested }, { data: orders }, { data: courierShipments }, { data: packages }] = await Promise.all([
    supabase.from("courier_pickup_request_awbs").select("order_shipment_id").in("order_shipment_id", shipmentIds),
    supabase.from("orders").select("id, ref_no, buyer_name_address, order_value_inr, company_id").in("id", orderIds).in("company_id", companyIds),
    // Not filtered by `.eq("courier", courier)` any more since this now
    // covers every courier in one pass — keyed below by order_id+courier
    // together instead, the same exactness the old per-courier filter gave
    // (an order can have courier_shipments rows for more than one courier
    // over its lifetime if it was rebooked).
    supabase.from("courier_shipments").select("order_id, courier, service_code").in("order_id", orderIds),
    supabase.from("order_packages").select("order_shipment_id, weight_kg").in("order_shipment_id", shipmentIds).eq("package_no", 1),
  ]);

  const requestedIds = new Set((alreadyRequested ?? []).map((r) => r.order_shipment_id));
  const orderById = new Map((orders ?? []).map((o) => [o.id, o]));
  const weightByShipment = new Map((packages ?? []).map((p) => [p.order_shipment_id, p.weight_kg]));
  const serviceByOrderAndCourier = new Map((courierShipments ?? []).map((c) => [`${c.order_id}:${c.courier}`, c.service_code]));

  for (const s of shipments) {
    if (requestedIds.has(s.id)) continue;
    const order = orderById.get(s.order_id);
    if (!order) continue; // not in a company this employee can see
    const nameLower = (s.courier_name ?? "").toLowerCase();
    for (const c of COURIERS) {
      // Same case-insensitive substring match `ILIKE '%courier%'` did before.
      if (!nameLower.includes(c.key)) continue;
      result[c.key].push({
        orderShipmentId: s.id,
        orderId: s.order_id,
        refNo: order.ref_no,
        awbNo: s.awb_no!,
        serviceCode: serviceByOrderAndCourier.get(`${s.order_id}:${c.key}`) ?? null,
        buyerNameAddress: order.buyer_name_address,
        totalPriceInr: order.order_value_inr,
        weightKg: weightByShipment.get(s.id) ?? null,
      });
    }
  }
  return result;
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
