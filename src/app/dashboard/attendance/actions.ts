"use server";

import { revalidatePath } from "next/cache";
import { requireCapability, getAuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { recordPunchIn, recordPunchOut } from "@/lib/attendance/punch";
import { todayIST, addDaysToDateStr } from "@/lib/attendance/ist-date";

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

// 2026-09-02: "agar employee back date me report submit kare to iska koi
// option nahi hai" — employees can now log/backdate a Daily Work Report
// entry for any of the last 7 days (today included), not just today.
// Server-side is the authoritative check (the client's date picker is just
// UX) — never trust a client-supplied logDate blindly.
const BACKDATE_WINDOW_DAYS = 6; // + today = 7 days total

function validateLogDate(logDate: string): string | null {
  if (!logDate) return null; // falls back to todayIST() below, always valid
  const today = todayIST();
  const minDate = addDaysToDateStr(today, -BACKDATE_WINDOW_DAYS);
  if (logDate > today) return "You can't log work for a future date.";
  if (logDate < minDate) return `You can only log work for the last 7 days (from ${minDate}).`;
  return null;
}

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
  // 2026-09-01 — "Today's Work -> Carry Forward": Priority didn't exist on
  // this table before. "" falls back to the column's own DB default
  // ('Medium') rather than writing an empty string.
  priority: string;
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
  const dateError = validateLogDate(input.logDate);
  if (dateError) return { error: dateError, id: null, updatedAt: null };
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
    // 2026-08-17: server-side backstop matching daily-report-form.tsx's own
    // MAX_HOURS_PER_ROW (24h/row) — the client already clamps the Hours
    // box as you type, but that's not authoritative; this is what actually
    // stops an absurd value (the "10 ghante, 50 ghante" bug report) from
    // ever reaching the DB, regardless of how the request got here.
    estimated_time_minutes: input.estimatedTimeMinutes ? Math.max(0, Math.min(24 * 60, parseInt(input.estimatedTimeMinutes, 10) || 0)) : null,
    time_spent_seconds: input.timeSpentMinutes ? Math.max(0, Math.min(24 * 60, parseInt(input.timeSpentMinutes, 10) || 0)) * 60 : 0,
    // 2026-09-01: priority is NOT NULL DEFAULT 'Medium' on the table —
    // fall back explicitly rather than writing an empty string.
    priority: input.priority || "Medium",
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

// 2026-08-24 — "submit button single click me work karna chahiye bahut hang
// hota hai" (submit button should work in one click, it hangs a lot). ROOT
// CAUSE: the form's handleSubmit() previously called saveRow() (→
// upsertDailyLog, a full request) THEN submitDailyLog(id) (a SECOND full
// request) sequentially, and each of those independently re-resolves
// getAuthedEmployee() — which itself does ~8-9 Supabase round trips
// (auth.getUser, MFA AAL check, employees, roles, role_capabilities,
// employee_company_access, employee_store_access, leave_coverage_assignments,
// and sometimes a stores lookup). One click was paying that identity-
// resolution cost TWICE, back to back, plus two separate network
// round-trips for the actual upsert+finalize — easily a multi-second wait
// on a slow connection, which reads as "hanging". This single combined
// action does the save-and-finalize as ONE request (one getAuthedEmployee()
// call, one DB write), replacing the saveRow()+submitDailyLog() pair for
// the Submit button specifically (the separate "Update" button/auto-save
// path for non-Completed rows still uses upsertDailyLog as before — no
// change there). The other half of the fix is on the client: the button
// now disables itself the INSTANT it's clicked, before this request even
// starts, instead of only after the first of the two old requests resolved
// — see daily-report-form.tsx's handleSubmit.
export async function saveAndSubmitDailyLog(input: DailyLogInput): Promise<{ error: string | null; id: string | null; submittedAt: string | null }> {
  // Same business rule as submitDailyLog: only a row marked Completed can
  // be finalized. Checked directly against the input here (this action
  // writes exactly that work_status), rather than writing first and
  // re-fetching to check, the way the old two-call flow had to.
  if (input.workStatus !== "Completed") {
    return { error: "Mark Work Status as Completed before submitting.", id: null, submittedAt: null };
  }
  const dateError = validateLogDate(input.logDate);
  if (dateError) return { error: dateError, id: null, submittedAt: null };

  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();
  const nowIso = new Date().toISOString();

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
    estimated_time_minutes: input.estimatedTimeMinutes ? Math.max(0, Math.min(24 * 60, parseInt(input.estimatedTimeMinutes, 10) || 0)) : null,
    time_spent_seconds: input.timeSpentMinutes ? Math.max(0, Math.min(24 * 60, parseInt(input.timeSpentMinutes, 10) || 0)) * 60 : 0,
    priority: input.priority || "Medium",
    updated_at: nowIso,
    submitted_at: nowIso,
  };

  if (input.id) {
    // Same .is("submitted_at", null) guard as upsertDailyLog/submitDailyLog
    // — can't overwrite an already-finalized row, whether this is a true
    // double-click race or a stale tab.
    const { data, error } = await supabase
      .from("daily_work_logs")
      .update(row)
      .eq("id", input.id)
      .eq("employee_id", employee.id)
      .is("submitted_at", null)
      .select("id, submitted_at")
      .single();
    if (error || !data) {
      const message = error?.code === "PGRST116" ? "This report has already been submitted." : (error?.message ?? "Could not submit.");
      return { error: message, id: null, submittedAt: null };
    }
    revalidatePath("/dashboard/attendance");
    revalidatePath("/dashboard/attendance/admin");
    return { error: null, id: data.id, submittedAt: data.submitted_at };
  }

  const { data, error } = await supabase.from("daily_work_logs").insert(row).select("id, submitted_at").single();
  if (error) return { error: error.message, id: null, submittedAt: null };
  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/admin");
  return { error: null, id: data.id, submittedAt: data.submitted_at };
}

