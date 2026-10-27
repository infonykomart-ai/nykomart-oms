// Courier POLLING cron — FedEx, Aramex, AND DHL share this one job. All
// three are request/response-only APIs (no push webhook available),
// unlike Delhivery/UPS/Shiprocket which POST to us — see
// src/app/api/webhooks/courier/delhivery and .../ups and .../shiprocket
// for those.
//
// WHY ONE FILE FOR THREE COURIERS (important, don't split this back out
// without reading this first): Vercel's Hobby plan hard-caps a project at
// 2 cron jobs total in vercel.json — see the batch46 postmortem in this
// project's own notes for the full story, but the short version is that
// exceeding Hobby's cron limits doesn't fail loudly, it silently blocks
// EVERY future deployment from being created at all, which is a brutal
// thing to debug. This project already spends both cron slots
// (sync-orders + this one), so every courier needing polling (rather than
// a webhook) gets folded into THIS route rather than getting its own
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
// DHL: researched from DHL's own public docs (developer.dhl.com) — no
// docs were uploaded for this one. Uses the "Unified Tracking API", which
// DHL documents as covering all their divisions (Express, eCommerce,
// Freight, Global Forwarding, Post & Parcel Germany, Supply Chain) behind
// one endpoint. IMPORTANT CAVEAT specific to DHL: this API has NO batch
// endpoint (one trackingNumber per request) and a hard rate limit (250
// calls/day, 1 call per 5 seconds) — see src/lib/couriers/dhl-tracking.ts's
// header comment for the full explanation and DHL_MAX_PER_RUN below for
// how that's bounded to fit inside this route's shared 60s maxDuration.
//
// All three couriers run independently per request — one being
// unconfigured or erroring never blocks the others; each courier's
// result/error is reported under its own key in the response JSON.
//
// SECURITY: same bearer-token pattern as sync-orders — only callable with
// `Authorization: Bearer $CRON_SECRET`.

import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getAramexClientInfo } from "@/lib/couriers/aramex-tracking";
import { getDhlApiKey } from "@/lib/couriers/dhl-tracking";
// 2026-09-01: token-fetch extracted to a shared file so the new FedEx Ship
// API booking client (src/lib/couriers/fedex-ship.ts) can reuse the exact
// same OAuth2 client_credentials call instead of duplicating it — see
// fedex-auth.ts's header comment.
import { getFedexAccessToken } from "@/lib/couriers/fedex-auth";
// 2026-10-26 — the per-courier fetch/normalize/apply helpers moved to this
// shared module so the order page's "Check tracking now" button (order
// detail tracking-actions.ts) runs the EXACT same code as this nightly
// job, instead of a second hand-copied implementation that could drift.
import {
  applyPolledEvents,
  fetchAramexBatchNormalized,
  fetchDhlBatchNormalized,
  fetchFedexBatchNormalized,
} from "@/lib/couriers/tracking-poll";
// 2026-10-24 — the two daily Telegram digests ride along with this 03:00 UTC
// (08:30 IST) job. vercel.json has no free cron slot (see the Hobby-cap note at
// the top of this file), so a separate schedule was not an option; calling the
// shared runners here is what actually STARTS them. Both are best-effort: a
// digest failure is reported under `digests` and never fails the courier poll.
// Set TRACKING_DIGESTS=off once an external scheduler hits
// /api/cron/leave-digest and /api/cron/overdue-digest directly, so the same
// message is not sent twice a day.
import { runLeaveDigest } from "@/lib/leave/digest-run";
import { runOverdueDigest } from "@/lib/parties/overdue-digest";

export const maxDuration = 60;

