"use server";

// MD self-service Roles & Permissions editor — implements pending item 2:
// "jisko jo permission set karni hai hai vo md ke pass honi chhiaye vo
// apne login kar ke set kar sake konse section ko kisko permision deni
// hai." A thin UI over the existing role_capabilities join table (see
// db/schema.sql) — granting/revoking a capability is a plain data change,
// never a redeploy, exactly the separation of concerns capability-info.ts's
// own comment describes.
//
// 2026-09-15 — "agar naye role banayenge to kese banayenge": createRole /
// renameRole / deleteRole below make roles fully self-service too. All are
// gated to `permissions_admin` and audited, and every destructive path has
// a server-side guard mirroring the client hints:
//   • createRole refuses duplicate names (roles.name is UNIQUE anyway).
//   • deleteRole refuses when the role still has employees, or when it's
//     the last role holding `permissions_admin` (same lockout rule
//     toggleRoleCapability enforces).
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log-audit";
import { revalidatePath } from "next/cache";

export type ToggleResult = { error: string | null };
export type RoleActionState = { error: string | null; ok: boolean };

/**
 * Grants or revokes one (role, capability) pair. Refuses to remove
 * `permissions_admin` from the last role that still has it — without this
 * guard, an MD/Admin could accidentally revoke their own (or every role's)
 * access to this very screen and have no way back in short of a direct
 * database edit.
 */
export async function toggleRoleCapability(
  roleId: string,
  capabilityCode: string,
  grant: boolean
): Promise<ToggleResult> {
  const employee = await requireCapability("permissions_admin");
  const supabase = createServiceRoleClient();

  if (!grant && capabilityCode === "permissions_admin") {
    const { count } = await supabase
      .from("role_capabilities")
      .select("role_id", { count: "exact", head: true })
      .eq("capability_code", "permissions_admin");
    if ((count ?? 0) <= 1) {
      return { error: "This is the last role with Permissions access — it cannot be removed (to prevent lockout)." };
    }
  }

  if (grant) {
    const { error } = await supabase
      .from("role_capabilities")
      .upsert({ role_id: roleId, capability_code: capabilityCode }, { onConflict: "role_id,capability_code" });
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase
      .from("role_capabilities")
      .delete()
      .eq("role_id", roleId)
      .eq("capability_code", capabilityCode);
    if (error) return { error: error.message };
  }

  // Only reached on an actual, successful data change — the lockout-refusal
  // branch above returns early and never logs.
  const { data: role } = await supabase.from("roles").select("name").eq("id", roleId).maybeSingle();
  await logAudit(supabase, {
    employeeId: employee.id,
    employeeName: employee.name,
    action: grant ? "role_capability.granted" : "role_capability.revoked",
    entityType: "role_capability",
    entityId: `${roleId}:${capabilityCode}`,
    entityLabel: role ? `${role.name} — ${capabilityCode}` : capabilityCode,
    changes: { granted: { from: !grant, to: grant } },
  });

  revalidatePath("/dashboard/admin/permissions");
  revalidatePath("/dashboard");
  return { error: null };
}

/**
 * Creates a new role. `copyFromRoleId` (optional) pre-grants the new role
 * every capability of an existing one — the common case is "Packing should
 * be like Logistics but minus X", which is one duplicate + two unticks
 * instead of 30 ticks from scratch.
 */
