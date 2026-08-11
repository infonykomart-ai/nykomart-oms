"use client";

import { useActionState } from "react";
import { setManualAttendance, type SimpleActionState } from "./actions";

const initialState: SimpleActionState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const STATUSES = ["Present", "Absent", "Half Day", "Leave", "Holiday", "Week Off", "Late"];

export function ManualAttendanceForm({
  companyId,
  employees,
  today,
}: {
  companyId: string;
  employees: { id: string; name: string }[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(setManualAttendance, initialState);

  return (
    <form action={formAction} className="grid grid-cols-1 gap-2 md:grid-cols-5">
      <input type="hidden" name="company_id" value={companyId} />
      {state.error && <p className="col-span-full rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
      {state.success && <p className="col-span-full rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">✓ Saved.</p>}
      <select name="employee_id" required defaultValue="" className={inputClass}>
        <option value="" disabled>Employee</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>
      <input type="date" name="attendance_date" required defaultValue={today} className={inputClass} />
      <select name="status" required defaultValue="" className={inputClass}>
        <option value="" disabled>Status</option>
        {STATUSES.map((s) => (
          <option key={s} value={s}>{s}</option>
        ))}
      </select>
      <input type="text" name="remark" placeholder="Remark (optional)" className={inputClass} />
      <button type="submit" disabled={pending} className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60">
        {pending ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
