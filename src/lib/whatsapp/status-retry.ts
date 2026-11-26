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
//
// 2026-11-26 — BACKLOG (audit 3.6). Batch was 10, once a day: eleven failed
// messages took two days to clear, and the queue grew silently. The batch is
// now 50 and `statusMessageBacklog()` answers the question the admin page
// could not: how many are still due, and how long has the oldest waited. Both
// are read from the table itself (no remembered counter), so they stay honest
// after a manual retry or a successful send.

import type { createServiceRoleClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import { MAX_STATUS_RETRIES } from "./order-status";
import { deliverQueuedMessage } from "./order-status-notify";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;
type MessageUpdate = Database["public"]["Tables"]["order_whatsapp_messages"]["Update"];

/**
 * Rows the sweep tries to deliver per run. The deadline still stops the loop
 * on a slow provider; this is the ceiling, not a promise to finish 50 sends.
 */
export const STATUS_RETRY_BATCH = 50;

/**
 * How long a due message may wait before the admin page calls it a backlog.
 * Two hours is out of step with the daily sweep — that is the point: it turns
 * "the queue is piling up" into a visible warning instead of silent growth.
 */
export const STATUS_BACKLOG_ALERT_HOURS = 2;

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

/**
 * Everything still owed after the filters the sweep uses — not just this
 * batch. `behind` is the alert: more waiting than one run can clear, or an
 * oldest message older than the alert window.
 */
export type StatusBacklog = {
  pending: number;
  oldestCreatedAt: string | null;
  oldestHours: number | null;
  behind: boolean;
};

export async function statusMessageBacklog(
  supabase: ServiceClient,
  options: { companyIds?: string[]; now?: Date } = {}
): Promise<StatusBacklog> {
  const now = options.now ?? new Date();
  let query = supabase
    .from("order_whatsapp_messages")
    .select("created_at", { count: "exact" })
    .eq("message_type", "order_status")
    .in("delivery_status", ["queued", "failed"])
    .lt("retry_count", MAX_STATUS_RETRIES)
    .lte("next_attempt_at", now.toISOString());
  if (options.companyIds?.length) query = query.in("company_id", options.companyIds);

  // count is the whole filtered set (PostgREST `count: "exact"`); the single
  // row is only there to age the oldest one.
  const { data, count, error } = await query.order("created_at", { ascending: true }).limit(1);
  if (error) throw new Error(error.message);

  const pending = count ?? (data?.length ?? 0);
  const oldestCreatedAt = data?.[0]?.created_at ?? null;
  const oldestHours = oldestCreatedAt
    ? Math.max(0, (now.getTime() - new Date(oldestCreatedAt).getTime()) / 3_600_000)
    : null;

  return {
    pending,
    oldestCreatedAt,
    oldestHours: oldestHours == null ? null : Math.round(oldestHours * 10) / 10,
    behind:
      pending > 0 &&
      (pending > STATUS_RETRY_BATCH || (oldestHours ?? 0) >= STATUS_BACKLOG_ALERT_HOURS),
  };
}

export async function retryDueStatusMessages(
  supabase: ServiceClient,
  options: { batch?: number; budgetMs?: number } = {}
): Promise<RetrySummary> {
  const batch = Math.max(1, Math.min(STATUS_RETRY_BATCH, options.batch ?? STATUS_RETRY_BATCH));
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
      const patch: MessageUpdate = {
        delivery_status: "skipped",
        next_attempt_at: null,
        error_message: "Message has no phone or text.",
      };
      await supabase.from("order_whatsapp_messages").update(patch).eq("id", row.id);
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
