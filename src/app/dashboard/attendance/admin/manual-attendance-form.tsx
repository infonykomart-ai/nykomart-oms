"use client";

import { useActionState, useMemo, useState } from "react";
import { setManualAttendance, type SimpleActionState } from "./actions";
// Pure IST/date helpers only — safe in a client component (ist-date.ts has no
// server-only imports); the cutoff and the Present/Late verdict are shared
// with the punch flow so a suggested status can never drift from what an
// automatic punch would record.
import { LATE_CUTOFF_HHMM, attendanceStatusForPunchIn } from "@/lib/attendance/ist-date";

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

/**
 * Manual attendance correction for one employee + date, upserted by
 * (employee_id, attendance_date) — the same unique key the automatic punch
 * path uses.
 *
 * Two problems are fixed here (2026-10-15/16):
 *
 * 1. "admin attendance page par manual correction me employee select nahi ho
 *    rahe to kese manual punch karu": the employee dropdown was fed only by
 *    the page's current company filter and a FAILED read silently rendered an
 *    empty select — which is exactly what "employees can't be selected" looks
 *    like. It is now fed by a service-role read covering every company this
 *    admin can act for, grouped under company names, with inactive and
 *    cross-company staff labelled and the read error SHOWN.
 * 2. "manual punching kaam nahi kar raha ... usme ye bhi hona chahiye ki
 *    kitne baje ka punch dalna hai": the form took only a status + remark, so
 *    a manual entry could never record a PUNCH — the row came out with no
 *    punch_in/punch_out and therefore no work hours. It now takes the actual
 *    Punch In / Punch Out times (IST, 24h), stored by the server as real
 *    timestamptz values:
 *      • both times   → a complete manual punch; work hours compute themselves
 *      • only Punch In → status is derived from the same 09:45 IST late cutoff
 *        the live punch uses, unless a Status is picked explicitly
 *      • a blank time  → only the status is corrected; an already-recorded
 *        punch is left untouched (correcting a day must never wipe a punch)
 */
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
  // Status starts on "Auto" — the server derives Present/Late from the Punch
  // In time — and only sticks once the admin picks one deliberately, so
  // editing the time afterwards never leaves a stale suggested status behind.
  const [status, setStatus] = useState("");
  const [statusTouched, setStatusTouched] = useState(false);

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
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          ✓ {state.message ?? "Saved."}
          <span className="mt-0.5 block text-emerald-700">
            The employee&apos;s Attendance page already shows this day updated.
          </span>
        </p>
      )}

      {employees.length === 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          No selectable employees were found. Add the person under Admin → Employees (an <strong>inactive</strong>{" "}
          employee still lists here, so a left staffer&apos;s history can be corrected), and check that your login has
          access to their company.
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
              <input
                id="manual-date"
                type="date"
                name="attendance_date"
                required
                defaultValue={today}
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="manual-in">
                Punch In (IST)
              </label>
              <input
                id="manual-in"
                type="time"
                name="punch_in_time"
                value={punchIn}
                onChange={(e) => {
                  const v = e.target.value;
                  setPunchIn(v);
                  // While the admin hasn&apos;t chosen a status themselves, mirror
                  // exactly what the server will derive from this time — same
                  // 09:45 cutoff, same verdict, so the field shows the truth.
                  if (!statusTouched) setStatus(attendanceStatusForPunchIn(v) ?? "");
                }}
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="manual-out">
                Punch Out (IST)
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
                Status (auto from Punch In)
              </label>
              <select
                id="manual-status"
                name="status"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setStatusTouched(e.target.value !== "");
                }}
                className={inputClass}
              >
                <option value="">Auto (from Punch In time)</option>
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
            Status alone corrects the day (Leave / Holiday / Half Day); Punch In + Punch Out record a{" "}
            <strong>real manual punch</strong> whose hours drive Work Hours just like a live punch. Times are IST and a
            Punch In after {LATE_CUTOFF_HHMM} is <strong>Late</strong> unless you pick a status yourself. Leave a time
            blank to keep an already-recorded punch — Punch Out on its own needs an existing Punch In.
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
