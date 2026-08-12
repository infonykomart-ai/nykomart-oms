"use client";

// 2026-08-12 (round 7): "sellery advance vala bhi sahi se kaam nahi kar
// raha ... agar kisi ne advance liya hai to HR section se connect hokar
// yaha reflact hona chahiye" — real advance/loan tracking. Giving an
// advance here (giveAdvance) immediately: (1) creates a durable
// employee_advances row with a running outstanding balance, (2)
// auto-mirrors into bill_pass_register so Finance sees the debit right
// away, and (3) is what the Employees (HR) admin screen reads to show
// "Advance Due: ₹X" per person — same underlying row, no separate entry.
import { useActionState } from "react";
import { giveAdvance, type FinanceActionState } from "./actions";

const initialState: FinanceActionState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type AdvanceRow = {
  id: string;
  employee_name: string;
  amount: number;
  date_given: string;
  reason: string | null;
  recovered_amount: number;
  outstanding_amount: number;
  recovery_months: number | null;
  monthly_installment: number | null;
};

export function AdvanceSection({
  employees,
  today,
  advances,
}: {
  employees: { id: string; name: string }[];
  today: string;
  advances: AdvanceRow[];
}) {
  const [state, formAction, pending] = useActionState(giveAdvance, initialState);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Give Advance</h3>
        <form action={formAction} className="space-y-3">
          {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
          {state.success && state.message && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">{state.message}</p>}
          <div>
            <label className={labelClass}>Employee</label>
            <select name="employee_id" required defaultValue="" className={inputClass}>
              <option value="" disabled>— Select —</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>{e.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Amount</label>
              <input name="amount" type="number" step="0.01" min="0.01" required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Date Given</label>
              <input name="date_given" type="date" defaultValue={today} max={today} required className={inputClass} />
            </div>
          </div>
          <div>
            <label className={labelClass}>Recover Over (months)</label>
            <input
              name="recovery_months"
              type="number"
              step="1"
              min="1"
              placeholder="optional — e.g. 10 for ₹1000/month on a ₹10,000 advance"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Reason</label>
            <input name="reason" placeholder="optional" className={inputClass} />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {pending ? "Saving..." : "Give Advance"}
          </button>
        </form>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Advances — this company</h3>
        <div className="max-h-80 space-y-1.5 overflow-y-auto">
          {advances.length === 0 && <p className="text-xs text-slate-400">No advances given yet.</p>}
          {advances.map((a) => (
            <div key={a.id} className="rounded border border-slate-100 px-2.5 py-1.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-medium text-slate-800">{a.employee_name}</span>
                <span className="text-slate-400">{a.date_given}</span>
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-2">
                <span className="text-slate-600">₹{a.amount} given</span>
                <span className="text-green-700">₹{a.recovered_amount} recovered</span>
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${
                    a.outstanding_amount > 0 ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700"
                  }`}
                >
                  {a.outstanding_amount > 0 ? `₹${a.outstanding_amount} outstanding` : "Cleared"}
                </span>
              </div>
              {a.recovery_months != null && a.monthly_installment != null && (
                <p className="mt-0.5 text-purple-600">
                  ₹{a.monthly_installment}/month over {a.recovery_months} months
                  {a.outstanding_amount > 0 && ` — ~${Math.ceil(a.outstanding_amount / a.monthly_installment)} left`}
                </p>
              )}
              {a.reason && <p className="mt-0.5 text-slate-500">{a.reason}</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
