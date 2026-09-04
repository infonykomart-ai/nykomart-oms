"use client";

// 2026-09-04 — Daily Work Planner: an employee's OWN personal recurring
// items, on top of whatever fixed per-ROLE template Admin/HR has set up
// (that side is Admin-managed, see admin/work-plan-templates-panel.tsx —
// not editable from here). Both layers get materialized into today's
// Daily Work Report automatically each day (see src/lib/attendance/
// work-plan-templates.ts) — badged "🗂️ Template" there, same as any
// role-template row.
import { useState, useTransition } from "react";
import { saveMyRecurringItem, setMyRecurringItemActive } from "./actions";

export type MyRecurringItemRow = {
  id: string;
  category: string | null;
  description: string;
  targetQty: string | null;
  sortOrder: number;
  active: boolean;
};

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

const emptyForm = { id: "", category: "", description: "", targetQty: "", sortOrder: "" };

export function MyRecurringWorkForm({ items }: { items: MyRecurringItemRow[] }) {
  const [form, setForm] = useState(emptyForm);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function startEdit(t: MyRecurringItemRow) {
    setForm({ id: t.id, category: t.category ?? "", description: t.description, targetQty: t.targetQty ?? "", sortOrder: String(t.sortOrder) });
    setSuccess(false);
    setError(null);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSuccess(false);
    setError(null);
    startTransition(async () => {
      const result = await saveMyRecurringItem({
        id: form.id || undefined,
        category: form.category,
        description: form.description,
        targetQty: form.targetQty,
        sortOrder: form.sortOrder,
      });
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
      await setMyRecurringItemActive(id, active);
    });
  }

  return (
    <div>
      {items.length === 0 ? (
        <p className="mb-3 text-xs text-slate-400">You haven&apos;t added any personal recurring items yet — anything you add here shows up in Today&apos;s Work automatically, every day, without re-typing it.</p>
      ) : (
        <div className="mb-3 space-y-1">
          {[...items]
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
      )}

      <form onSubmit={handleSubmit} className="space-y-2 border-t border-slate-100 pt-3">
        {error && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{error}</p>}
        {success && <p className="rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">✓ Saved.</p>}
        <div className="grid grid-cols-2 gap-2">
          <input
            value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            placeholder="Work Type (optional)"
            className={inputClass}
          />
          <input
            value={form.targetQty}
            onChange={(e) => setForm((f) => ({ ...f, targetQty: e.target.value }))}
            placeholder="Target Qty (optional)"
            className={inputClass}
          />
        </div>
        <input
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          required
          placeholder="Description — kaam jo roz karna hai (e.g. Check yesterday's tracking updates)"
          className={inputClass}
        />
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="number"
            min={0}
            value={form.sortOrder}
            onChange={(e) => setForm((f) => ({ ...f, sortOrder: e.target.value }))}
            placeholder="Sort order (0 = first)"
            className={`${inputClass} max-w-[10rem]`}
          />
          <button type="submit" disabled={pending} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60">
            {pending ? "Saving..." : form.id ? "Save Changes" : "+ Add Recurring Item"}
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
