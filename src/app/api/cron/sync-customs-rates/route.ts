// Vercel Cron -> GET /api/cron/sync-customs-rates
//
// Scheduled check for newly published Indian Customs exchange rates. It calls
// the same ingestion service the dashboard's "Sync now" button uses, so a run
// is recorded identically in customs_rate_sync_log either way.
//
// It does NOT fabricate rates. When ICEGATE/CBIC expose no machine-readable
// feed (today's state — verified 2026-11-14; see src/lib/customs/providers.ts),
// the run is logged as source_unavailable with the exact reason and nothing is
// written to the register. The dashboard surfaces that as a failed-sync alert
// so an administrator uploads the official notification.
//
// SECURITY: bearer token only (isCronAuthorized fails closed when
// CRON_SECRET is unset), same as every other /api/cron route.
import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth/cron-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { runCustomsRateSync } from "@/lib/customs/ingest";

export const maxDuration = 60; // Vercel Hobby ceiling, same as the other cron routes

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runCustomsRateSync({
      supabase: createServiceRoleClient(),
      trigger: "cron",
      actor: null,
    });

    const httpStatus = summary.status === "failed" ? 500 : 200;
    return NextResponse.json(
      {
        status: summary.status,
        provider: summary.provider,
        extracted: summary.extracted,
        verified: summary.verified,
        pending: summary.pending,
        duplicates: summary.duplicates,
        rejected: summary.rejected,
        message: summary.message,
        syncLogId: summary.syncLogId,
      },
      { status: httpStatus, headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "The customs rate sync failed." },
      { status: 500 }
    );
  }
}
