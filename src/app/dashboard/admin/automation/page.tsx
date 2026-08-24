import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { AutomationRulesClient, type AutomationRuleRow } from "./automation-rules-client";

// Automation rules engine — v1 admin screen, 2026-08-24. Built after
// comparing against OpenOMS (an open-source OMS with a trigger/condition/
// action engine) — see claude/openoms-comparison-and-speed-2026-08-24.md.
// Deliberately small v1: one trigger type (order.status_changed, fired
// from Hold/Cancel), one condition + one action per rule, internal-only
// actions (no customer messaging — see db/2026-08-24-automation-rules.sql's
// header for why). See src/lib/automation/engine.ts for execution.
export default async function AutomationRulesPage() {
  const employee = await requireCapability("automation_admin");
  const supabase = await createClient();

  const [{ data: companies }, { data: rules }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase
      .from("automation_rules")
      .select("id, company_id, name, trigger_type, enabled, conditions, actions, fire_count, last_fired_at, created_at")
      .order("created_at", { ascending: false }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">🤖 Automation Rules</h1>
        <p className="mt-1 text-sm text-slate-500">
          Trigger → condition → action. v1 covers one trigger — order Hold/Cancel — and internal-only actions (add a
          note, set a tag). Nothing here sends anything to a customer.
        </p>
      </div>

      <AutomationRulesClient companies={companies ?? []} rules={(rules ?? []) as AutomationRuleRow[]} />
    </div>
  );
}
