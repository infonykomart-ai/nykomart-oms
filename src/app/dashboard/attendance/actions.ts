"use server";

import { revalidatePath } from "next/cache";
import { requireCapability, getAuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { recordPunchIn, recordPunchOut } from "@/lib/attendance/punch";
import { todayIST } from "@/lib/attendance/ist-date";

export type SimpleActionState = { error: string | null; success: boolean };

/** Manual Punch In button — backup for the automatic login punch-in. */
export async function manualPunchIn(): Promise<SimpleActionState> {
  const employee = await requireCapability("attendance_punch");
  const supabase = createServiceRoleClient();
  const result = await recordPunchIn(supabase, employee.id, employee.currentCompanyId, "Manual Entry");
  if (!result.ok) return { error: result.error, success: false };
  revalidatePath("/dashboard/attendance");
  return { error: null, success: true };
}

/** Manual Punch Out button. */
export async function manualPunchOut(): Promise<SimpleActionState> {
  const employee = await requireCapability("attendance_punch");
  const supabase = createServiceRoleClient();
  const result = await recordPunchOut(supabase, employee.id);
  if (!result.ok) return { error: result.error, success: false };
  if (result.noPunchInFound) return { error: "Punch in first before punching out.", success: false };
  revalidatePath("/dashboard/attendance");
  return { error: null, success: true };
}

/**
 * 2026-08-11: "SAAM KO ... LOGOUT KARTE HI PUNCH OUT" — called by
 * LogoutButton BEFORE supabase.auth.signOut(), while the session (and thus
 * requireCapability) is still valid. Best-effort: LogoutButton proceeds
 * with sign-out regardless of what this returns, matching the login
 * hook's same "attendance must never block the actual action" principle.
 */
export async function punchOutOnLogout(): Promise<void> {
  try {
    const employee = await getAuthedEmployee();
    const supabase = createServiceRoleClient();
    await recordPunchOut(supabase, employee.id);
  } catch {
    // Not signed in, or some other hiccup — nothing to punch out for.
  }
}

// ============================================================================
// Daily Work Report — auto-saves as the employee types (see
// daily-report-form.tsx). No capability required beyond being signed in
// (attendance_punch is already granted to essentially every role, and this
// lives on the same page) — matches the old DailyLogs sheet, where every
// employee could log their own work with no special permission.
// ============================================================================

export type DailyLogInput = {
  id?: string; // present = update existing row, absent = create new
  logDate: string;
  category: string;
  description: string;
  targetQty: string;
  qtyDone: string;
  workStatus: string;
  remarkSku: string;
};

/**
 * Upsert one Daily Work Report row. Called on a debounce after the
 * employee stops typing, AND on `pagehide` (tab close/navigate away) to
 * flush any pending change immediately — see daily-report-form.tsx. Always
 * scoped to the CALLING employee's own id server-side (never trusts a
 * client-supplied employee_id), so one login can never edit another
 * employee's report even if the row id were somehow guessed.
 */
export async function upsertDailyLog(input: DailyLogInput): Promise<{ error: string | null; id: string | null; updatedAt: string | null }> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();

  const row = {
    employee_id: employee.id,
    company_id: employee.currentCompanyId,
    log_date: input.logDate || todayIST(),
    category: input.category || null,
    description: input.description,
    target_qty: input.targetQty || null,
    qty_done: input.qtyDone || null,
    work_status: input.workStatus || null,
    remark_sku: input.remarkSku || null,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    // 2026-08-11 (round 3): a submitted row is finalized — the UI hides
    // its edit fields, but this server-side .is("submitted_at", null)
    // guard is what actually stops a submitted report from being changed
    // after the fact (never trust the client-side hide alone).
    const { data, error } = await supabase
      .from("daily_work_logs")
      .update(row)
      .eq("id", input.id)
      .eq("employee_id", employee.id) // defense in depth — can only ever touch your own rows
      .is("submitted_at", null)
      .select("id, updated_at")
      .single();
    if (error) {
      // PGRST116 = .single() got zero rows back — here that means the
      // .is("submitted_at", null) guard excluded it (already submitted) or
      // the id/employee_id didn't match. Any OTHER error code is a real DB
      // problem and shouldn't be masked behind the generic message.
      const message = error.code === "PGRST116" ? "This report has already been submitted and can't be edited." : error.message;
      return { error: message, id: null, updatedAt: null };
    }
    return { error: null, id: data.id, updatedAt: data.updated_at };
  }

  const { data, error } = await supabase.from("daily_work_logs").insert(row).select("id, updated_at").single();
  if (error) return { error: error.message, id: null, updatedAt: null };
  revalidatePath("/dashboard/attendance");
  return { error: null, id: data.id, updatedAt: data.updated_at };
}

export async function deleteDailyLog(id: string): Promise<SimpleActionState> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();
  // A submitted report is finalized — can't be removed either, same guard as upsertDailyLog above.
  const { error } = await supabase.from("daily_work_logs").delete().eq("id", id).eq("employee_id", employee.id).is("submitted_at", null);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/attendance");
  return { error: null, success: true };
}

