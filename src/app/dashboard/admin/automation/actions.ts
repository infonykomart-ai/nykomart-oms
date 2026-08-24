"use server";

// Automation rules engine — v1 admin screen actions, 2026-08-24. See
// db/2026-08-24-automation-rules.sql for the schema/scope rationale and
// src/lib/automation/engine.ts for how a rule actually fires.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { Json } from "@/types/database";
import type { Condition, ActionSpec, ConditionOperator, ActionType } from "@/lib/automation/types";

export type SimpleResult = { error: string | null };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function createAutomationRule(_prev: SimpleResult, formData: FormData): Promise<SimpleResult> {
  const employee = await requireCapability("automation_admin");
  const supabase = createServiceRoleClient();

  const name = str(formData, "name");
  const triggerType = str(formData, "trigger_type");
  const companyId = str(formData, "company_id") || null;
  const conditionField = str(formData, "condition_field");
  const conditionOperator = str(formData, "condition_operator");
  const conditionValue = str(formData, "condition_value");
  const actionType = str(formData, "action_type");
  const actionValue = str(formData, "action_value");

  if (!name) return { error: "Name is required." };
  if (triggerType !== "order.status_changed") return { error: "Invalid trigger type." };
  if (companyId && !employee.companyIds.includes(companyId)) return { error: "You don't have access to this company." };
  if (!actionType || !actionValue) return { error: "An action is required — pick a type and enter what it should do." };

  const conditions: Condition[] =
    conditionField && conditionValue ? [{ field: conditionField, operator: conditionOperator as ConditionOperator, value: conditionValue }] : [];
  const actions: ActionSpec[] = [{ type: actionType as ActionType, value: actionValue }];

  const { error } = await supabase.from("automation_rules").insert({
    company_id: companyId,
    name,
    trigger_type: triggerType,
    conditions: conditions as unknown as Json,
    actions: actions as unknown as Json,
    created_by_employee_id: employee.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/automation");
  return { error: null };
}

export async function toggleAutomationRule(id: string, enabled: boolean): Promise<SimpleResult> {
  await requireCapability("automation_admin");
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("automation_rules").update({ enabled }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/admin/automation");
  return { error: null };
}

export async function deleteAutomationRule(id: string): Promise<SimpleResult> {
  await requireCapability("automation_admin");
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("automation_rules").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/admin/automation");
  return { error: null };
}
