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
  // 2026-08-11 (round 4): "estimate time me hour or minut ka colom ho
  // kitna estimate time laga, dusra option rakhna tha ki kitna time
  // consume kiya hour & minut" — both manually entered as total minutes
  // (the form combines its Hour + Minute inputs before calling this).
  estimatedTimeMinutes: string; // "" = not set
  timeSpentMinutes: string; // "" = 0
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
    estimated_time_minutes: input.estimatedTimeMinutes ? Math.max(0, parseInt(input.estimatedTimeMinutes, 10) || 0) : null,
    time_spent_seconds: input.timeSpentMinutes ? Math.max(0, parseInt(input.timeSpentMinutes, 10) || 0) * 60 : 0,
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
// start time ka option ho ... submit report ka option ho" — simplified
// from Start/Pause toggling into Start once + Submit once.
//
// 2026-08-11 (round 4): "daily work vale section se bhi start button ko
// hatane ko bola tha yaha manual entry ka option rakhna tha" — the Start
// button (and the live timer entirely) is now gone for this table.
// startReportTimer no longer exists. submitDailyLog is now just a plain
// finalize step (Estimated Time / Time Consumed are both saved by
// upsertDailyLog like any other field, since they're manual inputs, not
// a clock) — it only sets `submitted_at`.
// ============================================================================

type SubmitActionResult = { error: string | null; submittedAt: string | null };

/**
 * ✔ Submit Report — marks the row `submitted_at`, finalizing it. This is
 * the moment a row becomes a real report: it starts showing in "My Recent
 * Reports" and on the Admin/MD Team Daily Work Log view (both filter on
 * submitted_at IS NOT NULL), and the form renders it read-only afterward
 * — same "server re-check, only touch your own rows" scoping as every
 * other action in this file. Idempotency guard: a stale tab, a
 * double-click, or a race with another submit for the same row must
 * never silently re-finalize (and re-timestamp) an already-submitted
 * report.
 */
export async function submitDailyLog(id: string): Promise<SubmitActionResult> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();
  const { data: existing, error: fetchError } = await supabase
    .from("daily_work_logs")
    .select("submitted_at, work_status")
    .eq("id", id)
    .eq("employee_id", employee.id)
    .single();
  if (fetchError || !existing) return { error: fetchError?.message ?? "Report not found.", submittedAt: null };
  if (existing.submitted_at) return { error: "This report has already been submitted.", submittedAt: existing.submitted_at };
  // 2026-08-12 (round 6): "agar report pending hai to update ka option ho,
  // compleate hai to direct submit" — a final, locking Submit is only
  // valid once the work itself is marked Completed. Anything else should
  // go through the (non-finalizing) Update path in upsertDailyLog instead
  // — enforced server-side, not just by which button the form shows.
  if (existing.work_status !== "Completed") {
    return { error: "Mark Work Status as Completed before submitting.", submittedAt: null };
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await supabase
    .from("daily_work_logs")
    .update({ submitted_at: nowIso })
    .eq("id", id)
    .eq("employee_id", employee.id)
    .is("submitted_at", null) // defense in depth against a concurrent double-submit racing the check above
    .select("submitted_at")
    .single();
  if (error || !data) return { error: error?.message ?? "This report has already been submitted.", submittedAt: null };
  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/admin");
  return { error: null, submittedAt: data.submitted_at };
}
