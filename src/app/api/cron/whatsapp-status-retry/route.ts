// 2026-11-25 — Manual/external trigger for the automatic order-status WhatsApp
// retry sweep.
//
// The sweep normally rides on the existing scheduled job (/api/cron/sync-orders
// calls the same retryDueStatusMessages) because this plan only has two Vercel
// cron slots. This endpoint stays for an on-demand run — same bearer-token
// protection as every other cron (src/lib/auth/cron-auth.ts, fails closed when
// CRON_SECRET is unset).

import { NextRequest, NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/auth/cron-auth";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { STATUS_RETRY_BATCH, retryDueStatusMessages, statusMessageBacklog } from "@/lib/whatsapp/status-retry";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = createServiceRoleClient();
    const summary = await retryDueStatusMessages(supabase, { batch: STATUS_RETRY_BATCH });
    // 2026-11-26 — report what is still owed, not just what this run reached.
    const backlog = await statusMessageBacklog(supabase);
    return NextResponse.json({ ...summary, backlog });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
