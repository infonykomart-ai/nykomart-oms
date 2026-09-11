"use client";

// 2026-09-11 (Payroll Phase 3) — admin panel to create/edit the per-company
// onboarding checklist TEMPLATE. Same inline create-or-edit pattern as
// leave/admin/leave-types-panel.tsx (Phase 2).
import { useActionState, useEffect, useState } from "react";
import { manageChecklistItem, type OnboardingActionState } from "./actions";

const initialState: OnboardingActionState = { error: null, success: false };
const inputClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

export type ChecklistItemRow = { id: string; title: string; sort_order: number; active: boolean };

export function ChecklistManager({ companyId, items }: { companyId: string; items: ChecklistItemRow[] }) {
  const [showAddNew, setShowAddNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-700">🗂️ Checklist Items</p>
        <button
          type="button"
          onClick={() => setShowAddNew((v) => !v)}
          className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
        >
          {showAddNew ? "Cancel" : "+ Add Item"}
        </button>
      </div>

      {showAddNew && (
        <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
          <ItemForm companyId={companyId} onSaved={() => setShowAddNew(false)} />
        </div>
      )}

      <ul className="space-y-2">
        {items.map((item) =>
          editingId === item.id ? (
            <li key={item.id} className="rounded-lg border border-slate-300 bg-slate-50 p-3">
              <ItemForm companyId={companyId} item={item} onSaved={() => setEditingId(null)} />
            </li>
          ) : (
            <li key={item.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 text-sm">
              <div>
                <span className="font-medium text-slate-800">{item.title}</span>
                {!item.active && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500">Inactive</span>}
              </div>
              <button type="button" onClick={() => setEditingId(item.id)} className="text-xs font-medium text-blue-600 hover:underline">
                Edit
              </button>
            </li>
          )
        )}
        {items.length === 0 && !showAddNew && (
          <li className="py-4 text-center text-xs text-slate-400">
            No checklist items yet for this company — add the steps every new hire should go through.
          </li>
        )}
      </ul>
    </div>
  );
}

function ItemForm({
  companyId,
  item,
  onSaved,
}: {
  companyId: string;
  item?: ChecklistItemRow;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(manageChecklistItem, initialState);

  useEffect(() => {
    if (state.success) onSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="company_id" value={companyId} />
      {item && <input type="hidden" name="id" value={item.id} />}
      {state.error && <p className="w-full rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
      {state.success && state.message && <p className="w-full rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">{state.message}</p>}
      <div className="min-w-[10rem] flex-1">
        <label className="mb-1 block text-xs text-slate-500">Title *</label>
        <input name="title" defaultValue={item?.title} required placeholder="e.g. ID proofs collected" className={`${inputClass} w-full`} />
      </div>
      <div>
        <label className="mb-1 block text-xs text-slate-500">Order</label>
        <input type="number" name="sort_order" defaultValue={item?.sort_order ?? 0} className={`${inputClass} w-16`} />
      </div>
      <label className="flex items-center gap-1.5 text-xs text-slate-600">
        <input type="checkbox" name="active" value="true" defaultChecked={item?.active ?? true} />
        Active
      </label>
      <input type="hidden" name="active" value="false" />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
