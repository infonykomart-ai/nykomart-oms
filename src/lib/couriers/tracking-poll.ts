// Shared courier-tracking fetch + DB-apply plumbing.
//
// 2026-10-26 — lifted out of src/app/api/cron/poll-fedex-tracking/route.ts
// so the order page's "Check tracking now" button can run the EXACT same
// code path as the nightly poll (FedEx / Aramex / DHL are request/response
// APIs with no push webhook, so these three are the pollable couriers).
// Delhivery / UPS / Shiprocket push to us instead — see
// src/app/api/webhooks/courier/*, nothing here applies to them.
//
// The route keeps the scheduling/selection logic (which AWBs are pending,
// batching, DHL's per-run cap); this file owns "ask the courier, normalize
// the answer, then apply it through applyTrackingEvent()" so the two
// callers can never drift.

import {
  applyTrackingEvent,
  logCourierWebhook,
  markCourierWebhookError,
  markCourierWebhookProcessed,
  type TrackingBucket,
} from "@/lib/courier-webhooks/apply-tracking-event";
import {
  fetchAramexTracking,
  bucketFromAramexDescription,
  type AramexClientInfo,
} from "@/lib/couriers/aramex-tracking";
import { fetchDhlTracking, bucketFromDhlStatus } from "@/lib/couriers/dhl-tracking";
import { FEDEX_API_BASE } from "@/lib/couriers/fedex-auth";
import type { createServiceRoleClient } from "@/lib/supabase/server";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

// DHL has no batch endpoint and a hard 1-call-per-5-seconds rate limit (see
// dhl-tracking.ts's header comment), so it is capped per cron run rather
// than per request. 6 * 5.5s ≈ 33s, leaving headroom inside the cron
// route's 60s maxDuration. Any pending DHL AWBs beyond the cap are picked
// up on the next run.
export const DHL_MAX_PER_RUN = 6;
const DHL_MIN_INTERVAL_MS = 5500;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function bucketFromFedexCode(code: string): TrackingBucket {
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
      return "OTHER"; // CA (cancelled), DE/EA/SE (exceptions) — no clean LOST signal
  }
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

// A courier-agnostic shape all three fetchers normalize down to, so the
// DB-writing loop (applyPolledEvents below) is written once. `logPayload`
// is the per-shipment slice of that courier's own response that ends up in
// courier_webhook_log.raw_payload.
export type PolledEvent = {
  awbNo: string | null;
  bucket: TrackingBucket;
  deliveredDate: string | null;
  rawStatusText: string | null;
  logPayload: unknown;
  parseError?: string; // set when the courier's own result couldn't be parsed — logged, never applied
};

export function normalizeFedexResults(results: FedexTrackResult[]): PolledEvent[] {
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

export async function fetchFedexBatchNormalized(accessToken: string, awbNos: string[]): Promise<PolledEvent[]> {
  return normalizeFedexResults(await fetchFedexBatch(accessToken, awbNos));
}

export async function fetchAramexBatchNormalized(client: AramexClientInfo, awbNos: string[]): Promise<PolledEvent[]> {
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

// Only processes the first DHL_MAX_PER_RUN of whatever's passed in — see
// the constant's comment above. The cron route passes its FULL pending list
// (so this runs exactly once per invocation, not once per chunk).
export async function fetchDhlBatchNormalized(apiKey: string, awbNos: string[]): Promise<PolledEvent[]> {
  const toPoll = awbNos.slice(0, DHL_MAX_PER_RUN);
  const events: PolledEvent[] = [];

  for (let i = 0; i < toPoll.length; i++) {
    if (i > 0) await sleep(DHL_MIN_INTERVAL_MS); // DHL's documented minimum spacing between calls
    const awbNo = toPoll[i];
    try {
      const result = await fetchDhlTracking(apiKey, awbNo);
      if (!result.statusCode) {
        // 404 / not-yet-scanned — "nothing to report yet", not a malformed response.
        events.push({ awbNo, bucket: "OTHER", deliveredDate: null, rawStatusText: null, logPayload: result });
        continue;
      }
      const bucket = bucketFromDhlStatus(result.statusCode, result.description);
      const deliveredDate = bucket === "DELIVERED" && result.timestamp ? result.timestamp.slice(0, 10) : null;
      events.push({ awbNo, bucket, deliveredDate, rawStatusText: result.description, logPayload: result });
    } catch (err) {
      events.push({
        awbNo,
        bucket: "OTHER",
        deliveredDate: null,
        rawStatusText: null,
        logPayload: null,
        parseError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return events;
}

// Writes one batch of already-fetched events through the SAME
// applyTrackingEvent() path the push webhooks use: always log first, then
// apply, then mark the log row processed/errored. Shared by the cron route
// and the order page's on-demand refresh so both leave identical evidence.
export async function applyPolledEvents(
  supabase: ServiceClient,
  courierLabel: string,
  events: PolledEvent[]
): Promise<{ polled: number; matched: number; updated: number }> {
  let polled = 0;
  let matched = 0;
  let updated = 0;

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
      await markCourierWebhookError(supabase, logId, `No order_shipments row found for AWB ${event.awbNo}`);
    }
  }

  return { polled, matched, updated };
}

/** Which pollable courier family a free-text courier_name belongs to. */
export function pollableFamilyForCourierName(courierName: string | null | undefined): "fedex" | "aramex" | "dhl" | null {
  const name = (courierName ?? "").toLowerCase();
  if (name.includes("fedex")) return "fedex";
  if (name.includes("aramex")) return "aramex";
  if (name.includes("dhl")) return "dhl";
  return null;
}
