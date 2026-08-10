// Courier POLLING cron — FedEx AND Aramex share this one job. Both are
// request/response-only APIs (no push webhook available), unlike
// Delhivery/UPS/Shiprocket which POST to us — see
// src/app/api/webhooks/courier/delhivery and .../ups and .../shiprocket
// for those.
//
// WHY ONE FILE FOR TWO COURIERS (important, don't split this back out
// without reading this first): Vercel's Hobby plan hard-caps a project at
// 2 cron jobs total in vercel.json — see the batch46 postmortem in this
// project's own notes for the full story, but the short version is that
// exceeding Hobby's cron limits doesn't fail loudly, it silently blocks
// EVERY future deployment from being created at all, which is a brutal
// thing to debug. This project already spends both cron slots
// (sync-orders + this one), so a third courier needing polling (rather
// than a webhook) gets folded into THIS route rather than getting its own
// vercel.json entry. Kept the historical filename/route path
// (poll-fedex-tracking) rather than renaming to something more generic —
// a rename would leave an orphaned old route file that the manual
// GitHub-upload workflow can't delete (add/replace only), same class of
// cleanup debt as the stale webapp/ folder — not worth it for a filename.
//
// FedEx: researched before building — FedEx's true push mechanism
// ("Advanced Integrated Visibility" tracking-number subscription) exists
// but requires FedEx account-rep approval and its payload schema isn't
// publicly documented. FedEx's self-serve "Track API"
// (developer.fedex.com) is polling-only. OAuth2 client_credentials +
// Track API docs: https://developer.fedex.com/api/en-us/catalog/track.html
//
// Aramex: the user uploaded Aramex's own official WSDL kit (Rate/Location/
// Tracking/Shipping SOAP services + client SDK samples) — nothing in it
// describes a webhook/callback mechanism, only request/response SOAP
// calls, so this is polling too. Full detail on the SOAP request/response
// shape, auth, and the (unconfirmed) status-code mapping lives in
// src/lib/couriers/aramex-tracking.ts's header comment.
//
// Both couriers run independently per request — one being unconfigured or
// erroring never blocks the other; each courier's result/error is reported
// under its own key in the response JSON.
//
// SECURITY: same bearer-token pattern as sync-orders — only callable with
// `Authorization: Bearer $CRON_SECRET`.

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  applyTrackingEvent,
  logCourierWebhook,
  markCourierWebhookError,
  markCourierWebhookProcessed,
  type TrackingBucket,
} from "@/lib/courier-webhooks/apply-tracking-event";
import {
  fetchAramexTracking,
  getAramexClientInfo,
  bucketFromAramexDescription,
  type AramexClientInfo,
} from "@/lib/couriers/aramex-tracking";

export const maxDuration = 60;

const FEDEX_API_BASE = process.env.FEDEX_API_BASE_URL || "https://apis.fedex.com";
const BATCH_SIZE = 30; // FedEx Track API's documented max trackingInfo entries per request; also used as Aramex's batch size (Aramex doesn't document a max, so reusing FedEx's documented limit as a conservative default)

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

// A courier-agnostic shape both couriers' fetch functions normalize down
// to, so the actual DB-writing loop (processCourier below) only has to be
// written once. `logPayload` is whatever's most useful to see later in
// courier_webhook_log.raw_payload — the per-shipment slice of that
// courier's own response, not the whole batch response.
type PolledEvent = {
  awbNo: string | null;
  bucket: TrackingBucket;
  deliveredDate: string | null;
  rawStatusText: string | null;
  logPayload: unknown;
  parseError?: string; // set when this courier's own result couldn't be parsed (missing AWB/status) — logged, never applied
};

function normalizeFedexResults(results: FedexTrackResult[]): PolledEvent[] {
  return results.map((result) => {
    const awbNo = result.trackingNumberInfo?.trackingNumber ?? null;
    const code = result.latestStatusDetail?.code;
    if (!awbNo || !code) {
      return {
        awbNo,
        bucket: "OTHER" as TrackingBucket,
        deliveredDate: null,
        rawStatusText: null,
        logPayload: result,
        parseError: "Missing trackingNumber or latestStatusDetail.code in FedEx response.",
      };
    }
    const bucket = bucketFromFedexCode(code);
    const deliveredEvent = result.dateAndTimes?.find((d) => d.type === "ACTUAL_DELIVERY");
    const deliveredDate = bucket === "DELIVERED" && deliveredEvent?.dateTime ? deliveredEvent.dateTime.slice(0, 10) : null;
    return { awbNo, bucket, deliveredDate, rawStatusText: result.latestStatusDetail?.description ?? null, logPayload: result };
  });
}

