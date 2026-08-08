"use client";

import { useActionState, useState, useTransition } from "react";
import { saveAdSpendAction, deleteAdSpendAction, type AdSpendFormState } from "./actions";

const initialState: AdSpendFormState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

type Company = { id: string; name: string };
type Store = { id: string; name: string; company_id: string };
type RecentEntry = { id: string; storeName: string; companyName: string; date: string; budget: number; spend: number };

// Daily entry — just Budget (USD) + Spend (USD) per store per day.
// Re-submitting the same store+date overwrites that day's numbers (see
// saveAdSpendAction's upsert), so this doubles as the "edit" screen: pick
// the same store/date again, type the corrected numbers, save. The list on
// the right (last 30 entries across all stores) is there so a mistake is
// visible without having to remember which store/date it was on, and can
// be cleared outright via Delete.
export function AdSpendEntrySection({
  companies,
  stores,
  recentEntries,
}: {
  companies: Company[];
  stores: Store[];
  recentEntries: RecentEntry[];
}) {
  const [state, formAction, pending] = useActionState(saveAdSpendAction, initialState);
  // 2026-08-08: default to a company that actually has a store this
  // employee can enter for (relevant once ad-spend is scoped to a store-
  // restricted login — see page.tsx's canSeeAllStores) rather than always
  // picking companies[0], which could have zero stores in `stores` for a
  // scoped user and leave the Store dropdown looking empty on first load.
  const [companyId, setCompanyId] = useState(stores[0]?.company_id ?? companies[0]?.id ?? "");
  const [formKey, setFormKey] = useState(0); // bump to reset the form after a successful save

  const companyStores = stores.filter((s) => s.company_id === companyId);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Enter Budget / Spend</h2>
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
              <label className={labelClass} htmlFor="as_company">Company *</label>
              <select id="as_company" value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={inputClass}>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="as_store">Store *</label>
              <select id="as_store" name="store_id" required defaultValue="" className={inputClass}>
                <option value="" disabled>Select store</option>
                {companyStores.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="as_date">Date *</label>
              <input
                id="as_date"
                name="spend_date"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                className={inputClass}
              />
            </div>
            <div />
            <div>
              <label className={labelClass} htmlFor="as_budget">Budget (USD)</label>
              <input id="as_budget" name="budget_usd" type="number" step="0.01" min="0" defaultValue="0" className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="as_spend">Spend (USD)</label>
              <input id="as_spend" name="spend_usd" type="number" step="0.01" min="0" defaultValue="0" className={inputClass} />
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
        <p className="mt-3 text-xs text-slate-400">
          QTY ORD / USD are not entered here — see the <strong>Report</strong> tab for the combined view against live
          Order Entry data.
        </p>
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
    if (!window.confirm(`Delete the entry for ${label}?`)) return;
    setDeleteError((prev) => ({ ...prev, [id]: "" }));
    startTransition(async () => {
      const result = await deleteAdSpendAction(id);
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
                <div className="font-medium text-slate-900">{e.storeName}</div>
                <div className="text-slate-400">{e.companyName} · {e.date}</div>
              </div>
              <div className="text-right">
                <div className="text-slate-700">Budget ${e.budget.toFixed(2)}</div>
                <div className="text-slate-700">Spend ${e.spend.toFixed(2)}</div>
              </div>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
              <p className="text-red-600">{deleteError[e.id]}</p>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleDelete(e.id, `${e.storeName} · ${e.date}`)}
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
