"use client";

import { useActionState, useEffect, useState } from "react";
import { updateEmployeeDetails, type EmployeeDetailsFormState } from "./actions";
import { ProfileFields, type ProfileFieldDefaults } from "./profile-fields";

const initialState: EmployeeDetailsFormState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export type EmployeeDetails = ProfileFieldDefaults & {
  id: string;
  // 2026-10-13 — "puri trah se edit": the IDENTITY block rides this same
  // form now (see updateEmployeeDetails), so name / login email / home
  // company are editable right here instead of Supabase.
  name: string;
  email: string | null;
  company_id: string;
  designation: string | null;
  // 2026-10-02b — structured department entity (departments table).
  department_id: string | null;
  employee_code: string | null;
  date_of_joining: string | null;
  // 2026-09-11 (Payroll Phase 3) — org chart.
  reports_to_employee_id: string | null;
};

// "Edit Details" panel — backfills the 2026-08-07 Employee Master fields
// (WhatsApp, gender, marital status, DOB/anniversary, photo, 2 family
// contacts) for an employee created before those columns existed, or edits
// them later. 2026-10-13: also the identity block (name, login email,
// home company, company access). Toggled open from EmployeeRowActions,
// same inline pattern as the existing password-reset panel.
export function EmployeeDetailsForm({
  employee,
  companies,
  companyAccess,
  reportsToOptions,
  departments,
  onDone,
}: {
  employee: EmployeeDetails;
  // ALL companies — including an inactive one this employee already sits
  // in. The home-company select MUST be able to render the current value;
  // an active-only list would silently swap them to the first option on
  // the next save.
  companies: { id: string; name: string; active: boolean }[];
  // Current employee_company_access rows (the home company is always
  // re-submitted server-side even if its tick is cleared).
  companyAccess: string[];
  // ALL other employees, company_id included — filtered by the selected
  // home company below, so changing that company refreshes the options.
  reportsToOptions: { id: string; name: string; company_id: string }[];
  // ALL departments, company_id included (inactive ones too, so a
  // previously assigned department still renders) — same live re-filter.
  departments: { id: string; name: string; company_id: string }[];
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState(updateEmployeeDetails, initialState);

  // Controlled because both depend on the home company the admin may
  // change mid-form: a department/manager from the OLD company must not
  // survive a company switch (the server rejects such values anyway —
  // this just makes the form tell the truth immediately).
  const [companyId, setCompanyId] = useState(employee.company_id);
  const [departmentId, setDepartmentId] = useState(employee.department_id ?? "");
  const [reportsToId, setReportsToId] = useState(employee.reports_to_employee_id ?? "");

  const companyDepartments = departments.filter((d) => d.company_id === companyId);
  const companyManagers = reportsToOptions.filter((o) => o.company_id === companyId);

  function onCompanyChange(next: string) {
    setCompanyId(next);
    if (departmentId && !departments.some((d) => d.id === departmentId && d.company_id === next)) setDepartmentId("");
    if (reportsToId && !reportsToOptions.some((o) => o.id === reportsToId && o.company_id === next)) setReportsToId("");
  }

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
      {state.success && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Saved successfully.</p>}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* ── Identity (2026-10-13) ─────────────────────────────── */}
        <div>
          <label className={labelClass} htmlFor="name">Name</label>
          <input id="name" name="name" required defaultValue={employee.name} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="email">Login email</label>
          <input
            id="email"
            name="email"
            type="email"
            defaultValue={employee.email ?? ""}
            placeholder="employee@company.com"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="home_company_id">Home company</label>
          <select id="home_company_id" name="home_company_id" value={companyId} onChange={(e) => onCompanyChange(e.target.value)} className={inputClass}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-3">
          <span className={labelClass}>Company access</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {companies.map((c) => (
              <label key={c.id} className="flex items-center gap-1.5 text-sm text-slate-700">
                <input
                  type="checkbox"
                  name="company_access"
                  value={c.id}
                  defaultChecked={c.id === employee.company_id || companyAccess.includes(c.id)}
                  className="rounded border-slate-300"
                />
                {c.name}
                {c.active ? "" : " (inactive)"}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Home company stays included even if unticked — tick any OTHER company this person also works for.
          </p>
        </div>

        <div>
          <label className={labelClass} htmlFor="designation">Designation</label>
          <input id="designation" name="designation" defaultValue={employee.designation ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="department_id">Department</label>
          <select id="department_id" name="department_id" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={inputClass}>
            <option value="">— None —</option>
            {companyDepartments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="employee_code">Employee Code</label>
          <input id="employee_code" name="employee_code" defaultValue={employee.employee_code ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="date_of_joining">Date of Joining</label>
          <input id="date_of_joining" name="date_of_joining" type="date" defaultValue={employee.date_of_joining ?? ""} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="reports_to_employee_id">Reports To</label>
          <select id="reports_to_employee_id" name="reports_to_employee_id" value={reportsToId} onChange={(e) => setReportsToId(e.target.value)} className={inputClass}>
            <option value="">— None (top-level) —</option>
            {companyManagers.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
      </div>

      <ProfileFields defaults={employee} />

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={onDone} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
          Cancel
        </button>
      </div>
    </form>
  );
}
