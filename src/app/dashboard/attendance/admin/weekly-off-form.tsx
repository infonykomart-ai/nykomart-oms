"use client";

import { useActionState } from "react";
import { setWeeklyOffDays, type SimpleActionState } from "./actions";

const initialState: SimpleActionState = { error: null, success: false };
const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function WeeklyOffForm({ companyId, currentDays }: { companyId: string; currentDays: number[] }) {
  const [state, formAction, pending] = useActionState(setWeeklyOffDays, initialState);

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="company_id" value={companyId} />
      {state.error && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
      {state.success && <p className="rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">✓ Saved.</p>}
      <div className="flex flex-wrap gap-2">
        {DAY_LABELS.map((label, i) => (
          <label key={i} className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700">
            <input type="checkbox" name="weekly_off_days" value={i} defaultChecked={currentDays.includes(i)} className="rounded border-slate-300" />
            {label}
          </label>
        ))}
      </div>
      <button type="submit" disabled={pending} className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60">
        {pending ? "Saving..." : "Save Weekly Off"}
      </button>
    </form>
  );
}