export async function createRole(_prev: RoleActionState, formData: FormData): Promise<RoleActionState> {
  const employee = await requireCapability("permissions_admin");
  const supabase = createServiceRoleClient();

  const name = String(formData.get("name") ?? "").trim();
  const copyFromRoleId = String(formData.get("copy_from") ?? "").trim();
  if (!name) return { error: "Role name is required.", ok: false };

  // roles.name is globally UNIQUE — check first so the message is friendly.
  const { data: existing } = await supabase.from("roles").select("id").ilike("name", name).maybeSingle();
  if (existing) return { error: `A role named "${name}" already exists.`, ok: false };

  const { data: created, error } = await supabase.from("roles").insert({ name }).select("id").single();
  if (error || !created) return { error: error?.message ?? "Could not create the role.", ok: false };

  if (copyFromRoleId) {
    const { data: grants } = await supabase
      .from("role_capabilities")
      .select("capability_code")
      .eq("role_id", copyFromRoleId);
    if (grants && grants.length > 0) {
      const { error: copyError } = await supabase
        .from("role_capabilities")
        .upsert(
          grants.map((g) => ({ role_id: created.id, capability_code: g.capability_code })),
          { onConflict: "role_id,capability_code" }
        );
      if (copyError) return { error: copyError.message, ok: false };
    }
  }

  await logAudit(supabase, {
    employeeId: employee.id,
    employeeName: employee.name,
    action: "role.created",
    entityType: "role",
    entityId: created.id,
    entityLabel: name,
    changes: { name: { from: null, to: name }, copied_from: { from: null, to: copyFromRoleId || null } },
  });

  revalidatePath("/dashboard/admin/permissions");
  revalidatePath("/dashboard");
  return { error: null, ok: true };
}

export async function renameRole(roleId: string, newName: string): Promise<RoleActionState> {
  const employee = await requireCapability("permissions_admin");
  const supabase = createServiceRoleClient();

  const name = newName.trim();
  if (!name) return { error: "Role name cannot be empty.", ok: false };

  const { data: existing } = await supabase
    .from("roles")
    .select("id")
    .ilike("name", name)
    .neq("id", roleId)
    .maybeSingle();
  if (existing) return { error: `A role named "${name}" already exists.`, ok: false };

  const { data: before } = await supabase.from("roles").select("name").eq("id", roleId).maybeSingle();
  const { error } = await supabase.from("roles").update({ name }).eq("id", roleId);
  if (error) return { error: error.message, ok: false };

  await logAudit(supabase, {
    employeeId: employee.id,
    employeeName: employee.name,
    action: "role.renamed",
    entityType: "role",
    entityId: roleId,
    entityLabel: name,
    changes: { name: { from: before?.name ?? null, to: name } },
  });

  revalidatePath("/dashboard/admin/permissions");
  revalidatePath("/dashboard");
  return { error: null, ok: true };
}

export async function deleteRole(roleId: string): Promise<RoleActionState> {
  const employee = await requireCapability("permissions_admin");
  const supabase = createServiceRoleClient();

  // Guard 1 — the last role holding permissions_admin can never be deleted.
  const { data: caps } = await supabase
    .from("role_capabilities")
    .select("capability_code")
    .eq("role_id", roleId);
  const isPermissionsHolder = (caps ?? []).some((c) => c.capability_code === "permissions_admin");
  if (isPermissionsHolder) {
    const { count } = await supabase
      .from("role_capabilities")
      .select("role_id", { count: "exact", head: true })
      .eq("capability_code", "permissions_admin");
    if ((count ?? 0) <= 1) {
      return { error: "This is the last role with Permissions access — it cannot be deleted (to prevent lockout).", ok: false };
    }
  }

  // Guard 2 — refuse while employees are still assigned to the role.
  const { count: employeeCount } = await supabase
    .from("employees")
    .select("id", { count: "exact", head: true })
    .eq("role_id", roleId);
  if ((employeeCount ?? 0) > 0) {
    return {
      error: `${employeeCount} employee(s) still use this role — move them to another role first (Employees page → role dropdown).`,
      ok: false,
    };
  }

  const { data: role } = await supabase.from("roles").select("name").eq("id", roleId).maybeSingle();
  const { error } = await supabase.from("roles").delete().eq("id", roleId);
  if (error) return { error: error.message, ok: false };

  await logAudit(supabase, {
    employeeId: employee.id,
    employeeName: employee.name,
    action: "role.deleted",
    entityType: "role",
    entityId: roleId,
    entityLabel: role?.name ?? roleId,
    changes: { deleted: { from: true, to: false } },
  });

  revalidatePath("/dashboard/admin/permissions");
  revalidatePath("/dashboard");
  return { error: null, ok: true };
}
