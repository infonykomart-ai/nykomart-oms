// 2026-11-25 — the retry sweep for automatic order-status WhatsApp messages.
//
// WHY THIS IS A MODULE: it has to run from a schedule, not from a button. This
// project has only two Vercel cron slots (both daily) and no spare one, so the
// sweep is called by the existing /api/cron/sync-orders job as well as by its
// own /api/cron/whatsapp-status-retry endpoint (kept for manual/external
// triggers). Both paths run THIS code, so the states written can never differ.
//
// WHAT IT DOES: finds messages still owed to a chat (the company's WhatsApp
// group, or a customer number) — 'queued' (never
// attempted) or 'failed' with a retry scheduled — whose next_attempt_at is due,
// and hands each to deliverQueuedMessage (the same function the immediate send
// uses). A message with no usable phone/text can never succeed, so it is moved
// to 'skipped' with the reason instead of being retried forever.
//
// TIME BUDGET: the cron routes are capped at 60s on this plan. Sends are
// sequential and each can take up to 20s, so the loop stops at the deadline and
// leaves the remainder for the next run instead of being killed mid-batch.

import type { createServiceRoleClient } from "@/lib/supabase/server";
import { MAX_STATUS_RETRIES } from "./order-status";
import { deliverQueuedMessage } from "./order-status-notify";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type RetrySummary = {
  /** Rows that were due when the sweep started. */
  due: number;
  attempted: number;
  sent: number;
  failed: number;
  skipped: number;
  /** Due rows the time budget did not reach; they stay queued for next time. */
  deferred: number;
};

export async function retryDueStatusMessages(
  supabase: ServiceClient,
  options: { batch?: number; budgetMs?: number } = {}
): Promise<RetrySummary> {
  const batch = Math.max(1, Math.min(50, options.batch ?? 20));
  const deadline = Date.now() + Math.max(0, options.budgetMs ?? 25_000);
  const summary: RetrySummary = { due: 0, attempted: 0, sent: 0, failed: 0, skipped: 0, deferred: 0 };

  const { data, error } = await supabase
    .from("order_whatsapp_messages")
    .select("id, customer_phone, message_text, retry_count")
    .eq("message_type", "order_status")
    .in("delivery_status", ["queued", "failed"])
    .lte("next_attempt_at", new Date().toISOString())
    .lt("retry_count", MAX_STATUS_RETRIES)
    .order("next_attempt_at", { ascending: true })
    .limit(batch);

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  summary.due = rows.length;

  for (const row of rows) {
    if (Date.now() >= deadline) break;
    if (!row.customer_phone || !row.message_text) {
      // Nothing a retry could ever fix — record why and stop retrying it.
      await supabase
        .from("order_whatsapp_messages")
        .update({ delivery_status: "skipped", next_attempt_at: null, error_message: "Message has no phone or text." } as never)
        .eq("id", row.id);
      summary.skipped += 1;
      continue;
    }
    summary.attempted += 1;
    const outcome = await deliverQueuedMessage(supabase, {
      id: row.id,
      recipient: row.customer_phone,
      messageText: row.message_text,
      retryCount: Number(row.retry_count ?? 0),
    });
    if (outcome.status === "sent") summary.sent += 1;
    else summary.failed += 1;
  }

  summary.deferred = rows.length - summary.attempted - summary.skipped;
  return summary;
}
