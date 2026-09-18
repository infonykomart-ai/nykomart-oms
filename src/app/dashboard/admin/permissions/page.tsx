import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { syncCapabilitiesFromRegistry } from "@/lib/capability-sync";
import { capabilityInfoFor } from "@/lib/capability-info";
import { PermissionsMatrix } from "./permissions-matrix";
import { RolesManager } from "./roles-manager";

export default async function PermissionsAdminPage() {
  await requireCapability("permissions_admin");
  const supabase = await createClient();

  // 2026-09-18 — capability auto-sync ("capabilities apne aap section ke
  // according update honi chahiye"): BEFORE reading the matrix, push the
  // app's live CAPABILITY_INFO registry into the capabilities table via
  // sync_capabilities() (upsert + description refresh; grants untouched).
  // A deploy + one visit to this page is the whole sync — new sections
  // appear for every role automatically, no manual SQL. Sync failure is
  // non-fatal: the matrix still renders from whatever exists, and the
  // console gets the real error.
  const sync = await syncCapabilitiesFromRegistry();
  if (sync.error) {
    console.error("Capability auto-sync failed (matrix may be stale):", sync.error);
  }

  const [{ data: roles }, { data: capabilities }, { data: grants }] = await Promise.all([
    supabase.from("roles").select("id, name").order("name"),
    supabase.from("capabilities").select("code, description").order("code"),
    supabase.from("role_capabilities").select("role_id, capability_code"),
  ]);

  const initialGrants: Record<string, boolean> = {};
  for (const g of grants ?? []) {
    initialGrants[`${g.role_id}:${g.capability_code}`] = true;
  }

  // 2026-09-18 — the matrix's left column now shows the app's real LABEL
  // (e.g. "Bank & Card Reconciliation") above the raw code, using the same
  // registry that just synced — descriptions come from the table (already
  // refreshed by the sync call above).
  const enriched = (capabilities ?? []).map((cap) => {
    const info = capabilityInfoFor(cap.code);
    return { ...cap, label: info?.label ?? null };
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">Roles &amp; Permissions</h1>
      </div>

      {/* 2026-09-15 — "agar naye role banayenge to kese banayenge": role
          create/rename/delete lives directly above the matrix now. */}
      <RolesManager roles={roles ?? []} />

      <PermissionsMatrix roles={roles ?? []} capabilities={enriched} initialGrants={initialGrants} />
    </div>
  );
}
