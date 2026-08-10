// DHL Shipment Tracking — Unified Tracking API (developer.dhl.com). DHL
// documents this single endpoint as covering ALL their divisions (Express,
// eCommerce Solutions, Freight, Global Forwarding, Post & Parcel Germany,
// Supply Chain) rather than needing a separate integration per division.
// Built from DHL's own public docs — developer.dhl.com/tracking,
// developer.dhl.com/api-reference/shipment-tracking, and the "What are the
// different status codes available in the DHL Shipment Tracking - Unified
// API?" support article — no docs were uploaded by the user for this one,
// same research-first approach used for every courier in this app.
//
// TWO IMPORTANT DIFFERENCES FROM EVERY OTHER COURIER IN THIS APP:
//
// 1. NO BATCH ENDPOINT. Unlike FedEx (up to 30 tracking numbers per
//    request) and Aramex (an unbounded array in one SOAP call), DHL's
//    Unified Tracking API takes exactly ONE trackingNumber per GET
//    request — there is no bulk/batch variant documented anywhere.
//
// 2. HARD RATE LIMIT. DHL's default approved key allows 250 calls/day AND
//    a minimum of 1 call every 5 seconds — both enforced server-side
//    (HTTP 429 on violation). Combined with #1, polling N pending DHL
//    shipments takes at least N*5 seconds of wall-clock time. This
//    collides directly with poll-fedex-tracking/route.ts's shared
//    maxDuration=60 ceiling (FedEx + Aramex + DHL all run inside ONE
//    Vercel Hobby function invocation — see that file's header comment
//    for why they share one cron slot at all). See DHL_MAX_PER_RUN in the
//    route file for how this is bounded — anything beyond that cap simply
//    waits for tomorrow's run, since dispatch_invoices rows stay pending
//    (delivered_status IS NULL) until a courier confirms delivery/RTO. If
//    DHL shipment volume grows enough that daily cadence is too slow,
//    options are: ask DHL for a rate-limit increase (My Apps -> Request
//    Upgrade in the developer portal), or move DHL polling to its own
//    externally-triggered route (kept off vercel.json's cron array, per
//    the Hobby 2-job cap, and invoked by an outside scheduler hitting it
//    with the same CRON_SECRET bearer auth).
//
// Auth: a single `DHL-API-Key` header (not OAuth) — from an approved
// developer.dhl.com app. Getting one requires DHL's review (not
// self-serve like FedEx's sandbox) — create an app against the "Shipment
// Tracking - Unified" API at developer.dhl.com and wait for approval;
// approval typically grants up to 2 key instances (production + testing).
//
// Status mapping: DHL's own statusCode enum (confirmed via their support
// article) has only 5 values — pre-transit, transit, delivered, failure,
// unknown — notably NO dedicated RTO/return code yet ("Return to Origin"
// is listed as planned but not available as of this writing). So, same as
// Aramex/Shiprocket in this app, RTO and LOST are inferred from the
// free-text `status.description` field in bucketFromDhlStatus() below,
// not from statusCode alone.

export type DhlTrackingResult = {
  awbNo: string;
  statusCode: string | null;
  description: string | null;
  timestamp: string | null; // ISO 8601, per DHL's docs
};

const DHL_API_BASE = process.env.DHL_API_BASE_URL || "https://api-eu.dhl.com";

export function getDhlApiKey(): string {
  const key = process.env.DHL_API_KEY;
  if (!key) throw new Error("DHL_API_KEY is not set.");
  return key;
}

/**
 * Fetches tracking for exactly one AWB — DHL's Unified Tracking API has no
 * batch/bulk variant. Callers are responsible for respecting DHL's 1
 * call/5s rate limit between invocations (see DHL_MAX_PER_RUN + the
 * inter-call delay in poll-fedex-tracking/route.ts).
 */
export async function fetchDhlTracking(apiKey: string, awbNo: string): Promise<DhlTrackingResult> {
  const url = `${DHL_API_BASE}/track/shipments?trackingNumber=${encodeURIComponent(awbNo)}`;
  const res = await fetch(url, {
    headers: { "DHL-API-Key": apiKey, Accept: "application/json" },
  });

  if (res.status === 404) {
    // DHL returns 404 for a tracking number it doesn't recognize yet (e.g.
    // a very fresh AWB not scanned into their system) — not a hard error,
    // just "nothing to report yet".
    return { awbNo, statusCode: null, description: null, timestamp: null };
  }
  if (!res.ok) {
    throw new Error(`DHL Tracking API request failed ${res.status}: ${await res.text()}`);
  }

  const data = (await res.json()) as {
    shipments?: Array<{
      status?: { statusCode?: string; description?: string; timestamp?: string };
    }>;
  };
  const shipment = data.shipments?.[0];
  return {
    awbNo,
    statusCode: shipment?.status?.statusCode ?? null,
    description: shipment?.status?.description ?? null,
    timestamp: shipment?.status?.timestamp ?? null,
  };
}

export function bucketFromDhlStatus(
  statusCode: string | null,
  description: string | null
): "IN_TRANSIT" | "DELIVERED" | "RTO" | "LOST" | "OTHER" {
  const text = (description ?? "").toLowerCase();
  if (text.includes("return") || text.includes("rto")) return "RTO";
  if (text.includes("lost") || text.includes("damage")) return "LOST";
  switch (statusCode) {
    case "delivered":
      return "DELIVERED";
    case "transit":
    case "pre-transit":
      return "IN_TRANSIT";
    case "failure":
    case "unknown":
    default:
      return "OTHER"; // no clean LOST signal at the statusCode level, same caveat as Aramex/Shiprocket
  }
}
