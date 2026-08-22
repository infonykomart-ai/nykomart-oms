// UPS Track Alert push webhook. See ./token/route.ts for the paired OAuth2
// token endpoint UPS calls first — this route verifies the bearer token
// that call issues, then processes the actual tracking event.
//
// Payload shape (UPS Track Alert / Tracking API, UPSTrackAlertEnhanced.yaml
// on UPS's public api-documentation repo):
//   { "trackingNumber": "1Z...",
//     "activityStatus": { "type": "D"|"I"|"M"|"MV"|"U"|"X", "code": "...", "description": "..." },
//     "scheduledDeliveryDate": "YYYYMMDD",
//     "actualDeliveryDate": "YYYYMMDD", "actualDeliveryTime": "HHMMSS" }
// activityStatus.type: D=Delivery, I=On the Way (in transit), M=Manifest,
// MV=Manifest Void, U=Updated delivery time, X=Exception (covers BOTH
// "returned to shipper" and genuine loss/damage — UPS doesn't split these
// at the `type` level, only in `description` text, so RTO detection here
// falls back to a text match on `description`; anything under type X that
// doesn't match "return" is left as OTHER rather than guessed as LOST).
//
// NOTE: UPS may wrap this in an envelope (e.g. `{ "trackingEvent": {...} }`)
// depending on subscription config — handled below by unwrapping if present,
// since the exact top-level shape isn't fully nailed down from public docs
// alone. Worth checking courier_webhook_log's raw_payload against this once
// live traffic arrives, and adjusting the unwrap logic if UPS's real
// payload differs.

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { verifyUpsToken } from "./token/route";
import {
  applyTrackingEvent,
  logCourierWebhook,
  markCourierWebhookError,
  markCourierWebhookProcessed,
  type TrackingBucket,
} from "@/lib/courier-webhooks/apply-tracking-event";

type UpsActivityStatus = { type?: string; code?: string; description?: string };
type UpsTrackingEvent = {
  trackingNumber?: string;
  activityStatus?: UpsActivityStatus;
  actualDeliveryDate?: string; // YYYYMMDD
};

function bucketFromActivityStatus(status: UpsActivityStatus | undefined): TrackingBucket {
  const type = (status?.type ?? "").toUpperCase();
  if (type === "D") return "DELIVERED";
  if (type === "I" || type === "M" || type === "U") return "IN_TRANSIT";
  if (type === "X") {
    const desc = (status?.description ?? "").toLowerCase();
    if (desc.includes("return")) return "RTO";
    return "OTHER"; // could be a genuine exception/loss — no clean UPS signal to tell apart, see header comment
  }
  return "OTHER"; // MV (manifest void) and anything unrecognized
}

function yyyymmddToIso(d: string | undefined): string | null {
  if (!d || d.length !== 8) return null;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token || !verifyUpsToken(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Unwrap a possible `{ trackingEvent: {...} }` envelope — see header note.
  const event: UpsTrackingEvent =
    body && typeof body === "object" && "trackingEvent" in (body as Record<string, unknown>)
      ? ((body as Record<string, unknown>).trackingEvent as UpsTrackingEvent)
      : (body as UpsTrackingEvent);

  const supabase = createServiceRoleClient();
  const awbNo = event?.trackingNumber ?? null;
  const logId = await logCourierWebhook(supabase, "UPS", awbNo, body);

  if (!awbNo || !event?.activityStatus?.type) {
    await markCourierWebhookError(supabase, logId, "Missing trackingNumber or activityStatus.type in payload.");
    return NextResponse.json({ error: "Unrecognized payload shape" }, { status: 422 });
  }

  const bucket = bucketFromActivityStatus(event.activityStatus);
  const deliveredDate = bucket === "DELIVERED" ? yyyymmddToIso(event.actualDeliveryDate) : null;

  const { matched } = await applyTrackingEvent(supabase, {
    awbNo,
    bucket,
    deliveredDate,
    rawStatusText: event.activityStatus?.description ?? null,
  });

  if (!matched) {
    await markCourierWebhookError(supabase, logId, `No order_shipments row found for AWB ${awbNo}`);
    return NextResponse.json({ status: "logged_unmatched" });
  }

  await markCourierWebhookProcessed(supabase, logId);
  return NextResponse.json({ status: "processed" });
}
