// FedEx tracking — POLLING, not a webhook. Researched before building this:
// FedEx's true push mechanism ("Advanced Integrated Visibility" tracking-
// number subscription) exists but requires FedEx account-rep approval and
// its payload schema isn't publicly documented — not something that can be
// wired up sight-unseen the way Delhivery's and UPS's push webhooks were
// (see src/app/api/webhooks/courier/delhivery and .../ups). FedEx's
// self-serve "Track API" (developer.fedex.com) is polling-only, so this
// cron job is the honest equivalent: Vercel Cron hits this on a schedule,
// it looks up every not-yet-delivered dispatch_invoices row with
// courier_name = FedEx, batches their AWBs into FedEx's Track API, and
// applies whatever status comes back through the SAME applyTrackingEvent()
// helper the two real webhooks use — so downstream (orders.shipment_status,
// dispatch_invoices.delivered_status) behaves identically regardless of
// push vs. poll. If FedEx ever grants AIV subscription access, replace
// this with a real webhook route following the Delhivery/UPS pattern and
// this cron can be retired.
//
// SECURITY: same bearer-token pattern as sync-orders — only callable with
// `Authorization: Bearer $CRON_SECRET`.
//
// FedEx OAuth2 (client_credentials) + Track API docs:
// https://developer.fedex.com/api/en-us/catalog/track.html

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  applyTrackingEvent,
  logCourierWebhook,
  markCourierWebhookError,
  markCourierWebhookProcessed,
  type TrackingBucket,
} from "@/lib/courier-webhooks/apply-tracking-event";

export const maxDuration = 60;

const FEDEX_API_BASE = process.env.FEDEX_API_BASE_URL || "https://apis.fedex.com";
const BATCH_SIZE = 30; // FedEx Track API's documented max trackingInfo entries per request

function bucketFromFedexCode(code: string): TrackingBucket {
  switch (code.toUpperCase()) {
    case "DL":
      return "DELIVERED";
    case "RS":
      return "RTO";
    case "OC":
    case "PU":
    case "AR":
    case "AF":
    case "DP":
    case "IT":
    case "OD":
      return "IN_TRANSIT";
    default:
      return "OTHER"; // CA (cancelled), DE/EA/SE (exceptions) — no clean LOST signal, see header comment
  }
}

async function getFedexAccessToken(): Promise<string> {
  const clientId = process.env.FEDEX_API_CLIENT_ID;
  const clientSecret = process.env.FEDEX_API_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("FEDEX_API_CLIENT_ID / FEDEX_API_CLIENT_SECRET are not set.");
  }

  const res = await fetch(`${FEDEX_API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) {
    throw new Error(`FedEx OAuth token request failed ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

type FedexTrackResult = {
  trackingNumberInfo?: { trackingNumber?: string };
  latestStatusDetail?: { code?: string; description?: string };
  dateAndTimes?: Array<{ type?: string; dateTime?: string }>;
};

async function fetchFedexBatch(accessToken: string, awbNos: string[]): Promise<FedexTrackResult[]> {
  const res = await fetch(`${FEDEX_API_BASE}/track/v1/trackingnumbers`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-locale": "en_US",
    },
    body: JSON.stringify({
      includeDetailedScans: false,
      trackingInfo: awbNos.map((n) => ({ trackingNumberInfo: { trackingNumber: n } })),
    }),
  });
  if (!res.ok) {
    throw new Error(`FedEx Track API request failed ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as {
    output?: { completeTrackResults?: Array<{ trackResults?: FedexTrackResult[] }> };
  };
  return (data.output?.completeTrackResults ?? []).flatMap((r) => r.trackResults ?? []);
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();

  const { data: pending, error: fetchError } = await supabase
    .from("dispatch_invoices")
    .select("awb_no")
    .ilike("courier_name", "%fedex%")
    .not("awb_no", "is", null)
    .is("delivered_status", null); // NOT yet marked Delivered — see delivered_status enum ('Delivered','NOT Delivered')

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  const awbNos = Array.from(new Set((pending ?? []).map((r) => r.awb_no).filter((a): a is string => !!a)));
  if (awbNos.length === 0) {
    return NextResponse.json({ polled: 0, matched: 0, updated: 0 });
  }

  let accessToken: string;
  try {
    accessToken = await getFedexAccessToken();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  let polled = 0;
  let matched = 0;
  let updated = 0;
  const errors: string[] = [];

  for (let i = 0; i < awbNos.length; i += BATCH_SIZE) {
    const batch = awbNos.slice(i, i + BATCH_SIZE);
    let results: FedexTrackResult[];
    try {
      results = await fetchFedexBatch(accessToken, batch);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      continue;
    }

    for (const result of results) {
      polled += 1;
      const awbNo = result.trackingNumberInfo?.trackingNumber;
      const code = result.latestStatusDetail?.code;
      const logId = await logCourierWebhook(supabase, "FedEx", awbNo ?? null, result);

      if (!awbNo || !code) {
        await markCourierWebhookError(supabase, logId, "Missing trackingNumber or latestStatusDetail.code in FedEx response.");
        continue;
      }

      const bucket = bucketFromFedexCode(code);
      const deliveredEvent = result.dateAndTimes?.find((d) => d.type === "ACTUAL_DELIVERY");
      const deliveredDate = bucket === "DELIVERED" && deliveredEvent?.dateTime ? deliveredEvent.dateTime.slice(0, 10) : null;

      const { matched: didMatch } = await applyTrackingEvent(supabase, {
        awbNo,
        bucket,
        deliveredDate,
        rawStatusText: result.latestStatusDetail?.description ?? null,
      });

      if (didMatch) {
        matched += 1;
        if (bucket === "DELIVERED" || bucket === "RTO" || bucket === "IN_TRANSIT") updated += 1;
        await markCourierWebhookProcessed(supabase, logId);
      } else {
        await markCourierWebhookError(supabase, logId, `No dispatch_invoices row found for AWB ${awbNo}`);
      }
    }
  }

  return NextResponse.json({ polled, matched, updated, errors: errors.length ? errors : undefined });
}