// ============================================================================
// 2026-09-01 — "Today's Work -> Carry Forward" (additive, on top of the
// existing Daily Work Report above — punch in/out and the auto-save/Submit
// flow above are all unchanged). "Incomplete Work" (Pending/In Progress
// rows for today) gets 3 direct actions: ✓ Complete Today, → Carry
// Forward, and Delete (Delete reuses the existing deleteDailyLog above
// unchanged — a Pending/In Progress row is never submitted, so its
// .is("submitted_at", null) guard already allows it).
// ============================================================================

type CarryForwardResult = { error: string | null; carriedToDate: string | null; newId: string | null };

/**
 * → Carry Forward — called from the Incomplete Work section, after the
 * user confirms the "Carry this work to tomorrow?" popup. Two-step,
 * insert-then-freeze, same order/shape as the existing automatic
 * carryOverPendingDailyLogs() (carry-over.ts): insert the tomorrow-dated
 * child row first, THEN mark the original — so if this ever gets
 * interrupted between the two steps, a retry safely self-heals (the
 * child's carried_from_log_id insert will just hit the SAME unique
 * violation on retry and this function looks up the existing child instead
 * of erroring, then re-applies the (idempotent) update to the original).
 *
 * Idempotency guard: reuses the EXISTING partial unique index
 * `idx_daily_work_logs_carried_from_unique ON daily_work_logs
 * (carried_from_log_id) WHERE carried_from_log_id IS NOT NULL` — added
 * earlier for the automatic next-day carry-over, and already exactly the
 * right shape for "at most one child per original". A double-click, a
 * refresh-and-retry, or two tabs racing each other all collide on that
 * same index rather than the client's disabled-button state (which is not
 * robust against any of those on its own).
 *
 * Deliberately does NOT touch time_spent_seconds on the new row (stays 0
 * — "do NOT carry today's actual time spent into tomorrow") and does NOT
 * touch qty_done (a fresh task hasn't done anything yet either). Expected
 * Time (estimated_time_minutes), Work Type (category), Priority, and
 * Notes (remark_sku) all carry over, per spec.
 */