// ============================================================================
// 2026-08-11 (round 2): "SUBMIT REPORT VALE SECTION ME ESTIMATE TIME KA
// OPTION HAI TO USKI JAGH PAR WATCH LAGA DO KITNE BAJE START KIYA KITNE
// BAJE WORK KHATM KIYA" — a real watch on each Daily Work Report row,
// replacing the old free-text Estimated Time field.
//
// 2026-08-11 (round 3): "start & pause button ko remove karo or sirf
// start time ka option ho kitne baje compleate hua ka option ho submit
// report ka option ho subit karte hi khud ke kaam me add ho jaye or md
// admin ke page par show ho jaye" — simplified from Start/Pause toggling
// into Start once + Submit once. startReportTimer is unchanged; the old
// pauseReportTimer is replaced by submitDailyLog, which does the same
// stop-the-clock elapsed-time math AND marks the row `submitted_at` —
// the moment a row actually counts as a real report (My Recent Reports
// and the Admin/MD Team Daily Work Log view both filter on this).
// ============================================================================

type TimerActionResult = {
  error: string | null;
  timerStartedAt: string | null;
  timeSpentSeconds: number;
  firstStartedAt: string | null;
  lastPausedAt: string | null;
};

type SubmitActionResult = TimerActionResult & { submittedAt: string | null };

export async function startReportTimer(id: string): Promise<TimerActionResult> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();
  const { data: existing, error: fetchError } = await supabase
    .from("daily_work_logs")
    .select("first_started_at, time_spent_seconds, timer_started_at, submitted_at")
    .eq("id", id)
    .eq("employee_id", employee.id)
    .single();
  if (fetchError || !existing) return { error: fetchError?.message ?? "Report not found.", timerStartedAt: null, timeSpentSeconds: 0, firstStartedAt: null, lastPausedAt: null };
  // 2026-08-11 (round 3 review fix): a submitted row is finalized — never
  // let its timer be restarted (same guard upsertDailyLog/deleteDailyLog
  // already have). Without this, a stale tab open on an already-submitted
  // row could silently set timer_started_at on a "done" report.
  if (existing.submitted_at) return { error: "This report has already been submitted and can't be edited.", timerStartedAt: null, timeSpentSeconds: existing.time_spent_seconds, firstStartedAt: existing.first_started_at, lastPausedAt: null };
  if (existing.timer_started_at) {
    // Already running — nothing to do, just report current state.
    return { error: null, timerStartedAt: existing.timer_started_at, timeSpentSeconds: existing.time_spent_seconds, firstStartedAt: existing.first_started_at, lastPausedAt: null };
  }
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("daily_work_logs")
    .update({ timer_started_at: now, first_started_at: existing.first_started_at ?? now })
    .eq("id", id)
    .eq("employee_id", employee.id)
    .is("submitted_at", null)
    .select("timer_started_at, time_spent_seconds, first_started_at, last_paused_at")
    .single();
  if (error || !data) return { error: error?.message ?? "This report has already been submitted and can't be edited.", timerStartedAt: null, timeSpentSeconds: 0, firstStartedAt: null, lastPausedAt: null };
  revalidatePath("/dashboard/attendance");
  return { error: null, timerStartedAt: data.timer_started_at, timeSpentSeconds: data.time_spent_seconds, firstStartedAt: data.first_started_at, lastPausedAt: data.last_paused_at };
}

/**
 * ✔ Submit Report — stops the clock (same elapsed-time math the old Pause
 * did) and marks the row `submitted_at`, finalizing it. This is the
 * moment a row becomes a real report: it starts showing in "My Recent
 * Reports" and on the Admin/MD Team Daily Work Log view (both filter on
 * submitted_at IS NOT NULL), and the form renders it read-only afterward
 * — same "server re-check, only touch your own rows" scoping as every
 * other action in this file.
 */
export async function submitDailyLog(id: string): Promise<SubmitActionResult> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();
  const { data: existing, error: fetchError } = await supabase
    .from("daily_work_logs")
    .select("timer_started_at, time_spent_seconds, first_started_at, submitted_at")
    .eq("id", id)
    .eq("employee_id", employee.id)
    .single();
  if (fetchError || !existing) return { error: fetchError?.message ?? "Report not found.", timerStartedAt: null, timeSpentSeconds: 0, firstStartedAt: null, lastPausedAt: null, submittedAt: null };
  // 2026-08-11 (round 3 review fix): idempotency / no-double-submit guard —
  // a stale tab, a double-click, or a race with another submit for the
  // same row must never silently re-finalize (and re-timestamp) an
  // already-submitted report.
  if (existing.submitted_at) return { error: "This report has already been submitted.", timerStartedAt: null, timeSpentSeconds: existing.time_spent_seconds, firstStartedAt: existing.first_started_at, lastPausedAt: null, submittedAt: existing.submitted_at };

  const now = new Date();
  const nowIso = now.toISOString();
  const elapsed = existing.timer_started_at
    ? Math.max(0, Math.floor((now.getTime() - new Date(existing.timer_started_at).getTime()) / 1000))
    : 0;

  const { data, error } = await supabase
    .from("daily_work_logs")
    .update({
      timer_started_at: null,
      time_spent_seconds: existing.time_spent_seconds + elapsed,
      last_paused_at: nowIso, // doubles as "Completed At" now that Pause/Resume no longer exists
      submitted_at: nowIso,
    })
    .eq("id", id)
    .eq("employee_id", employee.id)
    .is("submitted_at", null) // defense in depth against a concurrent double-submit racing the check above
    .select("timer_started_at, time_spent_seconds, first_started_at, last_paused_at, submitted_at")
    .single();
  if (error || !data) return { error: error?.message ?? "This report has already been submitted.", timerStartedAt: null, timeSpentSeconds: 0, firstStartedAt: null, lastPausedAt: null, submittedAt: null };
  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/admin");
  return { error: null, timerStartedAt: data.timer_started_at, timeSpentSeconds: data.time_spent_seconds, firstStartedAt: data.first_started_at, lastPausedAt: data.last_paused_at, submittedAt: data.submitted_at };
}
