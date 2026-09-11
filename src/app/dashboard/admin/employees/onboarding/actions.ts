"use server";

// 2026-09-11 (Payroll Phase 3) — Onboarding Checklist. See
// db/2026-09-11-core-hr-onboarding-orgchart-documents.sql for the schema
// design. Gated the SAME employee_admin capability as the rest of
// /dashboard/admin/employees — no new capability added.
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";

export type OnboardingActionState = { error: string | null; success: boolean; message?: string };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

/** Create or update a checklist template item. Pass `id` (hidden field) to update; omit it to create a new one. */
export async function manageChecklistItem(_prev: OnboardingActionState, formData: FormData): Promise<OnboardingActionState> {
  const admin = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const id = str(formData, "id") || null;
  const title = str(formData, "title");
  const sortOrder = Number(formData.get("sort_order") || 0);
  const active = str(formData, "active") !== "false";
  const companyId = str(formData, "company_id");

  if (!title) return { error: "Checklist item title is required.", success: false };

  if (id) {
    const { data: existing } = await supabase.from("onboarding_checklist_items").select("id, company_id").eq("id", id).maybeSingle();
    if (!existing || !admin.companyIds.includes(existing.company_id)) return { error: "Checklist item not found.", success: false };
    const { error } = await supabase.from("onboarding_checklist_items").update({ title, sort_order: sortOrder, active }).eq("id", id);
    if (error) return { error: error.message, success: false };
  } else {
    if (!companyId || !admin.companyIds.includes(companyId)) return { error: "Company is required.", success: false };
    const { error } = await supabase.from("onboarding_checklist_items").insert({ company_id: companyId, title, sort_order: sortOrder, active });
    if (error) {
      const msg = error.code === "23505" ? `"${title}" already exists for this company.` : error.message;
      return { error: msg, success: false };
    }
  }

  revalidatePath("/dashboard/admin/employees/onboarding");
  return { error: null, success: true, message: `"${title}" saved.` };
}

/**
 * Toggles one (employee, checklist item) as done/undone — a plain upsert
 * against the PRIMARY KEY (employee_id, checklist_item_id), same simple
 * pattern as leave_coverage_assignments' delete-then-insert elsewhere in
 * this app, just simpler since there's only ever one row per pair.
 */
export async function toggleOnboardingItem(
  employeeId: string,
  checklistItemId: string,
  completed: boolean
): Promise<OnboardingActionState> {
  const admin = await requireCapability("employee_admin");
  const supabase = createServiceRoleClient();

  const [{ data: emp }, { data: item }] = await Promise.all([
    supabase.from("employees").select("id, company_id").eq("id", employeeId).single(),
    supabase.from("onboarding_checklist_items").select("id, company_id").eq("id", checklistItemId).single(),
  ]);
  if (!emp || !admin.companyIds.includes(emp.company_id)) return { error: "Employee not found.", success: false };
  if (!item || !admin.companyIds.includes(item.company_id)) return { error: "Checklist item not found.", success: false };
  if (item.company_id !== emp.company_id) return { error: "That checklist item doesn't belong to this employee's company.", success: false };

  const { error } = await supabase.from("employee_onboarding_progress").upsert(
    {
      employee_id: employeeId,
      checklist_item_id: checklistItemId,
      completed_at: completed ? new Date().toISOString() : null,
      completed_by_employee_id: completed ? admin.id : null,
    },
    { onConflict: "employee_id,checklist_item_id" }
  );
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/admin/employees/onboarding");
  return { error: null, success: true };
}
