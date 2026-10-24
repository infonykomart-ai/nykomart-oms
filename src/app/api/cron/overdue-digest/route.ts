// Overdue payables digest — 2026-10-24 (route + shared body).
//
// "Kitna paisa kitna purana pada hai" ko roz subah Telegram par bhej deta hai,
// taaki kisi ko app kholna na pade. Same calculation as the Payables Ageing
// report (src/lib/parties/ageing.ts) — ek hi source, is liye screen aur message
// kabhi alag figure nahi dikha sakte.
//
// WHO RECEIVES IT: OVERDUE_DIGEST_CHAT_ID (comma-separated) when set, else a
// Telegram DM to every active employee whose role holds permissions_admin and
// who has connected Telegram. Never broadcast to all staff.
//
// SCHEDULING: runs automatically from the existing 03:00 UTC (08:30 IST)
// tracking cron (src/app/api/cron/poll-fedex-tracking/route.ts), because
// vercel.json is already at Vercel Hobby's two-cron cap. To schedule it
// separately instead:
//     GET https://<deployment>/api/cron/overdue-digest
//     Authorization: Bearer $CRON_SECRET
// (set TRACKING_DIGESTS=off if you do, so it is not sent twice a day.)
//
// `?dry=1` returns the exact message and recipients WITHOUT sending.
// `?skipEmpty=1` sends nothing when there is no overdue amount.
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { runOverdueDigest } from "@/lib/parties/overdue-digest";

export const maxDuration = 60;

async function run(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const skipEmpty = req.nextUrl.searchParams.get("skipEmpty") === "1";

  const result = await runOverdueDigest(supabase, { dry, skipEmpty });

  if (result.error) {
    return NextResponse.json({ ok: false, ...result }, { status: 500 });
  }
  // 503 (not 500) when the run was fine but no recipient is configured: the
  // scheduler's retry cannot fix a missing Telegram connection.
  if (!dry && result.sent === 0 && !result.skipped) {
    return NextResponse.json({ ok: false, ...result }, { status: 503 });
  }
  return NextResponse.json(dry ? { ok: true, dry: true, ...result } : { ok: true, ...result });
}

export async function GET(req: NextRequest) {
  return run(req);
}

export async function POST(req: NextRequest) {
  return run(req);
}
