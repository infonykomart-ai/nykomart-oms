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
  estimatedTime: string;
  timeTaken: string;
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
    estimated_time: input.estimatedTime || null,
    time_taken: input.timeTaken || null,
    remark_sku: input.remarkSku || null,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("daily_work_logs")
      .update(row)
      .eq("id", input.id)
      .eq("employee_id", employee.id) // defense in depth — can only ever touch your own rows
      .select("id, updated_at")
      .single();
    if (error) return { error: error.message, id: null, updatedAt: null };
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
  const { error } = await supabase.from("daily_work_logs").delete().eq("id", id).eq("employee_id", employee.id);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/attendance");
  return { error: null, success: true };
}
