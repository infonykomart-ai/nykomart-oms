// Data-fetch for the rich Shipment Detail page (EGS-integration round,
// 2026-09-04 — mirrors EGS's Shipment History Detail page). Server-only,
// no "use server" (a read, called from a Server Component page).
//
// TIMELINE — HONEST SCOPE NOTE: this app has no per-stage-with-timestamp
// history table. What it DOES have, already populated by the existing
// tracking cron/webhooks (src/lib/courier-webhooks/apply-tracking-event.ts,
// src/app/api/cron/poll-fedex-tracking/route.ts, src/app/api/webhooks/
// courier/*) is courier_webhook_log — an append-only log of every raw
// tracking event ever received for an AWB, each with its own received_at
// timestamp and a normalized TrackingBucket-shaped bucket in raw_payload
// (not a first-class column, so inferred here from the same rawStatusText
// heuristics the pollers themselves log). This builds the timeline from
// THAT log, ordered by received_at, plus courier_shipments.created_at as
// "Booked" and order_shipments.delivered_date as "Delivered". It will only
// show real history from whenever webhook/polling coverage started for
// this AWB's courier — an AWB booked before this app's tracking
// infrastructure existed, or for a courier whose polling never matched
// (e.g. a webhook token never configured), will show a thinner timeline.
// This is disclosed on the page itself, not just here.
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { CourierKey } from "@/lib/couriers/credentials";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type TimelineStage = {
  stage: "Booked" | "Picked Up" | "In Transit" | "Delivered" | "RTO" | "Other";
  at: string; // ISO date/timestamp
  detail: string | null; // the courier's own raw status text, when known
};

export type ShipmentChargeInfo = {
  bookedAmt: number | null;
  bookedCurrency: string | null;
  bookedAmountSource: "api" | "rate_card_estimate" | "manual" | null;
  // Only populated once a Freight Bill has actually been entered against
  // this AWB (freight_bill_awb_assignments) — the real courier-billed
  // amount, reconciled against bookedAmt above. NOT populated for most
  // shipments (billing lags booking by weeks in this business), and
  // deliberately never fabricated as a line-item breakdown (FSC/ODA/ESS/
  // duty/clearance/etc. — this schema simply has no such granular data;
  // see the round writeup for the honest reason why).
  billedFreightAmt: number | null;
  billWeightKg: number | null;
  dimensionalWeightKg: number | null;
  differenceAmt: number | null;
  freightBillInvoiceNo: string | null;
};

export type ShipmentDetail = {
  id: string;
  courier: CourierKey | "other";
  courierLabel: string;
  status: "pending" | "created" | "failed" | "cancelled";
  awbNo: string | null;
  labelUrl: string | null;
  serviceCode: string | null;
  ddpDdu: string | null;
  errorMessage: string | null;
  createdAt: string;
  cancelReason: string | null;
  cancelRemark: string | null;
  cancelledAt: string | null;
  charges: ShipmentChargeInfo;
  order: {
    id: string;
    refNo: string;
    buyerNameAddress: string | null;
    contactNo: string | null;
    emailId: string | null;
    destinationCountry: string | null;
    skuLabel: string | null;
    qty: number;
    orderValueOriginal: number | null;
    orderCurrency: string | null;
    orderValueInr: number | null;
    orderValueUsd: number | null;
    vatNumber: string | null;
    eoriNumber: string | null;
    iossNumber: string | null;
    invoiceId: string | null;
    deliveredStatus: "Delivered" | "NOT Delivered" | null;
    deliveredDate: string | null;
  };
  package: { lengthCm: number | null; widthCm: number | null; heightCm: number | null; weightKg: number | null; volumetricWeight: number | null } | null;
  timeline: TimelineStage[];
};

const COURIER_LABELS: Record<CourierKey, string> = {
  fedex: "FedEx",
  ups: "UPS",
  aramex: "Aramex",
  delhivery: "Delhivery",
  shiprocket: "Shiprocket",
  dhl: "DHL Express",
};

function bucketFromRawStatusText(text: string | null): TimelineStage["stage"] {
  if (!text) return "Other";
  const t = text.toLowerCase();
  if (t.includes("deliver")) return "Delivered";
  if (t.includes("rto") || t.includes("return")) return "RTO";
  if (t.includes("picked") || t.includes("pickup") || t.includes("pick-up")) return "Picked Up";
  if (t.includes("transit") || t.includes("out for") || t.includes("departed") || t.includes("arrived")) return "In Transit";
  return "Other";
}

