// 2026-09-05 — AI Companion Access — MD/Admin picks exactly which
// employees see the live companion (companion_enabled), one person at a
// time. See actions.ts and db/2026-09-05-ai-companion-live.sql.
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { CompanionAccessClient } from "./companion-access-client";

export default async function CompanionAccessAdminPage() {
  await requireCapability("companion_admin");
  const supabase = await createClient();

  const [{ data: employees }, { data: roles }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, name, role_id, active, photo_url, companion_enabled")
      .order("name"),
    supabase.from("roles").select("id, name"),
  ]);

  const roleNameById = Object.fromEntries((roles ?? []).map((r) => [r.id, r.name]));
  const rows = (employees ?? []).map((e) => ({
    id: e.id,
    name: e.name,
    roleName: roleNameById[e.role_id] ?? "",
    active: e.active,
    photoUrl: e.photo_url,
    companionEnabled: e.companion_enabled,
  }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">AI Companion Access</h1>
        <p className="mt-1 text-sm text-slate-500">
          Turn the live AI Companion on or off for specific employees — a per-person switch, not a role
          permission. Changes apply instantly, no code deployment needed.
        </p>
      </div>

      <CompanionAccessClient employees={rows} />
    </div>
  );
}
