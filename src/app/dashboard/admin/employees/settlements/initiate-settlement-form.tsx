"use client";

// 2026-09-11 (Payroll Phase 4) — opens a new Draft settlement, then jumps
// straight to its detail page (initiateSettlement returns the new
// settlement's id in state.message on success — a small reuse of the
// existing SettlementActionState shape rather than inventing a second
// return type just for this one redirect).
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { initiateSettlement, type SettlementActionState } from "./actions";

const initialState: SettlementActionState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export function InitiateSettlementForm({ employees }: { employees: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(initiateSettlement, initialState);
  const router = useRouter();

  useEffect(() => {
    if (state.success && state.message) {
      router.push(`/dashboard/admin/employees/settlements/${state.message}`);
    }
  }, [state.success, state.message, router]);

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm font-semibold text-slate-700">🧾 Start a Full &amp; Final Settlement</p>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}

      <div>
        <label className={labelClass}>Employee *</label>
        <select name="employee_id" required className={inputClass}>
          <option value="">—</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
        {employees.length === 0 && <p className="mt-1 text-xs text-slate-400">No employees available — everyone active already has an in-progress settlement.</p>}
      </div>

      <div>
        <label className={labelClass}>Separation Type *</label>
        <select name="separation_type" required defaultValue="Resignation" className={inputClass}>
          <option value="Resignation">Resignation</option>
          <option value="Termination">Termination</option>
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Resignation / Decision Date *</label>
          <input type="date" name="resignation_date" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Last Working Day *</label>
          <input type="date" name="last_working_day" required className={inputClass} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass}>Notice Required (days)</label>
          <input type="number" min={0} name="notice_period_required_days" defaultValue={0} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Notice Served (days)</label>
          <input type="number" min={0} name="notice_period_served_days" defaultValue={0} className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass}>Reason (optional)</label>
        <textarea name="reason" rows={2} className={inputClass} />
      </div>

      <button
        type="submit"
        disabled={pending || employees.length === 0}
        className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Starting..." : "Start Settlement"}
      </button>
    </form>
  );
}
