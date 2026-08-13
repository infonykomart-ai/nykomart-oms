"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";

export type SimpleActionState = { error: string | null; success: boolean };

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
  await requireCapability("attendance_admin");
  const supabase = createServiceRoleClient();
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

/**
 * Manual attendance correction — mark Present/Absent/Half Day/Leave/Holiday
 * for a specific employee+date (e.g. a missed punch, an approved leave, a
 * one-off half day). Upserts by (employee_id, attendance_date), same unique
 * key the automatic punch-in path uses.
 */
export async function setManualAttendance(_prev: SimpleActionState, formData: FormData): Promise<SimpleActionState> {
  const admin = await requireCapability("attendance_admin");
  const employeeId = str(formData, "employee_id");
  const companyId = str(formData, "company_id");
  const date = str(formData, "attendance_date");
  const status = str(formData, "status");
  const remark = str(formData, "remark");
  if (!employeeId || !companyId || !date || !status) {
    return { error: "Employee, date, and status are all required.", success: false };
  }
  // 2026-08-12 (round 11 security review): see addHoliday's identical comment above.
  if (!admin.companyIds.includes(companyId)) {
    return { error: "You don't have access to that company.", success: false };
  }

  const supabase = createServiceRoleClient();
  const { data: existing } = await supabase
    .from("attendance")
    .select("id")
    .eq("employee_id", employeeId)
    .eq("attendance_date", date)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("attendance")
      .update({ status: status as never, remark: remark || null, entered_by_employee_id: admin.id })
      .eq("id", existing.id);
    if (error) return { error: error.message, success: false };
  } else {
    const { error } = await supabase.from("attendance").insert({
      employee_id: employeeId,
      company_id: companyId,
      attendance_date: date,
      status: status as never,
      source: "Manual Entry",
      remark: remark || null,
      entered_by_employee_id: admin.id,
    });
    if (error) return { error: error.message, success: false };
  }
  revalidatePath("/dashboard/attendance/admin");
  return { error: null, success: true };
}
