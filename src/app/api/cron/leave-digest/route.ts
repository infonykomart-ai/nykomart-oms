// Leave daily digest — 2026-10-21 (route), 2026-10-24 (runnable body moved to
// src/lib/leave/digest-run.ts).
//
// "abhi bell + 'On Leave' board sirf tab dikhta hai jab koi page khole.
// Telegram bot se har subah fixed time par message ja sakta hai: 'aaj 4 log
// leave par — Neelu, Rahul…'"
//
// WHAT: one hit sends TODAY's approved-leave list to Telegram. Nothing new is
// stored — it reads the same leave_requests rows the Leave page's "On Leave"
// board reads. The wording lives in src/lib/leave/digest.ts (pure), the sending
// in src/lib/leave/digest-run.ts (shared with the tracking cron below).
//
// WHO RECEIVES IT: LEAVE_DIGEST_CHAT_ID (comma-separated) when set, else every
// active employee whose role holds leave_admin and who connected Telegram.
// Never broadcast to all staff.
//
// SCHEDULING: two ways, both already live —
//   • automatically, as part of the existing 03:00 UTC (08:30 IST) tracking
//     cron — see src/app/api/cron/poll-fedex-tracking/route.ts, which calls
//     runLeaveDigest() after the courier poll because vercel.json is already at
//     Vercel Hobby's two-cron cap;
//   • manually / from an external scheduler, by hitting this route:
//         GET https://<deployment>/api/cron/leave-digest
//         Authorization: Bearer $CRON_SECRET
//     (If you wire up an external schedule, set TRACKING_DIGESTS=off so the
//     message is not sent twice a day.)
//
// SECURITY: bearer-token only. `?dry=1` returns the exact message and
// recipients WITHOUT sending; `?skipEmpty=1` sends nothing on a day with zero
// leaves (without it, "aaj koi leave par nahi hai" is still sent — which is
// what proves the job ran).
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { runLeaveDigest } from "@/lib/leave/digest-run";

export const maxDuration = 60;

async function run(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const skipEmpty = req.nextUrl.searchParams.get("skipEmpty") === "1";

  const result = await runLeaveDigest(supabase, { dry, skipEmpty });

  // 500 only when the digest genuinely could not read its data — a missing
  // recipient is a configuration note, not a failed run.
  if (result.error) {
    return NextResponse.json({ ...result, date: result.date }, { status: 500 });
  }
  return NextResponse.json(dry ? { ...result, dryRun: true } : result);
}

export async function GET(req: NextRequest) {
  return run(req);
}

// Same handler for POST — some external schedulers only offer POST. The body
// is ignored; auth and the ?dry=1 / ?skipEmpty=1 flags work identically.
export async function POST(req: NextRequest) {
  return run(req);
}
