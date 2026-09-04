"use client";

// 2026-09-04 — Daily Work Planner: per-ROLE fixed/recurring template
// management. Admin/HR builds a baseline list of work items that
// materialize automatically into every matching-role employee's Today's
// Work each day (see src/lib/attendance/work-plan-templates.ts) — on top
// of whatever personal recurring items that employee has ALSO added
// themselves (self-managed, see attendance/page.tsx's own panel, not
// here). A soft "active" toggle rather than delete, so history stays
// linked (see setWorkPlanTemplateActive's own doc comment in actions.ts).
import { useState, useTransition } from "react";
import { saveWorkPlanTemplate, setWorkPlanTemplateActive } from "./actions";

export type WorkPlanTemplateRow = {
  id: string;
  roleName: string;
  category: string | null;
  description: string;
  targetQty: string | null;
  sortOrder: number;
  active: boolean;
};

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

const emptyForm = { id: "", roleName: "", category: "", description: "", targetQty: "", sortOrder: "" };

export function WorkPlanTemplatesPanel({
  companyId,
  roles,
  templates,
}: {
  companyId: string;
  roles: { id: string; name: string }[];
  templates: WorkPlanTemplateRow[];
}) {
  const [form, setForm] = useState(emptyForm);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function startEdit(t: WorkPlanTemplateRow) {
    setForm({ id: t.id, roleName: t.roleName, category: t.category ?? "", description: t.description, targetQty: t.targetQty ?? "", sortOrder: String(t.sortOrder) });
    setSuccess(false);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(false);
    setError(null);
    const fd = new FormData();
    fd.set("id", form.id);
    fd.set("company_id", companyId);
    fd.set("role_name", form.roleName);
    fd.set("category", form.category);
    fd.set("description", form.description);
    fd.set("target_qty", form.targetQty);
    fd.set("sort_order", form.sortOrder);
    startTransition(async () => {
      const result = await saveWorkPlanTemplate({ error: null, success: false }, fd);
      if (result.error) {
        setError(result.error);
      } else {
        setSuccess(true);
        setForm(emptyForm);
      }
    });
  }

  function toggleActive(id: string, active: boolean) {
    startTransition(async () => {
      await setWorkPlanTemplateActive(id, active);
    });
  }

  const grouped = new Map<string, WorkPlanTemplateRow[]>();
  for (const t of templates) {
    if (!grouped.has(t.roleName)) grouped.set(t.roleName, []);
    grouped.get(t.roleName)!.push(t);
  }

  return (
    <div>
      {templates.length === 0 && <p className="mb-3 text-xs text-slate-400">No fixed role templates set up yet — every employee currently only sees their own ad-hoc/personal items.</p>}
      <div className="mb-4 space-y-3">
        {Array.from(grouped.entries()).map(([roleName, rows]) => (
          <div key={roleName}>
            <h3 className="mb-1 text-xs font-semibold text-slate-500">{roleName}</h3>
            <div className="space-y-1">
              {rows
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((t) => (
                  <div key={t.id} className={`flex flex-wrap items-center gap-2 rounded border px-2.5 py-1.5 text-xs ${t.active ? "border-slate-100" : "border-slate-100 bg-slate-50 opacity-60"}`}>
                    <span className="text-slate-400">[{t.category ?? "—"}]</span>
                    <span className="flex-1 text-slate-800">{t.description}</span>
                    {t.targetQty && <span className="text-slate-400">Target: {t.targetQty}</span>}
                    {!t.active && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-slate-500">Inactive</span>}
                    <button type="button" onClick={() => startEdit(t)} className="text-amber-700 hover:underline">Edit</button>
                    <button type="button" disabled={pending} onClick={() => toggleActive(t.id, !t.active)} className="text-rose-600 hover:underline disabled:opacity-50">
                      {t.active ? "Deactivate" : "Reactivate"}
                    </button>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="space-y-2 border-t border-slate-100 pt-3">
        {error && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{error}</p>}
        {success && <p className="rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">✓ Saved.</p>}
        <div className="grid grid-cols-2 gap-2">
          <select value={form.roleName} onChange={(e) => setForm((f) => ({ ...f, roleName: e.target.value }))} required className={inputClass}>
            <option value="">Select role…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.name}>{r.name}</option>
            ))}
          </select>
          <input
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            placeholder="Work Type (optional, e.g. Order Management)"
            className={inputClass}
          />
        </div>
        <input
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          required
          placeholder="Description (e.g. Check overnight orders and enter them)"
          className={inputClass}
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            value={form.targetQty}
            onChange={(e) => setForm((f) => ({ ...f, targetQty: e.target.value }))}
            placeholder="Target Qty (optional)"
            className={inputClass}
          />
          <input
            type="number"
            min={0}
            value={form.sortOrder}
            onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
            placeholder="Sort order (0 = first)"
            className={inputClass}
          />
        </div>
        <div className="flex gap-2">
          <button type="submit" disabled={pending} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60">
            {pending ? "Saving..." : form.id ? "Save Changes" : "+ Add Fixed Item"}
          </button>
          {form.id && (
            <button type="button" onClick={() => { setForm(emptyForm); setError(null); setSuccess(false); }} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
              Cancel Edit
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
