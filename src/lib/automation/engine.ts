// Automation rules engine — v1, 2026-08-24. Trigger -> condition -> action,
// modeled loosely on OpenOMS's internal/automation/{types,condition,engine}.go
// (Event -> AND-only Condition -> Action) but much smaller — see
// claude/openoms-comparison-and-speed-2026-08-24.md and
// db/2026-08-24-automation-rules.sql for the comparison and scope decision.
//
// Deliberately conservative: actions only touch orders.remark/automation_tag
// (both purely internal fields) — nothing here can message a customer, and
// nothing here can set orders.status, so a rule can never re-trigger itself
// (loop-proof by construction, not by a guard we have to remember to keep
// correct). fireEvent() never throws — a bad/misconfigured rule logs an
// error row and moves on, it never breaks the real action that fired the
// event.
import type { createServiceRoleClient } from "@/lib/supabase/server";
import type { Condition, ActionSpec, TriggerType, OrderStatusChangedEvent } from "./types";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

function resolveField(event: Record<string, unknown>, field: string): string {
  const v = event[field];
  return v === null || v === undefined ? "" : String(v);
}

function evaluateCondition(event: Record<string, unknown>, condition: Condition): boolean {
  const actual = resolveField(event, condition.field);
  switch (condition.operator) {
    case "eq":
      return actual === condition.value;
    case "neq":
      return actual !== condition.value;
    case "contains":
      return actual.toLowerCase().includes(condition.value.toLowerCase());
    default:
      return false;
  }
}

/** AND-only, matching the migration's documented v1 scope. Empty conditions = always matches. */
function evaluateConditions(event: Record<string, unknown>, conditions: Condition[]): boolean {
  return conditions.every((c) => evaluateCondition(event, c));
}

async function executeAction(supabase: ServiceClient, orderId: string, action: ActionSpec): Promise<void> {
  if (action.type === "add_remark") {
    const { data: order } = await supabase.from("orders").select("remark").eq("id", orderId).maybeSingle();
    const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
    const note = `[Auto ${stamp}] ${action.value}`;
    const nextRemark = order?.remark ? `${order.remark}\n${note}` : note;
    const { error } = await supabase.from("orders").update({ remark: nextRemark }).eq("id", orderId);
    if (error) throw new Error(error.message);
    return;
  }
  if (action.type === "set_tag") {
    const { error } = await supabase.from("orders").update({ automation_tag: action.value }).eq("id", orderId);
    if (error) throw new Error(error.message);
    return;
  }
}

/**
 * Fires every enabled rule for a trigger type (scoped to the event's company,
 * or company_id IS NULL rules that apply everywhere), evaluates its
 * conditions against the event, and runs its actions in order if they match.
 * Never throws — call it fire-and-forget from the real action after that
 * action's own write already succeeded.
 */
export async function fireEvent(
  supabase: ServiceClient,
  triggerType: TriggerType,
  event: OrderStatusChangedEvent
): Promise<void> {
  try {
    const { data: rules } = await supabase
      .from("automation_rules")
      .select("id, conditions, actions, company_id")
      .eq("trigger_type", triggerType)
      .eq("enabled", true);

    if (!rules || rules.length === 0) return;

    const eventData = event as unknown as Record<string, unknown>;

    for (const rule of rules) {
      if (rule.company_id && rule.company_id !== event.companyId) continue;

      const conditions = (rule.conditions as unknown as Condition[]) ?? [];
      const actions = (rule.actions as unknown as ActionSpec[]) ?? [];
      if (!evaluateConditions(eventData, conditions)) continue;

      try {
        for (const action of actions) {
          await executeAction(supabase, event.orderId, action);
        }
        await supabase
          .from("automation_rule_logs")
          .insert({ rule_id: rule.id, order_id: event.orderId, result: "applied", detail: null });
        // fire_count is a read-then-write increment (Supabase's query
        // builder has no atomic increment without an RPC) — a small race
        // window under concurrent fires of the same rule is acceptable for
        // a purely informational counter.
        const { data: current } = await supabase.from("automation_rules").select("fire_count").eq("id", rule.id).maybeSingle();
        await supabase
          .from("automation_rules")
          .update({ fire_count: (current?.fire_count ?? 0) + 1, last_fired_at: new Date().toISOString() })
          .eq("id", rule.id);
      } catch (actionError) {
        await supabase.from("automation_rule_logs").insert({
          rule_id: rule.id,
          order_id: event.orderId,
          result: "error",
          detail: actionError instanceof Error ? actionError.message : "Unknown error",
        });
      }
    }
  } catch {
    // Rule loading itself failed (e.g. table not migrated yet in this
    // environment) — never let that break the caller's real action.
  }
}