export async function carryForwardDailyLog(id: string): Promise<CarryForwardResult> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();

  const { data: original, error: fetchError } = await supabase
    .from("daily_work_logs")
    .select("id, employee_id, company_id, log_date, category, description, target_qty, remark_sku, estimated_time_minutes, priority, work_status, carried_forward, carried_to_date, submitted_at")
    .eq("id", id)
    .eq("employee_id", employee.id) // defense in depth — can only ever act on your own rows
    .single();
  if (fetchError || !original) return { error: fetchError?.message ?? "Task not found.", carriedToDate: null, newId: null };

  // Already carried forward (a genuine double-submit, refresh-and-retry, or
  // a race with another tab) — idempotent no-op: look up the existing
  // child instead of erroring or creating a second one.
  if (original.carried_forward || original.work_status === "Carried Forward") {
    const { data: existingChild } = await supabase
      .from("daily_work_logs")
      .select("id, log_date")
      .eq("carried_from_log_id", original.id)
      .maybeSingle();
    return { error: null, carriedToDate: existingChild?.log_date ?? original.carried_to_date, newId: existingChild?.id ?? null };
  }
  // A Completed (or already-submitted) task has nothing left to carry —
  // Carry Forward only applies to still-open (Pending/In Progress) work.
  if (original.work_status === "Completed" || original.submitted_at) {
    return { error: "This task is already completed — nothing to carry forward.", carriedToDate: null, newId: null };
  }

  const tomorrow = addDaysToDateStr(original.log_date, 1);

  const { data: inserted, error: insertError } = await supabase
    .from("daily_work_logs")
    .insert({
      employee_id: original.employee_id,
      company_id: original.company_id,
      log_date: tomorrow,
      category: original.category,
      description: original.description,
      target_qty: original.target_qty,
      work_status: "Pending",
      remark_sku: original.remark_sku,
      estimated_time_minutes: original.estimated_time_minutes,
      time_spent_seconds: 0, // never carry actual time spent into tomorrow
      priority: original.priority,
      carried_from_log_id: original.id,
    })
    .select("id, log_date")
    .single();

  let childId: string | null = null;
  let childDate: string = tomorrow;
  if (insertError) {
    if (insertError.code === "23505") {
      // Unique-violation race — someone else's request already created the
      // child a moment ago. Fetch it instead of failing the user's click.
      const { data: existingChild } = await supabase
        .from("daily_work_logs")
        .select("id, log_date")
        .eq("carried_from_log_id", original.id)
        .maybeSingle();
      childId = existingChild?.id ?? null;
      childDate = existingChild?.log_date ?? tomorrow;
    } else {
      return { error: insertError.message, carriedToDate: null, newId: null };
    }
  } else {
    childId = inserted.id;
    childDate = inserted.log_date;
  }

  // Freeze the original — status flips to 'Carried Forward' (a terminal,
  // system-set status, not one of the manually-selectable WORK_STATUSES
  // options) and submitted_at is set so it's finalized/read-only in the
  // form and shows up in Report History / My Recent Reports / the Admin
  // Team Daily Work Log the same way every other filter on this table
  // already works (all filter on submitted_at IS NOT NULL) — "the original
  // day's record must remain UNCHANGED and visible in history otherwise".
  const { error: updateError } = await supabase
    .from("daily_work_logs")
    .update({ work_status: "Carried Forward", carried_forward: true, carried_to_date: childDate, submitted_at: new Date().toISOString() })
    .eq("id", original.id)
    .eq("employee_id", employee.id)
    .is("submitted_at", null); // idempotent — a retry after the freeze already happened just no-ops here

  if (updateError) return { error: updateError.message, carriedToDate: childDate, newId: childId };

  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/admin");
  return { error: null, carriedToDate: childDate, newId: childId };
}

