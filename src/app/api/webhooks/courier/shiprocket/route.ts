// Shiprocket push webhook. Researched before building (Shiprocket is one
// of the 7 couriers the user actually uses, and India's most common
// shipping aggregator) — findings, with confidence levels, from official
// apidocs.shiprocket.in + Shiprocket support articles + 2 corroborating
// third-party integration guides:
//
// SETUP: Shiprocket dashboard → Settings → API → Webhooks → paste this
// route's full URL, enable it, and set a "security token" — Shiprocket
// sends that token back as an `x-api-key` header on every POST. Their own
// docs say this token is "not mandatory," but we require it here (a
// webhook with no possible auth is a bigger risk than a slightly stricter
// setup). NOTE: Shiprocket's docs explicitly warn not to use the words
// "shiprocket", "kartrocket", "sr", or "kr" anywhere in the webhook URL
// itself — keep that in mind if this route is ever renamed/aliased.
//
// PAYLOAD SHAPE — UNCONFIRMED, HIGHEST-RISK PART OF THIS FILE: no official
// sample JSON payload could be found (their Postman docs are JS-rendered
// and didn't return a body to fetch). What follows is inferred from
// Shiprocket's own prose description of the webhook + their polling API's
// known shape (which DOES have confirmed field names), not a verified
// example. Parsing below is deliberately defensive — checks several
// plausible field-name variants for AWB and status rather than assuming
// one exact shape — and the FULL raw payload is always logged to
// courier_webhook_log regardless of whether parsing succeeds, so the
// first real webhook Shiprocket sends can be inspected there and this
// file adjusted to match, the same way UPS's envelope was flagged as
// uncertain in its own route file.
//
// Status STRINGS (not numeric codes — no official numeric status-id table
// was found) confirmed from "Important Terms All Shiprocket Users Should
// Know": Pickup Scheduled, Picked Up, In-Transit, Out for Delivery,
// Delivered, Undelivered/NDR, RTO Initiated, RTO-OFD, RTO-NDR,
// RTO Delivered, Lost/Damaged.

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  applyTrackingEvent,
  logCourierWebhook,
  markCourierWebhookError,
  markCourierWebhookProcessed,
  type TrackingBucket,
} from "@/lib/courier-webhooks/apply-tracking-event";

function checkAuth(req: NextRequest): boolean {
  const expected = process.env.SHIPROCKET_WEBHOOK_TOKEN;
  if (!expected) return false;
  const provided = req.headers.get("x-api-key") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Match on the status STRING (case-insensitive, substring-tolerant —
// Shiprocket's own docs don't nail down exact casing/whitespace), not a
// numeric code, per the research above.
function bucketFromStatusText(statusText: string): TrackingBucket {
  const s = statusText.toLowerCase();
  if (s.includes("rto")) return "RTO"; // RTO Initiated, RTO-OFD, RTO-NDR, RTO Delivered — all contain "rto"
  if (s.includes("lost") || s.includes("damage")) return "LOST";
  if (s.includes("delivered")) return "DELIVERED"; // checked after "rto" so "RTO Delivered" doesn't misclassify as DELIVERED
  if (
    s.includes("in-transit") ||
    s.includes("in transit") ||
    s.includes("picked up") ||
    s.includes("pickup") ||
    s.includes("out for delivery")
  ) {
    return "IN_TRANSIT";
  }
  return "OTHER"; // Undelivered/NDR and anything unrecognized — routed to manual follow-up, see apply-tracking-event.ts
}

// Field names below are best-guesses per the header comment — every
// plausible variant is checked so a live payload has the best chance of
// parsing correctly on the first real webhook, before this can be
// confirmed against actual traffic.
function firstString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const body = (payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {}) as Record<
    string,
    unknown
  >;
  // Some webhook providers nest the real event under a `data`/`shipment`
  // wrapper — check one level down too, in case Shiprocket does the same.
  const nested = (body.data ?? body.shipment ?? body.shipment_track ?? {}) as Record<string, unknown>;

  const awbNo = firstString(body, ["awb", "awb_code", "awb_number", "AWB"]) ?? firstString(nested, ["awb", "awb_code", "awb_number", "AWB"]);
  const logId = await logCourierWebhook(supabase, "Shiprocket", awbNo, body);

  const statusText =
    firstString(body, ["current_status", "status", "current_status_name", "shipment_status"]) ??
    firstString(nested, ["current_status", "status", "current_status_name", "shipment_status"]);

  if (!awbNo || !statusText) {
    await markCourierWebhookError(
      supabase,
      logId,
      "Could not find an AWB + status field in the payload under any known field-name variant — inspect raw_payload in courier_webhook_log and update this route's parsing."
    );
    return NextResponse.json({ error: "Unrecognized payload shape" }, { status: 422 });
  }

  const bucket = bucketFromStatusText(statusText);
  const deliveredDateRaw =
    firstString(body, ["delivered_date", "pod_date", "event_time", "updated_at"]) ??
    firstString(nested, ["delivered_date", "pod_date", "event_time", "updated_at"]);
  const deliveredDate = bucket === "DELIVERED" && deliveredDateRaw ? deliveredDateRaw.slice(0, 10) : null;

  const { matched } = await applyTrackingEvent(supabase, {
    awbNo,
    bucket,
    deliveredDate,
    rawStatusText: statusText,
  });

  if (!matched) {
    await markCourierWebhookError(supabase, logId, `No dispatch_invoices row found for AWB ${awbNo}`);
    return NextResponse.json({ status: "logged_unmatched" });
  }

  await markCourierWebhookProcessed(supabase, logId);
  return NextResponse.json({ status: "processed" });
}
