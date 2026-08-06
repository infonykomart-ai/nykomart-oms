import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { PermissionsMatrix } from "./permissions-matrix";

export default async function PermissionsAdminPage() {
  await requireCapability("permissions_admin");
  const supabase = await createClient();

  const [{ data: roles }, { data: capabilities }, { data: grants }] = await Promise.all([
    supabase.from("roles").select("id, name").order("name"),
    supabase.from("capabilities").select("code, description").order("code"),
    supabase.from("role_capabilities").select("role_id, capability_code"),
  ]);

  const initialGrants: Record<string, boolean> = {};
  for (const g of grants ?? []) {
    initialGrants[`${g.role_id}:${g.capability_code}`] = true;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Roles &amp; Permissions</h1>
        <p className="mt-1 text-sm text-slate-500">
          Kis role ko kaunsa section dikhega — yahan se turant badlo, koi code deploy nahi chahiye. Box par click
          karo, turant save ho jayega.
        </p>
      </div>

      <PermissionsMatrix roles={roles ?? []} capabilities={capabilities ?? []} initialGrants={initialGrants} />
    </div>
  );
}