export async function getShipmentDetail(supabase: ServiceClient, companyIds: string[], courierShipmentId: string): Promise<ShipmentDetail | null> {
  const { data: shipment } = await supabase
    .from("courier_shipments")
    .select(
      "id, courier, manual_courier_name, order_id, order_shipment_id, service_code, ddp_ddu, status, awb_no, label_url, booked_amt, booked_currency, booked_amount_source, error_message, created_at, cancel_reason, cancel_remark, cancelled_at"
    )
    .eq("id", courierShipmentId)
    .maybeSingle();
  if (!shipment) return null;

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, ref_no, buyer_name_address, contact_no, email_id, destination_country, sku_label, qty, order_value_original, order_currency, order_value_inr, order_value_usd, vat_number, eori_number, ioss_number, invoice_id, company_id"
    )
    .eq("id", shipment.order_id)
    .in("company_id", companyIds)
    .maybeSingle();
  if (!order) return null; // not in a company this employee can see

  const [{ data: orderShipment }, { data: webhookEvents }] = await Promise.all([
    shipment.order_shipment_id
      ? supabase.from("order_shipments").select("id, delivered_status, delivered_date").eq("id", shipment.order_shipment_id).maybeSingle()
      : Promise.resolve({ data: null }),
    shipment.awb_no
      ? supabase.from("courier_webhook_log").select("received_at, raw_payload, error_message").ilike("awb_no", shipment.awb_no).order("received_at", { ascending: true })
      : Promise.resolve({ data: [] as { received_at: string; raw_payload: unknown; error_message: string | null }[] }),
  ]);

  const orderPackage = shipment.order_shipment_id
    ? (await supabase.from("order_packages").select("length_cm, width_cm, height_cm, weight_kg, volumetric_weight").eq("order_shipment_id", shipment.order_shipment_id).eq("package_no", 1).maybeSingle()).data
    : null;

  // Plain queries, not an embedded-resource join — see tracking-data.ts's
  // own comment on why this codebase's hand-rolled Database type doesn't
  // emit Relationships metadata for join shapes (`freight_bills(...)`
  // would type as `never`).
  const freightAssignment = shipment.order_shipment_id
    ? (
        await supabase
          .from("freight_bill_awb_assignments")
          .select("billed_freight_amt, bill_weight_kg, dimensional_weight_kg, difference_amt, freight_bill_id")
          .eq("order_shipment_id", shipment.order_shipment_id)
          .maybeSingle()
      ).data
    : null;
  const freightBillInvoiceNo = freightAssignment?.freight_bill_id
    ? (await supabase.from("freight_bills").select("invoice_no").eq("id", freightAssignment.freight_bill_id).maybeSingle()).data?.invoice_no ?? null
    : null;

  // Timeline: Booked (always) + one entry per distinct stage transition
  // found in courier_webhook_log (first occurrence of each stage only —
  // a long-running IN_TRANSIT AWB might log the same bucket dozens of
  // times, only the first is a real "stage reached" moment) + Delivered
  // from order_shipments if that's more authoritative than the log.
  const courierLabel = shipment.courier === "other" ? shipment.manual_courier_name ?? "Other (manual)" : COURIER_LABELS[shipment.courier as CourierKey] ?? shipment.courier;
  const timeline: TimelineStage[] = [{ stage: "Booked", at: shipment.created_at, detail: `Booking created with ${courierLabel}` }];
  const seenStages = new Set<string>();
  for (const event of webhookEvents ?? []) {
    if (event.error_message) continue; // a parse-error log row carries no real status
    const payload = event.raw_payload as Record<string, unknown> | null;
    const rawText =
      (payload && typeof payload === "object" && "description" in payload && typeof payload.description === "string" && payload.description) ||
      (payload && typeof payload === "object" && "updateDescription" in payload && typeof payload.updateDescription === "string" && payload.updateDescription) ||
      null;
    const stage = bucketFromRawStatusText(rawText);
    if (stage === "Other" || seenStages.has(stage)) continue;
    seenStages.add(stage);
    timeline.push({ stage, at: event.received_at, detail: rawText });
  }
  if (orderShipment?.delivered_status === "Delivered" && !seenStages.has("Delivered")) {
    timeline.push({ stage: "Delivered", at: orderShipment.delivered_date ?? shipment.created_at, detail: "Marked Delivered" });
  }
  timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  return {
    id: shipment.id,
    courier: shipment.courier as CourierKey | "other",
    courierLabel,
    status: shipment.status as ShipmentDetail["status"],
    awbNo: shipment.awb_no,
    labelUrl: shipment.label_url,
    serviceCode: shipment.service_code,
    ddpDdu: shipment.ddp_ddu,
    errorMessage: shipment.error_message,
    createdAt: shipment.created_at,
    cancelReason: shipment.cancel_reason,
    cancelRemark: shipment.cancel_remark,
    cancelledAt: shipment.cancelled_at,
    charges: {
      bookedAmt: shipment.booked_amt,
      bookedCurrency: shipment.booked_currency,
      bookedAmountSource: shipment.booked_amount_source as ShipmentChargeInfo["bookedAmountSource"],
      billedFreightAmt: freightAssignment?.billed_freight_amt ?? null,
      billWeightKg: freightAssignment?.bill_weight_kg ?? null,
      dimensionalWeightKg: freightAssignment?.dimensional_weight_kg ?? null,
      differenceAmt: freightAssignment?.difference_amt ?? null,
      freightBillInvoiceNo,
    },
    order: {
      id: order.id,
      refNo: order.ref_no,
      buyerNameAddress: order.buyer_name_address,
      contactNo: order.contact_no,
      emailId: order.email_id,
      destinationCountry: order.destination_country,
      skuLabel: order.sku_label,
      qty: order.qty,
      orderValueOriginal: order.order_value_original,
      orderCurrency: order.order_currency,
      orderValueInr: order.order_value_inr,
      orderValueUsd: order.order_value_usd,
      vatNumber: order.vat_number,
      eoriNumber: order.eori_number,
      iossNumber: order.ioss_number,
      invoiceId: order.invoice_id,
      deliveredStatus: orderShipment?.delivered_status ?? null,
      deliveredDate: orderShipment?.delivered_date ?? null,
    },
    package: orderPackage
      ? { lengthCm: orderPackage.length_cm, widthCm: orderPackage.width_cm, heightCm: orderPackage.height_cm, weightKg: orderPackage.weight_kg, volumetricWeight: orderPackage.volumetric_weight }
      : null,
    timeline,
  };
}
