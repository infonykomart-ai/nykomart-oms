"use server";

// 2026-09-05 — AI Companion per-employee access toggle. "YE ADMIN KE PASS
// POWER HO KIS KIS EMPLOYEE KO YE FEATURE APPROVE KARNA HAI" — deliberately
// a plain per-employee column (employees.companion_enabled), not a role
// grant; see db/2026-09-05-ai-companion-live.sql's header comment for why
// this is a one-off deviation from the rest of this codebase's role-based
// permission system. Mirrors toggleRoleCapability's own shape
// (admin/permissions/actions.ts) — optimistic client-side toggle, server
// re-check via requireCapability, logAudit on every actual change.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log-audit";
import { revalidatePath } from "next/cache";

export type ToggleResult = { error: string | null };

export async function setCompanionEnabled(employeeId: string, enabled: boolean): Promise<ToggleResult> {
  const employee = await requireCapability("companion_admin");
  const supabase = createServiceRoleClient();

  const { data: target } = await supabase.from("employees").select("id, name").eq("id", employeeId).maybeSingle();
  if (!target) return { error: "Employee not found." };

  const { error } = await supabase.from("employees").update({ companion_enabled: enabled }).eq("id", employeeId);
  if (error) return { error: error.message };

  await logAudit(supabase, {
    employeeId: employee.id,
    employeeName: employee.name,
    action: enabled ? "companion_access.granted" : "companion_access.revoked",
    entityType: "employee",
    entityId: target.id,
    entityLabel: target.name,
    changes: { companion_enabled: { from: !enabled, to: enabled } },
  });

  revalidatePath("/dashboard/admin/companion-access");
  return { error: null };
}