// FedEx Track API's documented max trackingInfo entries per request; also
// used as Aramex's batch size (Aramex doesn't document a max, so reusing
// FedEx's documented limit as a conservative default). DHL's per-run cap
// and inter-call spacing live in lib/couriers/tracking-poll.ts.
const BATCH_SIZE = 30;

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/**
 * Fetches every not-yet-delivered order_shipments row matching
 * `courierNameLike` (an ILIKE pattern, e.g. "%fedex%"), batches its AWBs
 * through `fetchBatch`, and applies whatever comes back through the same
 * applyTrackingEvent() helper the push webhooks use — identical to the
 * original single-courier version of this route, just parameterized so
 * FedEx and Aramex can share it.
 *
 * Gap 1 (2026-08-20): queries order_shipments, NOT dispatch_invoices —
 * dispatch_invoices.delivered_status is now a per-ORDER weakest-link
 * summary (see resync-dispatch-summary.ts), so a multi-AWB order with one
 * shipment still pending and one already delivered would show a non-null
 * 'NOT Delivered' there and get silently skipped forever. order_shipments'
 * delivered_status is the real per-AWB value, so this is the correct
 * "which individual AWBs still need polling" source.
 */
async function processCourier(
  supabase: ServiceClient,
  courierLabel: string,
  courierNameLike: string,
  batchSize: number,
  fetchBatch: (awbNos: string[]) => Promise<import("@/lib/couriers/tracking-poll").PolledEvent[]>
): Promise<{ polled: number; matched: number; updated: number; errors?: string[] }> {
  const { data: pending, error: fetchError } = await supabase
    .from("order_shipments")
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
    let events: Awaited<ReturnType<typeof fetchBatch>>;
    try {
      events = await fetchBatch(batch);
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
      continue;
    }

    const applied = await applyPolledEvents(supabase, courierLabel, events);
    polled += applied.polled;
    matched += applied.matched;
    updated += applied.updated;
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

  // DHL runs LAST and with an effectively-unbounded batchSize (so
  // processCourier calls fetchDhlBatchNormalized exactly once with the
  // FULL pending list, rather than once per BATCH_SIZE-sized chunk) — the
  // per-run cap (DHL_MAX_PER_RUN) and inter-call delay are enforced
  // inside fetchDhlBatchNormalized itself. Placed last so a slow DHL run
  // (up to ~33s of deliberate rate-limit sleeping) never delays FedEx/
  // Aramex, which are fast batch calls.
  try {
    const dhlApiKey = getDhlApiKey();
    results.dhl = await processCourier(supabase, "DHL", "%dhl%", Number.MAX_SAFE_INTEGER, (batch) =>
      fetchDhlBatchNormalized(dhlApiKey, batch)
    );
  } catch (err) {
    results.dhl = { error: err instanceof Error ? err.message : String(err) };
  }

  // Daily digests LAST, after every courier has had its turn: a slow Telegram
  // call must never delay tracking, and a digest error must never mark the
  // tracking run as failed (a scheduler retry would re-poll everything).
  if (String(process.env.TRACKING_DIGESTS ?? "").toLowerCase() !== "off") {
    const digests: Record<string, unknown> = {};
    try {
      const leave = await runLeaveDigest(supabase);
      digests.leave = leave.error
        ? { error: leave.error }
        : { sent: leave.sent, onLeave: leave.onLeaveCount, wouldSendTo: leave.wouldSendTo, note: leave.note, failed: leave.failed };
    } catch (err) {
      digests.leave = { error: err instanceof Error ? err.message : String(err) };
    }
    try {
      // skipEmpty: a "nothing overdue" message every morning is noise — the
      // Ageing report still shows the zero state.
      const overdue = await runOverdueDigest(supabase, { skipEmpty: true });
      digests.overdue = overdue.error
        ? { error: overdue.error }
        : { sent: overdue.sent, overdue: overdue.overdue, skipped: overdue.skipped, note: overdue.note, failed: overdue.failed };
    } catch (err) {
      digests.overdue = { error: err instanceof Error ? err.message : String(err) };
    }
    results.digests = digests;
  }

  return NextResponse.json(results);
}
