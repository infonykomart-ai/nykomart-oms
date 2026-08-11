"use client";

import { useActionState } from "react";
import { setEmployeeSalary, type SimpleActionState } from "./actions";

const initialState: SimpleActionState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

export function SalaryForm({ employees, today }: { employees: { id: string; name: string }[]; today: string }) {
  const [state, formAction, pending] = useActionState(setEmployeeSalary, initialState);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-2 md:grid-cols-5">
      {state.error && <p className="col-span-full rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
      {state.success && <p className="col-span-full rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">✓ Saved — applies from the Effective From date onward.</p>}
      <select name="employee_id" required defaultValue="" className={inputClass}>
        <option value="" disabled>Employee</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
      <input type="number" name="monthly_salary" step="0.01" min="0" required placeholder="Monthly Salary" className={inputClass} />
      <input type="number" name="allowed_leaves_per_month" step="0.5" min="0" defaultValue={1} placeholder="Allowed Leave/mo" className={inputClass} />
      <input type="date" name="effective_from" required defaultValue={today} className={inputClass} />
      <button type="submit" disabled={pending} className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60">
        {pending ? "Saving..." : "Save Salary"}
      </button>
    </form>
  );
}
