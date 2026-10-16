"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
// 2026-10-15/16 — shared with the live punch path (punch.ts) so an
// admin-typed punch time earns exactly the same Present/Late verdict, and
// with the Manual Correction form (a client component) which needs the same
// 09:45 cutoff — hence they live in the dependency-free ist-date.ts.
import {
  attendanceStatusForPunchIn,
  istTimeToInstant,
  normalizeISTTimeInput,
} from "@/lib/attendance/ist-date";
// 2026-10-15 — typed update payload for the "correct an existing day" branch
// below, so a partial update (only the punch times the admin actually typed)
// is checked against the real attendance columns instead of a loose record.
import type { Database } from "@/types/database";

type AttendanceUpdate = Database["public"]["Tables"]["attendance"]["Update"];

// `message` (2026-10-15, optional): an informational "what exactly was saved"
// line (e.g. "Saved — Punch In 09:20 · Punch Out 18:05"), used by the manual
// attendance form so the admin can SEE that the punch times went in. Optional
// on purpose — every other action in this file keeps its two-field contract.
export type SimpleActionState = { error: string | null; success: boolean; message?: string | null };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** company_id = "" means "all companies" (stored as NULL — a national holiday). */
export async function addHoliday(_prev: SimpleActionState, formData: FormData): Promise<SimpleActionState> {
  const employee = await requireCapability("attendance_admin");
  const date = str(formData, "holiday_date");
  const name = str(formData, "name");
  const companyId = str(formData, "company_id");
  if (!date || !name) return { error: "Date and name are both required.", success: false };
  // 2026-08-12 (round 11 security review): company_id was previously
  // trusted straight from the client with no check — an attendance_admin
  // scoped to only one company could otherwise write a holiday for a
  // company they have no access to. "" (all companies / national holiday)
  // stays allowed for everyone with the capability, same as before.
  if (companyId && !employee.companyIds.includes(companyId)) {
    return { error: "You don't have access to that company.", success: false };
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("holidays").insert({
    company_id: companyId || null,
    holiday_date: date,
    name,
    created_by_employee_id: employee.id,
  });
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/attendance/admin");
  revalidatePath("/dashboard/attendance");
  return { error: null, success: true };
}

export async function removeHoliday(id: string): Promise<SimpleActionState> {
  const employee = await requireCapability("attendance_admin");
  const supabase = createServiceRoleClient();

  // 2026-08-17 security fix — addHoliday/setWeeklyOffDays/setManualAttendance
  // in this same file all re-check company access before writing; this one
  // didn't, so an attendance_admin scoped to only one company could delete
  // another company's holiday (company_id NULL = a national/all-companies
  // holiday, left deletable by anyone with the capability, same as
  // addHoliday's own "" case).
  const { data: holiday } = await supabase.from("holidays").select("id, company_id").eq("id", id).maybeSingle();
  if (!holiday) return { error: "Holiday not found.", success: false };
  if (holiday.company_id && !employee.companyIds.includes(holiday.company_id)) {
    return { error: "You don't have access to that company.", success: false };
  }

  const { error } = await supabase.from("holidays").delete().eq("id", id);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/attendance/admin");
  revalidatePath("/dashboard/attendance");
  return { error: null, success: true };
}

/** Weekly off pattern (0=Sunday..6=Saturday) for one company. */
export async function setWeeklyOffDays(_prev: SimpleActionState, formData: FormData): Promise<SimpleActionState> {
  const employee = await requireCapability("attendance_admin");
  const companyId = str(formData, "company_id");
  const days = formData.getAll("weekly_off_days").map((v) => Number(v));
  if (!companyId) return { error: "Company is required.", success: false };
  // 2026-08-12 (round 11 security review): see addHoliday's identical comment above.
  if (!employee.companyIds.includes(companyId)) {
    return { error: "You don't have access to that company.", success: false };
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("companies").update({ weekly_off_days: days }).eq("id", companyId);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/attendance/admin");
  revalidatePath("/dashboard/attendance");
  return { error: null, success: true };
}

// ============================================================================
// 2026-09-04 — Daily Work Planner: per-ROLE fixed/recurring templates.
// Admin/HR builds a baseline list of work items that apply to EVERY
// employee whose role matches (materialized daily each day — see
// src/lib/attendance/work-plan-templates.ts). The employee's own personal
// recurring items (on top of whatever role template applies to them) are
// a separate, self-managed list — see attendance/actions.ts, not here.
// Gated on the same attendance_admin capability as the rest of this file.
// ============================================================================

/**
 * Add or edit one role-scope template item. `id` present = edit an
 * existing row (still scoped to attendance_admin's own company access, so
 * one admin can't silently edit another company's template); absent =
 * create a new one.
 */
export async function saveWorkPlanTemplate(_prev: SimpleActionState, formData: FormData): Promise<SimpleActionState> {
  const admin = await requireCapability("attendance_admin");
  const id = str(formData, "id");
  const companyId = str(formData, "company_id");
  const roleName = str(formData, "role_name");
  const category = str(formData, "category");
  const description = str(formData, "description");
  const targetQty = str(formData, "target_qty");
  const sortOrderRaw = str(formData, "sort_order");
  if (!companyId || !roleName || !description) {
    return { error: "Company, role, and description are all required.", success: false };
  }
  // Same "never trust a client-claimed company" check as addHoliday/
  // setWeeklyOffDays/setManualAttendance above.
  if (!admin.companyIds.includes(companyId)) {
    return { error: "You don't have access to that company.", success: false };
  }

  const supabase = createServiceRoleClient();
  const row = {
    company_id: companyId,
    scope: "role" as const,
    role_name: roleName,
    employee_id: null,
    category: category || null,
    description,
    target_qty: targetQty || null,
    sort_order: sortOrderRaw ? Math.max(0, parseInt(sortOrderRaw, 10) || 0) : 0,
    created_by: admin.id,
    updated_at: new Date().toISOString(),
  };

  if (id) {
    // Verify the row being edited actually belongs to a company this admin
    // can access, before allowing the update (same defense-in-depth as
    // removeHoliday's own re-check above).
    const { data: existing } = await supabase.from("work_plan_templates").select("id, company_id").eq("id", id).eq("scope", "role").maybeSingle();
    if (!existing) return { error: "Template not found.", success: false };
    if (!admin.companyIds.includes(existing.company_id)) {
      return { error: "You don't have access to that company.", success: false };
    }
    const { error } = await supabase.from("work_plan_templates").update(row).eq("id", id);
    if (error) return { error: error.message, success: false };
  } else {
    const { error } = await supabase.from("work_plan_templates").insert(row);
    if (error) return { error: error.message, success: false };
  }
  revalidatePath("/dashboard/attendance/admin");
  revalidatePath("/dashboard/attendance");
  return { error: null, success: true };
}

/**
 * Deactivate/reactivate a role-scope template — a soft toggle rather than
 * a hard delete, so a template that already materialized rows into past
 * daily_work_logs history keeps that history's source_template_id link
 * intact (the FK would otherwise force either a hard block or an ON
 * DELETE that quietly orphans/nulls out old rows' badge). An inactive
 * template simply stops being materialized for any new day.
 */
export async function setWorkPlanTemplateActive(id: string, active: boolean): Promise<SimpleActionState> {
  const admin = await requireCapability("attendance_admin");
  const supabase = createServiceRoleClient();

  const { data: existing } = await supabase.from("work_plan_templates").select("id, company_id").eq("id", id).eq("scope", "role").maybeSingle();
  if (!existing) return { error: "Template not found.", success: false };
  if (!admin.companyIds.includes(existing.company_id)) {
    return { error: "You don't have access to that company.", success: false };
  }

  const { error } = await supabase.from("work_plan_templates").update({ active, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/attendance/admin");
  revalidatePath("/dashboard/attendance");
  return { error: null, success: true };
}

/**
 * Manual attendance correction — mark Present/Absent/Half Day/Leave/Holiday
 * for a specific employee+date (e.g. a missed punch, an approved leave, a
 * one-off half day). Upserts by (employee_id, attendance_date), same unique
 * key the automatic punch-in path uses.
 *
 * 2026-10-16 — "manual correction me employee select nahi ho rahe to kese
 * manual punch karu": this action could only ever set a STATUS, so a missed
 * punch could be marked "Present" but never carry real IN/OUT times (and
 * work_hours — a GENERATED column off punch_in/punch_out — stayed empty).
 * Both times are now accepted as optional "HH:MM" IST values and written as
 * exact instants; leaving them blank keeps the old status-only behaviour.
 */
export async function setManualAttendance(_prev: SimpleActionState, formData: FormData): Promise<SimpleActionState> {
  const admin = await requireCapability("attendance_admin");
  const employeeId = str(formData, "employee_id");
  const companyId = str(formData, "company_id");
  const date = str(formData, "attendance_date");
  const status = str(formData, "status");
  const remark = str(formData, "remark");
  // 2026-10-15/16 — "manual punching kaam nahi kar raha ... usme ye bhi hona
  // chahiye ki kitne baje ka punch dalna hai": the admin can now type the
  // actual punch times, so a manual entry is a real punch (with work hours
  // computed by the generated column) and not just a status label. Both
  // times are optional HH:MM IST values, converted against the SAME date the
  // correction is for — never "now".
  const rawIn = str(formData, "punch_in_time");
  const rawOut = str(formData, "punch_out_time");
  const punchInTime = normalizeISTTimeInput(rawIn);
  const punchOutTime = normalizeISTTimeInput(rawOut);
  if (!employeeId || !companyId || !date) {
    return { error: "Employee, date and (if no time is entered) status are required.", success: false };
  }
  // A typed-but-unparseable time is a user mistake to REPORT, never silently
  // dropped as though the field had been left blank.
  if (rawIn && !punchInTime) return { error: `Punch In "${rawIn}" is not a valid HH:MM time.`, success: false };
  if (rawOut && !punchOutTime) return { error: `Punch Out "${rawOut}" is not a valid HH:MM time.`, success: false };
  if (!status && !punchInTime && !punchOutTime) {
    return { error: "Pick a status, or enter at least one punch time.", success: false };
  }
  if (punchInTime && punchOutTime && punchOutTime <= punchInTime) {
    return { error: "Punch Out time has to be after the Punch In time.", success: false };
  }
  // Converted BEFORE touching the DB: an impossible date ("2026-02-31") is
  // the same class of user mistake as an impossible time, so both come back
  // as an error instead of a silently shifted row.
  const punchInInstant = punchInTime ? istTimeToInstant(date, punchInTime) : null;
  const punchOutInstant = punchOutTime ? istTimeToInstant(date, punchOutTime) : null;
  if (punchInTime && !punchInInstant) {
    return { error: `Punch In "${punchInTime}" is not a valid time for ${date}.`, success: false };
  }
  if (punchOutTime && !punchOutInstant) {
    return { error: `Punch Out "${punchOutTime}" is not a valid time for ${date}.`, success: false };
  }
  // One rule for both branches below: with a punch-in time typed, the status
  // follows the SAME late cutoff the live punch uses (Present up to 09:45
  // IST, Late after) unless the admin picked one explicitly.
  const derivedStatus = punchInTime ? attendanceStatusForPunchIn(punchInTime) : null;
  const effectiveStatus = status || derivedStatus || "";
  // Each punch time above is stored as a real timestamptz (IST +05:30 — see
  // istTimeToInstant), so work_hours (a generated column) and every existing
  // report keep working unchanged.
  // 2026-08-12 (round 11 security review): see addHoliday's identical comment above.
  if (!admin.companyIds.includes(companyId)) {
    return { error: "You don't have access to that company.", success: false };
  }

  const supabase = createServiceRoleClient();

  // 2026-08-17 security fix — the check above only verified the ADMIN can
  // access companyId; it never verified the target employeeId actually
  // belongs to that company. Without this, an attendance_admin scoped to
  // Company A could pass another company's employee_id alongside
  // company_id=A (which they DO have legitimate access to) and write a
  // manual attendance row that misattributes a Company B employee's
  // attendance to Company A — a real data-integrity hole, not just an
  // access-control one. Accessible = the employee's own home company, or
  // an explicit employee_company_access grant (same "which companies can
  // this login act as" logic used everywhere else).
  const [{ data: targetEmployee }, { data: crossAccess }] = await Promise.all([
    supabase.from("employees").select("id, company_id").eq("id", employeeId).maybeSingle(),
    supabase.from("employee_company_access").select("company_id").eq("employee_id", employeeId).eq("company_id", companyId).maybeSingle(),
  ]);
  if (!targetEmployee) return { error: "Employee not found.", success: false };
  if (targetEmployee.company_id !== companyId && !crossAccess) {
    return { error: "That employee doesn't belong to the selected company.", success: false };
  }

  const { data: existing } = await supabase
    .from("attendance")
    .select("id")
    .eq("employee_id", employeeId)
    .eq("attendance_date", date)
    .maybeSingle();

  if (existing) {
    // Only the fields the admin actually filled in are touched: a blank time
    // leaves the stored punch alone instead of wiping a real one (correcting
    // today's status should never silently delete today's punch-in).
    const { data: current } = await supabase
      .from("attendance")
      .select("punch_in, punch_out")
      .eq("id", existing.id)
      .maybeSingle();
    if (punchOutTime && !punchInTime && !current?.punch_in) {
      return { error: "Punch Out needs a Punch In — enter the Punch In time too.", success: false };
    }
    const update: AttendanceUpdate = {
      remark: remark || null,
      entered_by_employee_id: admin.id,
    };
    // No status to write (a punch-OUT-only correction on an existing row) →
    // keep whatever status the day already has rather than writing "".
    if (effectiveStatus) update.status = effectiveStatus as never;
    if (punchInInstant) update.punch_in = punchInInstant;
    if (punchOutInstant) update.punch_out = punchOutInstant;
    const { error } = await supabase.from("attendance").update(update).eq("id", existing.id);
    if (error) return { error: error.message, success: false };
  } else {
    if (punchOutTime && !punchInTime) {
      return { error: "Punch Out needs a Punch In — enter the Punch In time too.", success: false };
    }
    if (!effectiveStatus) {
      return { error: "Pick a status, or enter the Punch In time so the status can be worked out.", success: false };
    }
    const { error } = await supabase.from("attendance").insert({
      employee_id: employeeId,
      company_id: companyId,
      attendance_date: date,
      status: effectiveStatus as never,
      source: "Manual Entry",
      punch_in: punchInInstant,
      punch_out: punchOutInstant,
      remark: remark || null,
      entered_by_employee_id: admin.id,
    });
    if (error) return { error: error.message, success: false };
  }
  revalidatePath("/dashboard/attendance/admin");
  // The corrected day shows on the employee's own Attendance page too.
  revalidatePath("/dashboard/attendance");
  const saved = [
    `Saved — ${date}`,
    `Status ${effectiveStatus}${!status && punchInTime ? " (set from the punch-in time)" : ""}`,
    punchInTime || punchOutTime
      ? `Punch In ${punchInTime || "—"} · Punch Out ${punchOutTime || "—"} (IST)`
      : "no punch times entered",
  ].join(" · ");
  return { error: null, success: true, message: saved };
}
