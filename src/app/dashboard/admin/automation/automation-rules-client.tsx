"use client";

import { useActionState, useState, useTransition } from "react";
import { createAutomationRule, toggleAutomationRule, deleteAutomationRule, type SimpleResult } from "./actions";
import {
  CONDITION_FIELDS_BY_TRIGGER,
  CONDITION_OPERATOR_LABELS,
  ACTION_TYPE_LABELS,
  type Condition,
  type ActionSpec,
} from "@/lib/automation/types";

export type AutomationRuleRow = {
  id: string;
  company_id: string | null;
  name: string;
  trigger_type: string;
  enabled: boolean;
  conditions: unknown;
  actions: unknown;
  fire_count: number;
  last_fired_at: string | null;
  created_at: string;
};

const initial: SimpleResult = { error: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-600";

export function AutomationRulesClient({
  companies,
  rules,
}: {
  companies: { id: string; name: string }[];
  rules: AutomationRuleRow[];
}) {
  const [state, formAction, pending] = useActionState(createAutomationRule, initial);
  const conditionFields = CONDITION_FIELDS_BY_TRIGGER["order.status_changed"];

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-800">New rule</h2>
        {state.error && <p className="rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>Name</label>
            <input name="name" required placeholder="e.g. Flag cancelled Amazon orders" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Company (optional — leave blank for all)</label>
            <select name="company_id" defaultValue="" className={inputClass}>
              <option value="">All companies</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <input type="hidden" name="trigger_type" value="order.status_changed" />
        <p className="text-xs text-slate-500">Trigger: order status changed (Hold or Cancel)</p>

        <div>
          <p className={labelClass}>When (optional — leave value blank to match every order)</p>
          <div className="grid gap-2 sm:grid-cols-3">
            <select name="condition_field" defaultValue="newStatus" className={inputClass}>
              {conditionFields.map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                </option>
              ))}
            </select>
            <select name="condition_operator" defaultValue="eq" className={inputClass}>
              {Object.entries(CONDITION_OPERATOR_LABELS).map(([op, label]) => (
                <option key={op} value={op}>
                  {label}
                </option>
              ))}
            </select>
            <input name="condition_value" placeholder="e.g. Cancelled" className={inputClass} />
          </div>
        </div>

        <div>
          <p className={labelClass}>Then</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <select name="action_type" defaultValue="add_remark" className={inputClass}>
              {Object.entries(ACTION_TYPE_LABELS).map(([type, label]) => (
                <option key={type} value={type}>
                  {label}
                </option>
              ))}
            </select>
            <input name="action_value" required placeholder="Text to add / tag to set" className={inputClass} />
          </div>
        </div>

        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Saving..." : "Create rule"}
        </button>
      </form>

      <div className="space-y-3">
        {rules.length === 0 && <p className="text-sm text-slate-400">No rules yet.</p>}
        {rules.map((rule) => (
          <RuleCard key={rule.id} rule={rule} companies={companies} />
        ))}
      </div>
    </div>
  );
}

function RuleCard({ rule, companies }: { rule: AutomationRuleRow; companies: { id: string; name: string }[] }) {
  const [isPending, startTransition] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [error, setError] = useState("");

  const conditions = (rule.conditions as Condition[] | null) ?? [];
  const actions = (rule.actions as ActionSpec[] | null) ?? [];
  const companyName = companies.find((c) => c.id === rule.company_id)?.name ?? "All companies";

  function handleToggle() {
    setError("");
    startTransition(async () => {
      const r = await toggleAutomationRule(rule.id, !rule.enabled);
      if (r.error) setError(r.error);
    });
  }

  function handleDelete() {
    setError("");
    startTransition(async () => {
      const r = await deleteAutomationRule(rule.id);
      if (r.error) setError(r.error);
      setConfirmingDelete(false);
    });
  }

  return (
    <div className={`rounded-xl border p-4 shadow-sm ${rule.enabled ? "border-slate-200 bg-white" : "border-slate-200 bg-slate-50 opacity-70"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">
            {rule.name} {!rule.enabled && <span className="ml-1 text-xs font-normal text-slate-400">(disabled)</span>}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {companyName} · When order status changes
            {conditions.length > 0 &&
              conditions.map((c, i) => (
                <span key={i}>
                  {" "}
                  and {c.field} {CONDITION_OPERATOR_LABELS[c.operator]} &quot;{c.value}&quot;
                </span>
              ))}
            {conditions.length === 0 && " (any order)"}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            → {actions.map((a) => `${ACTION_TYPE_LABELS[a.type]}: "${a.value}"`).join(", ")}
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Fired {rule.fire_count} time{rule.fire_count === 1 ? "" : "s"}
            {rule.last_fired_at ? ` — last ${new Date(rule.last_fired_at).toLocaleString("en-IN")}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-2 text-xs">
          <button
            type="button"
            disabled={isPending}
            onClick={handleToggle}
            className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
          >
            {rule.enabled ? "Disable" : "Enable"}
          </button>
          {confirmingDelete ? (
            <>
              <button type="button" disabled={isPending} onClick={handleDelete} className="rounded border border-red-300 bg-white px-2 py-1 font-semibold text-red-600 hover:bg-red-50">
                Confirm delete
              </button>
              <button type="button" onClick={() => setConfirmingDelete(false)} className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-500 hover:bg-slate-50">
                Cancel
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmingDelete(true)} className="rounded border border-red-200 bg-white px-2 py-1 font-medium text-red-600 hover:bg-red-50">
              Delete
            </button>
          )}
        </div>
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </div>
  );
}
