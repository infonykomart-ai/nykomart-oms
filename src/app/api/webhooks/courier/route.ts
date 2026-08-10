// Real-time tracking updates FROM the courier, instead of only finding out
// delivery status when the monthly courier bill PDF gets uploaded and
// parsed (see src/lib/courier-bills/). Each courier has its own webhook
// payload shape and its own signature-verification scheme — the mapping
// below is where that gets normalized. Every payload is logged to
// courier_webhook_log BEFORE any processing, so nothing is ever lost even
// if the mapping/parsing below has a bug — you can always look at
// courier_webhook_log and reprocess.
//
// SETUP PER COURIER (do this once you pick which courier(s) to wire up):
//   1. In the courier's dashboard, set the webhook URL to
//      https://<your-domain>/api/webhooks/courier
//   2. Get their webhook signing secret, put it in COURIER_WEBHOOK_SECRET
//   3. Fill in verifySignature() + extractTracking() for that courier's
//      actual payload shape (every courier's docs differ — placeholders
//      below assume a generic {awb_no, status, delivered_date} shape).

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

function verifySignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader || !process.env.COURIER_WEBHOOK_SECRET) return false;
  const expected = crypto
    .createHmac("sha256", process.env.COURIER_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  // timingSafeEqual requires equal-length buffers — guard against a
  // mismatched-length header throwing instead of just failing the check.
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

type NormalizedTrackingEvent = {
  awbNo: string;
  courierStatus: "IN_TRANSIT" | "DELIVERED" | "RTO" | "LOST" | "OTHER";
  deliveredDate: string | null;
};

// Placeholder mapping — replace with the real courier's payload shape.
function extractTracking(payload: Record<string, unknown>): NormalizedTrackingEvent | null {
  const awbNo = payload.awb_no ?? payload.waybill ?? payload.tracking_number;
  if (!awbNo || typeof awbNo !== "string") return null;

  const rawStatus = String(payload.status ?? "").toUpperCase();
  const courierStatus: NormalizedTrackingEvent["courierStatus"] = rawStatus.includes("DELIVER")
    ? "DELIVERED"
    : rawStatus.includes("RTO") || rawStatus.includes("RETURN")
      ? "RTO"
      : rawStatus.includes("LOST")
        ? "LOST"
        : rawStatus
          ? "IN_TRANSIT"
          : "OTHER";

  return {
    awbNo,
    courierStatus,
    deliveredDate: typeof payload.delivered_date === "string" ? payload.delivered_date : null,
  };
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-webhook-signature");

  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  // Log first, unconditionally — this row is the source of truth even if
  // everything below fails.
  const { data: logRow } = await supabase
    .from("courier_webhook_log")
    .insert({
      courier_name: String(payload.courier_name ?? req.headers.get("x-courier-name") ?? "unknown"),
      awb_no: typeof payload.awb_no === "string" ? payload.awb_no : null,
      raw_payload: payload as Json,
    })
    .select("id")
    .single();

  const event = extractTracking(payload);
  if (!event) {
    if (logRow) {
      await supabase
        .from("courier_webhook_log")
        .update({ error_message: "Could not extract awb_no/status from payload" })
        .eq("id", logRow.id);
    }
    return NextResponse.json({ error: "Unrecognized payload shape" }, { status: 422 });
  }

  // dispatch_invoices.awb_no is the existing link (same field
  // src/lib/courier-bills/match.ts already matches on) — update the
  // existing row rather than creating anything new.
  const { data: dispatchInvoice, error: findError } = await supabase
    .from("dispatch_invoices")
    .select("id, order_id")
    .ilike("awb_no", event.awbNo)
    .maybeSingle();

  if (findError || !dispatchInvoice) {
    if (logRow) {
      await supabase
        .from("courier_webhook_log")
        .update({ error_message: `No dispatch_invoices row found for AWB ${event.awbNo}` })
        .eq("id", logRow.id);
    }
    // 200, not an error status — an unmatched AWB is a normal occurrence
    // (e.g. webhook arrives before dispatch entry is made), not a bug on
    // either side. It stays in courier_webhook_log unprocessed=false for
    // manual/later reprocessing.
    return NextResponse.json({ status: "logged_unmatched" });
  }

  const delivered = event.courierStatus === "DELIVERED";

  await supabase
    .from("dispatch_invoices")
    .update({
      delivered_status: delivered ? "Delivered" : undefined,
      delivered_date: event.deliveredDate,
      last_update_date: new Date().toISOString().slice(0, 10),
    })
    .eq("id", dispatchInvoice.id);

  if (delivered) {
    await supabase.from("orders").update({ shipment_status: "Delivered" }).eq("id", dispatchInvoice.order_id);
  }

  if (logRow) {
    await supabase
      .from("courier_webhook_log")
      .update({ processed: true, processed_at: new Date().toISOString() })
      .eq("id", logRow.id);
  }

  return NextResponse.json({ status: "processed" });
}
