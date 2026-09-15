"use client";

// 2026-09-15 — "kuch payment auto debit hote hai credit card se — erank,
// etsy bill, ebay & other": the Card Auto-Debits section on the Expenses
// page. Registry list (vendor / expected amount / card / day / status) +
// add form + "⚡ Log due now" which generates this month's
// internal_expenses rows in one click. Variable-amount vendors (Etsy bill
// varies with sales) log at ₹0 — edit the row in the Report tab.

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  saveRecurringDebit,
  deleteRecurringDebit,
  toggleRecurringDebitActive,
  logDueRecurringDebits,
  type RecurringDebitState,
  type LogDueResult,
} from "./recurring-actions";
import { EXPENSE_CATEGORIES } from "./categories";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-0.5 block text-[11px] text-slate-400";
const initialState: RecurringDebitState = { error: null, success: false };

function inr(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export type RecurringDebitRow = {
  id: string;
  company_id: string;
  company_name: string;
  vendor_name: string;
  category: string;
  amount: number | null;
  card_label: string | null;
  day_of_month: number;
  active: boolean;
  last_logged_month: string | null;
};

export function RecurringDebitsSection({
  registry,
  companies,
  currentMonth,
}: {
  registry: RecurringDebitRow[];
  companies: { id: string; name: string }[];
  currentMonth: string;
}) {
  const [state, action, pending] = useActionState(saveRecurringDebit, initialState);
  const [logResult, setLogResult] = useState<LogDueResult | null>(null);
  const [logging, startLogging] = useTransition();
  const [logCompanyId, setLogCompanyId] = useState(companies[0]?.id ?? "");
  const today = new Date();
  const todayDay = today.getDate();

  useEffect(() => {
    if (state.success) window.location.reload();
  }, [state.success]);

  async function remove(id: string) {
    if (!confirm("Delete this auto-debit from the registry? (Already-logged expenses stay.)")) return;
    const res = await deleteRecurringDebit(id);
    if (res?.error) alert(res.error);
    else window.location.reload();
  }

  async function toggle(id: string, active: boolean) {
    const res = await toggleRecurringDebitActive(id, active);
    if (res?.error) alert(res.error);
    else window.location.reload();
  }

  function logDue() {
    startLogging(async () => {
      const res = await logDueRecurringDebits(logCompanyId);
      setLogResult(res);
      if (res.logged && res.logged.length > 0) window.location.reload();
    });
  }

  const dueNow = (r: RecurringDebitRow) =>
    r.active && r.last_logged_month !== currentMonth && todayDay >= Math.min(r.day_of_month, new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate());

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-lg">🔁</span>
        <h2 className="text-sm font-bold text-slate-700">Card Auto-Debits (recurring)</h2>
        <span className="text-[11px] text-slate-400">eRank · Etsy bill · eBay &amp; other — credit card se har mahine automatic</span>
        <div className="ml-auto flex items-center gap-1.5">
          <select value={logCompanyId} onChange={(e) => setLogCompanyId(e.target.value)} className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs">
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={logDue}
            disabled={logging || registry.length === 0}
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
          >
            {logging ? "Logging…" : "⚡ Log due now"}
          </button>
        </div>
      </div>
      {logResult?.error && <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700">{logResult.error}</p>}
      {logResult?.logged && logResult.logged.length === 0 && (
        <p className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Kuch due nahi tha — sab already logged ya abhi date nahi aayi.</p>
      )}

      {/* Registry table */}
      {registry.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">
          Registry khali hai — neeche form se add karo (eRank $9.99, Etsy bill, eBay store…). Har mahine due date par
          &quot;⚡ Log due now&quot; ek click me sab expenses bana dega.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-400">
                <th className="px-2 py-1.5 font-medium">Vendor</th>
                <th className="px-2 py-1.5 font-medium">Company</th>
                <th className="px-2 py-1.5 font-medium">Category</th>
                <th className="px-2 py-1.5 font-medium">Expected</th>
                <th className="px-2 py-1.5 font-medium">Card</th>
                <th className="px-2 py-1.5 font-medium">Day</th>
                <th className="px-2 py-1.5 font-medium">Last logged</th>
                <th className="px-2 py-1.5 font-medium">Status</th>
                <th className="px-2 py-1.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {registry.map((r) => (
                <tr key={r.id} className={dueNow(r) ? "bg-violet-50/60" : undefined}>
                  <td className="px-2 py-1.5 font-medium text-slate-800">{r.vendor_name}</td>
                  <td className="px-2 py-1.5 text-slate-500">{r.company_name}</td>
                  <td className="px-2 py-1.5 text-slate-500">{r.category}</td>
                  <td className="px-2 py-1.5 text-slate-600">{r.amount === null ? "variable" : `₹${inr(r.amount)}`}</td>
                  <td className="px-2 py-1.5 text-slate-500">{r.card_label ?? "—"}</td>
                  <td className="px-2 py-1.5 text-slate-600">{r.day_of_month}</td>
                  <td className="px-2 py-1.5 text-slate-500">{r.last_logged_month ?? "never"}</td>
                  <td className="px-2 py-1.5">
                    {r.active ? (
                      dueNow(r) ? (
                        <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700">DUE — log karo</span>
                      ) : (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">active</span>
                      )
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">paused</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 text-right">
                    <button type="button" onClick={() => toggle(r.id, !r.active)} className="mr-2 text-[11px] font-medium text-slate-500 hover:underline">
                      {r.active ? "Pause" : "Resume"}
                    </button>
                    <button type="button" onClick={() => remove(r.id)} className="text-[11px] font-medium text-rose-600 hover:underline">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add form */}
      <form action={action} className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <div className="mb-2 text-xs font-bold text-slate-600">➕ Add / update auto-debit</div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <div>
            <label className={labelClass}>Company</label>
            <select name="company_id" className={inputClass} required>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Vendor (eRank / Etsy / eBay…)</label>
            <input name="vendor_name" className={inputClass} required placeholder="eRank" />
          </div>
          <div>
            <label className={labelClass}>Category</label>
            <select name="category" defaultValue="Bank/Card Charges" className={inputClass}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Expected ₹ (blank = variable)</label>
            <input name="amount" type="number" step="0.01" min="0" className={inputClass} placeholder="e.g. 899" />
          </div>
          <div>
            <label className={labelClass}>Card (label)</label>
            <input name="card_label" className={inputClass} placeholder="HDFC …4291" />
          </div>
          <div>
            <label className={labelClass}>Debit day (1–31)</label>
            <input name="day_of_month" type="number" min="1" max="31" className={inputClass} required placeholder="5" />
          </div>
          <div>
            <label className={labelClass}>Remark</label>
            <input name="remark" className={inputClass} />
          </div>
        </div>
        {state.error && <p className="mt-1.5 text-xs font-medium text-rose-600">{state.error}</p>}
        <button
          type="submit"
          disabled={pending}
          className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save to registry"}
        </button>
      </form>
    </div>
  );
}
