"use server";

// MD self-service Roles & Permissions editor — implements pending item 2:
// "jisko jo permission set karni hai hai vo md ke pass honi chhiaye vo
// apne login kar ke set kar sake konse section ko kisko permision deni
// hai." A thin UI over the existing role_capabilities join table (see
// db/schema.sql) — granting/revoking a capability is a plain data change,
// never a redeploy, exactly the separation of concerns capability-info.ts's
// own comment describes.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type ToggleResult = { error: string | null };

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
  await requireCapability("permissions_admin");
  const supabase = createServiceRoleClient();

  if (!grant && capabilityCode === "permissions_admin") {
    const { count } = await supabase
      .from("role_capabilities")
      .select("role_id", { count: "exact", head: true })
      .eq("capability_code", "permissions_admin");
    if ((count ?? 0) <= 1) {
      return { error: "Ye aakhri role hai jiske paas Permissions access hai — ise hataya nahi ja sakta (lockout se bachne ke liye)." };
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

  revalidatePath("/dashboard/admin/permissions");
  revalidatePath("/dashboard");
  return { error: null };
}
