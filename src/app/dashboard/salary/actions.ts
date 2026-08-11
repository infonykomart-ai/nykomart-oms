"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";

export type SimpleActionState = { error: string | null; success: boolean };

/**
 * Sets an employee's salary FROM a given date onward — inserts a new
 * versioned row rather than updating in place, so payroll for earlier
 * months (already run/reported) keeps using the salary that was actually
 * in effect then, not today's number. See src/lib/attendance/payroll.ts's
 * comment on the deduction convention this feeds into.
 */
export async function setEmployeeSalary(_prev: SimpleActionState, formData: FormData): Promise<SimpleActionState> {
  const admin = await requireCapability("salary_admin");
  const employeeId = String(formData.get("employee_id") || "").trim();
  const monthlySalary = Number(formData.get("monthly_salary"));
  const allowedLeaves = Number(formData.get("allowed_leaves_per_month") || 1);
  const effectiveFrom = String(formData.get("effective_from") || "").trim();

  if (!employeeId) return { error: "Employee is required.", success: false };
  if (!monthlySalary || monthlySalary <= 0) return { error: "Monthly salary must be a positive number.", success: false };
  if (!effectiveFrom) return { error: "Effective From date is required.", success: false };

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("employee_salary").insert({
    employee_id: employeeId,
    monthly_salary: monthlySalary,
    allowed_leaves_per_month: allowedLeaves,
    effective_from: effectiveFrom,
    entered_by_employee_id: admin.id,
  });
  if (error) return { error: error.message, success: false };
  revalidatePath("/dashboard/salary");
  return { error: null, success: true };
}
