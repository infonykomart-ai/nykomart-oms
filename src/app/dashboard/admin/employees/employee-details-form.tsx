"use client";

import { useActionState, useEffect } from "react";
import { updateEmployeeDetails, type EmployeeDetailsFormState } from "./actions";
import { ProfileFields, type ProfileFieldDefaults } from "./profile-fields";

const initialState: EmployeeDetailsFormState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export type EmployeeDetails = ProfileFieldDefaults & {
  id: string;
  designation: string | null;
  employee_code: string | null;
  date_of_joining: string | null;
};

// "Edit Details" panel — backfills the 2026-08-07 Employee Master fields
// (WhatsApp, gender, marital status, DOB/anniversary, photo, 2 family
// contacts) for an employee created before those columns existed, or edits
// them later. Toggled open from EmployeeRowActions, same inline pattern as
// the existing password-reset panel.
export function EmployeeDetailsForm({ employee, onDone }: { employee: EmployeeDetails; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(updateEmployeeDetails, initialState);

  useEffect(() => {
    if (state.success) {
      const t = setTimeout(onDone, 1200);
      return () => clearTimeout(t);
    }
  }, [state.success, onDone]);

  return (
    <form action={formAction} className="mt-3 space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <input type="hidden" name="employee_id" value={employee.id} />
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {state.success && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Save ho gaya.</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={labelClass} htmlFor="designation">Designation</label>
          <input id="designation" name="designation" defaultValue={employee.designation ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="employee_code">Employee Code</label>
          <input id="employee_code" name="employee_code" defaultValue={employee.employee_code ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="date_of_joining">Date of Joining</label>
          <input id="date_of_joining" name="date_of_joining" type="date" defaultValue={employee.date_of_joining ?? ""} className={inputClass} />
        </div>
      </div>

      <ProfileFields defaults={employee} />

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
        >
          {pending ? "Save ho raha hai..." : "Save Karo"}
        </button>
        <button type="button" onClick={onDone} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
          Cancel
        </button>
      </div>
    </form>
  );
}
