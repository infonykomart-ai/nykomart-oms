"use client";

import { useActionState, useMemo, useState } from "react";
import { setManualAttendance, type SimpleActionState } from "./actions";
// Pure IST/date helpers only — safe in a client component (ist-date.ts has no
// server-only imports); LATE_CUTOFF_HHMM is shared with the punch flow so the
// suggested status can never drift from what an automatic punch would record.
import { LATE_CUTOFF_HHMM } from "@/lib/attendance/ist-date";

const initialState: SimpleActionState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-400";
const STATUSES = ["Present", "Absent", "Half Day", "Leave", "Holiday", "Week Off", "Late"];

/**
 * One selectable employee. `companyId` is the employee's OWN home company —
 * the form submits that (not the page's currently-filtered company) so a
 * cross-company staff member granted employee_company_access is still
 * written to the right company; setManualAttendance re-checks access.
 */
export type CorrectionEmployee = {
  id: string;
  name: string;
  /** The company the attendance row would be WRITTEN to — an employee's own
   *  home company, or the company that granted them employee_company_access
   *  (see admin/page.tsx). setManualAttendance validates the write on exactly
   *  this basis, so the form must submit THIS id, never the page's filter. */
  companyId: string;
  companyName: string;
  active: boolean;
  /** True for staff homed in another company who have been granted access to
   *  one of this admin's companies — labelled so the list stays readable. */
  crossCompany?: boolean;
};

// 2026-10-16 — "admin attendance page par manual correction me employee
// select nahi ho rahe to kese manual punch karu". Two fixes here:
//
// 1. The employee dropdown is now fed by a service-role read on the page
//    (see admin/page.tsx) covering EVERY company this admin can act for —
//    not just the company currently filtered at the top — and a failed read
//    is SHOWN (readError banner) instead of silently rendering an empty
//    select, which is exactly how this looked like "employees can't be
//    selected". Employees of another company are grouped under their company
//    name, and inactive ones are labelled, so a historical correction for a
//    former staffer is still possible.
// 2. Punch In / Punch Out are now real inputs (optional). A missed punch can
//    be recorded WITH its times instead of only flipping a status, which is
//    what "manual punch" actually means — work_hours is a generated column
//    off those two values, so the day's hours come out right automatically.
export function ManualAttendanceForm({
  companyId,
  employees,
  today,
  readError,
}: {
  companyId: string;
  employees: CorrectionEmployee[];
  today: string;
  readError?: string | null;
}) {
  const [state, formAction, pending] = useActionState(setManualAttendance, initialState);
  // Controlled so the hidden company_id can follow the PICKED employee.
  const [employeeId, setEmployeeId] = useState("");
  const [punchIn, setPunchIn] = useState("");
  const [punchOut, setPunchOut] = useState("");
  const [status, setStatus] = useState("");

  const selected = employees.find((e) => e.id === employeeId) ?? null;
  const targetCompanyId = selected?.companyId ?? companyId;

  // Group by company name (only rendered as <optgroup> when the admin can
  // act for more than one company — a single-company login sees a flat list).
  const groups = useMemo(() => {
    const byCompany = new Map<string, CorrectionEmployee[]>();
    for (const e of employees) {
      const list = byCompany.get(e.companyName);
      if (list) list.push(e);
      else byCompany.set(e.companyName, [e]);
    }
    return Array.from(byCompany.entries());
  }, [employees]);

  function employeeLabel(e: CorrectionEmployee): string {
    const parts = [e.name];
    if (!e.active) parts.push("inactive");
    if (e.crossCompany) parts.push("cross-company");
    return parts.length > 1 ? `${parts[0]} (${parts.slice(1).join(", ")})` : parts[0];
  }

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="company_id" value={targetCompanyId} />

      {readError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          Couldn&apos;t load the employee list: {readError}
        </p>
      )}
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {state.success && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
          ✓ Saved. The employee&apos;s Attendance page already shows this day updated.
        </p>
      )}

      {employees.length === 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          No selectable employees were found. Add the person under Admin → Employees (an <strong>inactive</strong> employee
          still lists here, so a left staffer&apos;s history can be corrected), and check that your login has access to
          their company.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <div className="md:col-span-2">
              <label className={labelClass} htmlFor="manual-employee">
                Employee *
              </label>
              <select
                id="manual-employee"
                name="employee_id"
                required
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className={inputClass}
              >
                <option value="" disabled>
                  Select employee
                </option>
                {groups.length > 1
                  ? groups.map(([company, list]) => (
                      <optgroup key={company} label={company}>
                        {list.map((e) => (
                          <option key={e.id} value={e.id}>
                            {employeeLabel(e)}
                          </option>
                        ))}
                      </optgroup>
                    ))
                  : employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {employeeLabel(e)}
                      </option>
                    ))}
              </select>
            </div>

            <div>
              <label className={labelClass} htmlFor="manual-date">
                Date *
              </label>
              <input id="manual-date" type="date" name="attendance_date" required defaultValue={today} className={inputClass} />
            </div>

            <div>
              <label className={labelClass} htmlFor="manual-in">
                Punch In (optional)
              </label>
              <input
                id="manual-in"
                type="time"
                name="punch_in_time"
                value={punchIn}
                onChange={(e) => {
                  const v = e.target.value;
                  setPunchIn(v);
                  // Only ever PROPOSE a status for a field the admin hasn't
                  // chosen yet — an explicit pick is never overridden.
                  if (v && !status) setStatus(v > LATE_CUTOFF_HHMM ? "Late" : "Present");
                }}
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="manual-out">
                Punch Out (optional)
              </label>
              <input
                id="manual-out"
                type="time"
                name="punch_out_time"
                value={punchOut}
                onChange={(e) => setPunchOut(e.target.value)}
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="manual-status">
                Status *
              </label>
              <select
                id="manual-status"
                name="status"
                required
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className={inputClass}
              >
                <option value="" disabled>
                  Status
                </option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2 xl:col-span-4">
              <label className={labelClass} htmlFor="manual-remark">
                Remark (optional)
              </label>
              <input
                id="manual-remark"
                type="text"
                name="remark"
                placeholder="e.g. biometric missed, approved by MD"
                className={inputClass}
              />
            </div>

            <div className="md:col-span-1 xl:col-span-2 xl:self-end">
              <button
                type="submit"
                disabled={pending || !employeeId}
                className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
              >
                {pending ? "Saving..." : "Save correction"}
              </button>
            </div>
          </div>

          <p className="text-[11px] leading-relaxed text-slate-500">
            Status alone corrects the day (Leave / Holiday / Half Day), and Punch In + Punch Out record a{" "}
            <strong>real manual punch</strong> with hours — leave both blank to only set the status. Times are IST; a Punch
            In after {LATE_CUTOFF_HHMM} is normally <strong>Late</strong>
            {selected && (
              <>
                {" "}
                · Writing to <strong>{selected.companyName}</strong>
              </>
            )}
            .
          </p>
        </>
      )}
    </form>
  );
}
