"use server";

// 2026-10-02b — structured Department master (was free-text on employees).
// Gated by employee_admin — same capability as the Employees screen the
// department select feeds. Rename/deactivate instead of delete: history
// (past reports, employee assignments) keeps pointing at a real row.
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";

export type SimpleActionState = { error: string | null; success: boolean };

function revalidateDepartmentPaths() {
  revalidatePath("/dashboard/admin/departments");
  revalidatePath("/dashboard/admin/employees");
}

function str(formData: FormData, key: string): string {
  const v = formData.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export async function createDepartment(_prev: SimpleActionState, formData: FormData): Promise<SimpleActionState> {
  const authed = await requireCapability("employee_admin");
  const companyId = str(formData, "company_id");
  const name = str(formData, "name");
  if (!name) return { error: "Department name is required.", success: false };
  if (!authed.companyIds.includes(companyId)) return { error: "You don't have access to that company.", success: false };

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("departments").insert({ company_id: companyId, name });
  if (error) {
    if (error.code === "23505" || /duplicate/i.test(error.message)) {
      return { error: `"${name}" already exists for this company.`, success: false };
    }
    return { error: error.message, success: false };
  }
  revalidateDepartmentPaths();
  return { error: null, success: true };
}

export async function renameDepartment(_prev: SimpleActionState, formData: FormData): Promise<SimpleActionState> {
  const authed = await requireCapability("employee_admin");
  const id = str(formData, "id");
  const name = str(formData, "name");
  if (!id || !name) return { error: "Department id and name are required.", success: false };

  const supabase = createServiceRoleClient();
  // Never trust the form's id beyond this employee's own companies.
  const { data: dept } = await supabase.from("departments").select("id, company_id").eq("id", id).maybeSingle();
  if (!dept || !authed.companyIds.includes(dept.company_id)) {
    return { error: "Department not found in your companies.", success: false };
  }

  const { error } = await supabase.from("departments").update({ name }).eq("id", id);
  if (error) {
    if (error.code === "23505" || /duplicate/i.test(error.message)) {
      return { error: `"${name}" already exists for this company.`, success: false };
    }
    return { error: error.message, success: false };
  }
  revalidateDepartmentPaths();
  return { error: null, success: true };
}

export async function setDepartmentActive(_prev: SimpleActionState, formData: FormData): Promise<SimpleActionState> {
  const authed = await requireCapability("employee_admin");
  const id = str(formData, "id");
  const active = str(formData, "active") === "true";
  if (!id) return { error: "Department missing.", success: false };

  const supabase = createServiceRoleClient();
  const { data: dept } = await supabase.from("departments").select("id, company_id").eq("id", id).maybeSingle();
  if (!dept || !authed.companyIds.includes(dept.company_id)) {
    return { error: "Department not found in your companies.", success: false };
  }

  const { error } = await supabase.from("departments").update({ active }).eq("id", id);
  if (error) return { error: error.message, success: false };
  revalidateDepartmentPaths();
  return { error: null, success: true };
}
