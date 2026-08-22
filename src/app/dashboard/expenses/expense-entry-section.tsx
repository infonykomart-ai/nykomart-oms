"use client";

import { useActionState, useState, useTransition } from "react";
import { saveExpenseAction, deleteExpenseAction, type ExpenseFormState } from "./actions";
import { EXPENSE_CATEGORIES } from "./categories";

const initialState: ExpenseFormState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

type Company = { id: string; name: string };
type RecentEntry = {
  id: string;
  companyName: string;
  date: string;
  category: string;
  amount: number;
  paymentMode: string | null;
  remark: string | null;
};

// Office/cash expense entry — company + date + category + amount, plus an
// optional payment mode / remark. No edit screen: a mistake is corrected
// by deleting the row and re-entering it, same as the pattern used
// elsewhere (e.g. Ad Spend's day re-entry, except expenses aren't a daily
// upsert key so this is delete + re-add rather than overwrite).
export function ExpenseEntrySection({
  companies,
  recentEntries,
}: {
  companies: Company[];
  recentEntries: RecentEntry[];
}) {
  const [state, formAction, pending] = useActionState(saveExpenseAction, initialState);
  const [formKey, setFormKey] = useState(0);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Log an Expense</h2>
        {state.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
        {state.success && <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">Saved.</p>}
        <form
          key={formKey}
          action={(fd) => {
            formAction(fd);
            setFormKey((k) => k + 1);
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass} htmlFor="ie_company">Company *</label>
              <select id="ie_company" name="company_id" required defaultValue="" className={inputClass}>
                <option value="" disabled>Select company</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="ie_date">Date *</label>
              <input
                id="ie_date"
                name="expense_date"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="ie_category">Category *</label>
              <select id="ie_category" name="category" required defaultValue="" className={inputClass}>
                <option value="" disabled>Select category</option>
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="ie_amount">Amount (INR) *</label>
              <input id="ie_amount" name="amount_inr" type="number" step="0.01" min="0.01" required className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="ie_mode">Payment Mode</label>
              <input id="ie_mode" name="payment_mode" type="text" placeholder="Cash / UPI / NEFT..." className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="ie_remark">Remark</label>
              <input id="ie_remark" name="remark" type="text" className={inputClass} />
            </div>
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {pending ? "Saving..." : "Save"}
          </button>
        </form>
      </div>

      <RecentEntries entries={recentEntries} />
    </div>
  );
}

function RecentEntries({ entries }: { entries: RecentEntry[] }) {
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  function handleDelete(id: string, label: string) {
    if (!window.confirm(`Delete the expense entry for ${label}?`)) return;
    setDeleteError((prev) => ({ ...prev, [id]: "" }));
    startTransition(async () => {
      const result = await deleteExpenseAction(id);
      if (result.error) setDeleteError((prev) => ({ ...prev, [id]: result.error! }));
      else setDeletedIds((prev) => new Set(prev).add(id));
    });
  }

  const visible = entries.filter((e) => !deletedIds.has(e.id));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent Entries</h2>
      <div className="max-h-[28rem] space-y-1.5 overflow-y-auto">
        {visible.map((e) => (
          <div key={e.id} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-slate-900">{e.category}</div>
                <div className="text-slate-400">{e.companyName} · {e.date}{e.paymentMode ? ` · ${e.paymentMode}` : ""}</div>
                {e.remark && <div className="mt-0.5 text-slate-500">{e.remark}</div>}
              </div>
              <div className="shrink-0 text-right font-semibold text-slate-800">₹{e.amount.toFixed(2)}</div>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
              <p className="text-red-600">{deleteError[e.id]}</p>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleDelete(e.id, `${e.category} · ${e.date}`)}
                className="shrink-0 rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
        {visible.length === 0 && <p className="text-xs text-slate-400">No entries yet.</p>}
      </div>
    </div>
  );
}
