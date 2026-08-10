// Delhivery push webhook ("Tracking Via PUSH API"). Delhivery lets you
// configure a static header (they call it a callback "Authorization"
// header) sent with every POST to your registered URL — there is no
// per-request HMAC/crypto signature documented for this product, unlike
// UPS's OAuth bearer scheme or a typical HMAC webhook. So auth here is a
// plain shared-secret header comparison (still timing-safe), not a
// signature check.
//
// SETUP: in Delhivery's dashboard, register this URL as your push webhook
// callback, and set the custom header they send to
// `Authorization: Bearer <DELHIVERY_WEBHOOK_TOKEN>` (generate a random
// token, put it in both places).
//
// Payload shape (Delhivery's Package Lifecycle / PUSH API docs):
//   { "Shipment": { "AWB": "...", "ReferenceNo": "...",
//       "Status": { "Status": "In Transit", "StatusDateTime": "...",
//                   "StatusType": "UD" | "DL" | "RT" | "PP" | "PU" | "CN" } } }
// StatusType is the reliable machine-readable field — StatusType
// documentation: UD=forward-in-transit/undelivered, DL=delivered,
// RT=returned to origin, PP/PU/CN=reverse-pickup pending/picked/cancelled
// (not relevant to forward-shipment tracking, mapped to OTHER here).

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
  const expected = process.env.DELHIVERY_WEBHOOK_TOKEN;
  if (!expected) return false;
  const header = req.headers.get("authorization") ?? "";
  const provided = header.replace(/^Bearer\s+/i, "");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function bucketFromStatusType(statusType: string): TrackingBucket {
  switch (statusType.toUpperCase()) {
    case "DL":
      return "DELIVERED";
    case "RT":
      return "RTO";
    case "UD":
      return "IN_TRANSIT";
    default:
      return "OTHER"; // PP/PU/CN (reverse-pickup lifecycle) and anything unrecognized
  }
}

type DelhiveryPayload = {
  Shipment?: {
    AWB?: string;
    Status?: { Status?: string; StatusDateTime?: string; StatusType?: string };
  };
};

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: DelhiveryPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();
  const awbNo = payload.Shipment?.AWB ?? null;
  const logId = await logCourierWebhook(supabase, "Delhivery", awbNo, payload);

  const statusType = payload.Shipment?.Status?.StatusType;
  if (!awbNo || !statusType) {
    await markCourierWebhookError(supabase, logId, "Missing Shipment.AWB or Shipment.Status.StatusType in payload.");
    return NextResponse.json({ error: "Unrecognized payload shape" }, { status: 422 });
  }

  const bucket = bucketFromStatusType(statusType);
  const deliveredDate =
    bucket === "DELIVERED" && payload.Shipment?.Status?.StatusDateTime
      ? payload.Shipment.Status.StatusDateTime.slice(0, 10)
      : null;

  const { matched } = await applyTrackingEvent(supabase, {
    awbNo,
    bucket,
    deliveredDate,
    rawStatusText: payload.Shipment?.Status?.Status ?? null,
  });

  if (!matched) {
    await markCourierWebhookError(supabase, logId, `No dispatch_invoices row found for AWB ${awbNo}`);
    return NextResponse.json({ status: "logged_unmatched" });
  }

  await markCourierWebhookProcessed(supabase, logId);
  return NextResponse.json({ status: "processed" });
}