/**
 * ✓ Complete Today — a one-click finalize straight from the Incomplete
 * Work section, for a task the employee actually finished but hadn't yet
 * flipped to Completed + Submitted through the main form. Sets both
 * work_status and submitted_at in one write (unlike the main form's flow,
 * which requires Work Status already be Completed before Submit is even
 * shown) — this button IS that "mark it Completed" step. Same
 * .is("submitted_at", null) idempotency guard as submitDailyLog/
 * saveAndSubmitDailyLog above.
 */
export async function completeIncompleteWorkToday(id: string): Promise<SubmitActionResult> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();
  const nowIso = new Date().toISOString();

  const { data, error } = await supabase
    .from("daily_work_logs")
    .update({ work_status: "Completed", submitted_at: nowIso, updated_at: nowIso })
    .eq("id", id)
    .eq("employee_id", employee.id)
    .is("submitted_at", null)
    .select("submitted_at")
    .single();
  if (error || !data) {
    const message = error?.code === "PGRST116" ? "This report has already been submitted." : (error?.message ?? "Could not complete.");
    return { error: message, submittedAt: null };
  }
  revalidatePath("/dashboard/attendance");
  revalidatePath("/dashboard/attendance/admin");
  return { error: null, submittedAt: data.submitted_at };
}

// ============================================================================
// 2026-09-04 — Daily Work Planner: an employee's OWN personal recurring
// items, on top of whatever per-ROLE template Admin/HR has set up (that
// side is managed on attendance/admin/page.tsx, gated on attendance_admin
// — see admin/actions.ts's saveWorkPlanTemplate/setWorkPlanTemplateActive
// for the mirror-image admin-side actions). No special capability needed
// beyond being signed in, same as the Daily Work Report above — every
// employee manages only their OWN scope='employee' rows (employee_id is
// always the calling employee's own id, never client-supplied). Both
// layers get materialized into daily_work_logs together each day by
// materializeWorkPlanTemplatesForToday() (src/lib/attendance/
// work-plan-templates.ts), called from page.tsx.
// ============================================================================

export type MyRecurringItemInput = {
  id?: string; // present = edit existing row, absent = create new
  category: string;
  description: string;
  targetQty: string;
  sortOrder: string; // "" = 0
};

/** Add or edit one of the employee's own personal recurring work items. */
export async function saveMyRecurringItem(input: MyRecurringItemInput): Promise<SimpleActionState> {
  const employee = await getAuthedEmployee();
  if (!input.description.trim()) return { error: "Description is required.", success: false };
  const supabase = createServiceRoleClient();

  const row = {
    company_id: employee.currentCompanyId,
    scope: "employee" as const,
    role_name: null,
    employee_id: employee.id,
    category: input.category || null,
    description: input.description.trim(),
    target_qty: input.targetQty || null,
    sort_order: input.sortOrder ? Math.max(0, parseInt(input.sortOrder, 10) || 0) : 0,
    created_by: employee.id,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    // Defense in depth — can only ever edit your own scope='employee' rows.
    const { error } = await supabase
      .from("work_plan_templates")
      .update(row)
      .eq("id", input.id)
      .eq("employee_id", employee.id)
      .eq("scope", "employee");
    if (error) return { error: error.message, success: false };
  } else {
    const { error } = await supabase.from("work_plan_templates").insert(row);
    if (error) return { error: error.message, success: false };
  }
  revalidatePath("/dashboard/attendance");
  return { error: null, success: true };
}

/**
 * Deactivate/reactivate one of the employee's own personal recurring
 * items — a soft toggle (not delete), same reasoning as the admin-side
 * setWorkPlanTemplateActive: keeps source_template_id intact on any
 * daily_work_logs row already materialized from it.
 */
export async function setMyRecurringItemActive(id: string, active: boolean): Promise<SimpleActionState> {
  const employee = await getAuthedEmployee();
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("work_plan_templates")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("employee_id", employee.id)
    .eq("scope", "employee");
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/attendance");
  return { error: null, success: true };
}
