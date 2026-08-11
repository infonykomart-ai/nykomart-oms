"use client";

import { useActionState } from "react";
import { addHoliday, type SimpleActionState } from "./actions";

const initialState: SimpleActionState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

export function HolidayForm({ companyId, companies }: { companyId: string; companies: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(addHoliday, initialState);

  return (
    <form action={formAction} className="space-y-2 border-t border-slate-100 pt-3">
      {state.error && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
      {state.success && <p className="rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">✓ Holiday added.</p>}
      <div className="grid grid-cols-2 gap-2">
        <input type="date" name="holiday_date" required className={inputClass} />
        <input type="text" name="name" required placeholder="Holiday name (e.g. Diwali)" className={inputClass} />
      </div>
      <select name="company_id" defaultValue={companyId} className={inputClass}>
        <option value="">All companies</option>
        {companies.map((c) => (
          <option key={c.id} value={c.id}>{c.name} only</option>
        ))}
      </select>
      <button type="submit" disabled={pending} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60">
        {pending ? "Adding..." : "+ Add Holiday"}
      </button>
    </form>
  );
}
