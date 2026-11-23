// 2026-11-23 — extracted from orders/[id]/shipping-actions.ts so the Bulk
// Courier Tracking Update CSV can mirror an AWB onto Track Shipments too.
//
// Courier Ops → Track Shipments reads `courier_shipments` ONLY. A tracking
// number entered by hand used to be written to `order_shipments` alone (the
// order page form) — and the bulk CSV still did — which is exactly the
// reported "manual tracking update yaha update kyu nahi ho rahi": the order
// page showed the AWB while Track Shipments showed nothing at all (or an old
// cancelled booking attempt).
//
// Rules (unchanged from the original):
//  • a row owned by a real courier API booking is never rewritten;
//  • an existing row carrying a DIFFERENT AWB is left alone — unless that row
//    is a dead (failed/cancelled) attempt, which a real AWB revives;
//  • forwarding_no is read/written tolerantly so a database without
//    db/2026-10-26-order-shipment-forwarding-no.sql still saves the AWB.
import type { createServiceRoleClient } from "@/lib/supabase/server";
import { isMissingSchemaPiece, tolerateMissingColumn } from "@/lib/db/missing-column";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

const KNOWN_COURIERS = ["fedex", "ups", "aramex", "delhivery", "shiprocket", "dhl"] as const;
export type CourierRowKey = (typeof KNOWN_COURIERS)[number] | "other";

/** Free-text courier → the courier_shipments.courier value (substring match). */
export function courierRowForName(courierName: string | null): {
  courier: CourierRowKey;
  manual_courier_name: string | null;
} {
  const name = (courierName ?? "").trim();
  const lower = name.toLowerCase();
  const known = KNOWN_COURIERS.find((k) => lower.includes(k));
  if (known) return { courier: known, manual_courier_name: null };
  return { courier: "other", manual_courier_name: name || null };
}

export async function syncCourierShipmentRow(
  supabase: ServiceClient,
  args: {
    orderId: string;
    orderShipmentId: string;
    awbNo: string | null;
    forwardingNo?: string | null;
    courierName: string | null;
    employeeId: string;
  }
): Promise<string | null> {
  if (!args.awbNo && !args.courierName && !args.forwardingNo) return null;
  const mapped = courierRowForName(args.courierName);

  type CourierRow = {
    id: string;
    courier: string;
    status: string;
    awb_no: string | null;
    forwarding_no: string | null;
    booked_amount_source: string | null;
  };
  let rows: CourierRow[] | null = null;
  const full = await supabase
    .from("courier_shipments")
    .select("id, courier, status, awb_no, forwarding_no, booked_amount_source")
    .eq("order_id", args.orderId);
  if (full.error && isMissingSchemaPiece(full.error)) {
    const base = await supabase
      .from("courier_shipments")
      .select("id, courier, status, awb_no, booked_amount_source")
      .eq("order_id", args.orderId);
    rows = (base.data ?? []).map((r) => ({ ...r, forwarding_no: null }));
  } else if (full.error) {
    return full.error.message;
  } else {
    rows = full.data;
  }

  const sameCourier = (rows ?? []).find((r) => r.courier === mapped.courier) ?? null;
  if (sameCourier) {
    // 2026-11-23 — a FAILED / CANCELLED booking attempt keeps its dead status
    // forever otherwise, so Track Shipments showed "cancelled" even though
    // the parcel was shipped on a manually entered AWB ("EPO-002 Booking
    // cancelled dikha raha hai jabki tracking dal di"). A real AWB now revives
    // that same row (there is one row per order+courier, UNIQUE constraint).
    const dead = sameCourier.status === "failed" || sameCourier.status === "cancelled";
    if (!dead && sameCourier.booked_amount_source === "api") return null;
    if (!dead && sameCourier.awb_no && args.awbNo && sameCourier.awb_no !== args.awbNo) return null;
    const { error: updateError } = await tolerateMissingColumn(
      {
        order_shipment_id: args.orderShipmentId,
        awb_no: args.awbNo ?? sameCourier.awb_no,
        // never blanks a forwarding no. that came from a real API booking
        forwarding_no: args.forwardingNo ?? sameCourier.forwarding_no,
        manual_courier_name: mapped.manual_courier_name,
        ...(dead && args.awbNo ? { status: "created" as const } : {}),
      },
      "forwarding_no",
      (patch) => supabase.from("courier_shipments").update(patch).eq("id", sameCourier.id)
    );
    return updateError?.message ?? null;
  }

  const sameAwb = args.awbNo ? (rows ?? []).find((r) => r.awb_no === args.awbNo) ?? null : null;
  if (sameAwb) {
    const { error: updateError } = await tolerateMissingColumn(
      {
        order_shipment_id: args.orderShipmentId,
        ...(args.forwardingNo ? { forwarding_no: args.forwardingNo } : {}),
      },
      "forwarding_no",
      (patch) => supabase.from("courier_shipments").update(patch).eq("id", sameAwb.id)
    );
    return updateError?.message ?? null;
  }

  const { error: insertError } = await tolerateMissingColumn(
    {
      courier: mapped.courier,
      manual_courier_name: mapped.manual_courier_name,
      order_id: args.orderId,
      order_shipment_id: args.orderShipmentId,
      status: "created" as const,
      awb_no: args.awbNo,
      forwarding_no: args.forwardingNo ?? null,
      booked_amount_source: "manual" as const,
      created_by: args.employeeId,
    },
    "forwarding_no",
    (payload) => supabase.from("courier_shipments").insert(payload)
  );
  return insertError?.message ?? null;
}