async function fetchFedexBatchNormalized(accessToken: string, awbNos: string[]): Promise<PolledEvent[]> {
  return normalizeFedexResults(await fetchFedexBatch(accessToken, awbNos));
}

async function fetchAramexBatchNormalized(client: AramexClientInfo, awbNos: string[]): Promise<PolledEvent[]> {
  const results = await fetchAramexTracking(client, awbNos);
  return results.map((r) => {
    const bucket = bucketFromAramexDescription(r.updateDescription);
    const deliveredDate = bucket === "DELIVERED" && r.updateDateTime ? r.updateDateTime.slice(0, 10) : null;
    return {
      awbNo: r.waybillNumber || null,
      bucket,
      deliveredDate,
      rawStatusText: r.updateDescription,
      logPayload: r,
    };
  });
}

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/**
 * Fetches every not-yet-delivered dispatch_invoices row matching
 * `courierNameLike` (an ILIKE pattern, e.g. "%fedex%"), batches its AWBs
 * through `fetchBatch`, and applies whatever comes back through the same
 * applyTrackingEvent() helper the push webhooks use — identical to the
 * original single-courier version of this route, just parameterized so
 * FedEx and Aramex can share it.
 */
async function processCourier(
  supabase: ServiceClient,
  courierLabel: string,
  courierNameLike: string,
  batchSize: number,
  fetchBatch: (awbNos: string[]) => Promise<PolledEvent[]>
): Promise<{ polled: number; matched: number; updated: number; errors?: string[] }> {
  const { data: pending, error: fetchError } = await supabase
    .from("dispatch_invoices")
    .select("awb_no")
    .ilike("courier_name", courierNameLike)
    .not("awb_no", "is", null)
    .is("delivered_status", null); // NOT yet marked Delivered — see delivered_status enum ('Delivered','NOT Delivered')

  if (fetchError) {
    return { polled: 0, matched: 0, updated: 0, errors: [fetchError.message] };
  }

  const awbNos = Array.from(new Set((pending ?? []).map((r) => r.awb_no).filter((a): a is string => !!a)));
  if (awbNos.length === 0) {
    return { polled: 0, matched: 0, updated: 0 };
  }

  let polled = 0;
  let matched = 0;
  let updated = 0;
  const errors: string[] = [];

  for (let i = 0; i < awbNos.length; i += batchSize) {
    const batch = awbNos.slice(i, i + batchSize);
    let events: PolledEvent[];
    try {
      events = await fetchBatch(batch);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      continue;
    }

    for (const event of events) {
      polled += 1;
      const logId = await logCourierWebhook(supabase, courierLabel, event.awbNo, event.logPayload);

      if (event.parseError || !event.awbNo) {
        await markCourierWebhookError(supabase, logId, event.parseError ?? "Missing AWB in courier response.");
        continue;
      }

      const { matched: didMatch } = await applyTrackingEvent(supabase, {
        awbNo: event.awbNo,
        bucket: event.bucket,
        deliveredDate: event.deliveredDate,
        rawStatusText: event.rawStatusText,
      });

      if (didMatch) {
        matched += 1;
        if (event.bucket === "DELIVERED" || event.bucket === "RTO" || event.bucket === "IN_TRANSIT") updated += 1;
        await markCourierWebhookProcessed(supabase, logId);
      } else {
        await markCourierWebhookError(supabase, logId, `No dispatch_invoices row found for AWB ${event.awbNo}`);
      }
    }
  }

  return { polled, matched, updated, errors: errors.length ? errors : undefined };
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const results: Record<string, unknown> = {};

  // FedEx and Aramex are independent — one being unconfigured (missing env
  // vars) or erroring never blocks the other, unlike the old single-courier
  // version of this route which returned HTTP 502 for the whole request if
  // FedEx's OAuth call failed.
  try {
    const accessToken = await getFedexAccessToken();
    results.fedex = await processCourier(supabase, "FedEx", "%fedex%", BATCH_SIZE, (batch) =>
      fetchFedexBatchNormalized(accessToken, batch)
    );
  } catch (err) {
    results.fedex = { error: err instanceof Error ? err.message : String(err) };
  }

  try {
    const client = getAramexClientInfo();
    results.aramex = await processCourier(supabase, "Aramex", "%aramex%", BATCH_SIZE, (batch) =>
      fetchAramexBatchNormalized(client, batch)
    );
  } catch (err) {
    results.aramex = { error: err instanceof Error ? err.message : String(err) };
  }

  return NextResponse.json(results);
}
