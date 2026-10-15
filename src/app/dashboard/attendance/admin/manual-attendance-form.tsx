"use client";

import { useActionState, useState } from "react";
import { setManualAttendance, type SimpleActionState } from "./actions";

const initialState: SimpleActionState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-[11px] font-medium text-slate-500";
const STATUSES = ["Present", "Absent", "Half Day", "Leave", "Holiday", "Week Off", "Late"];

/**
 * Manual attendance correction — mark Present/Absent/Half Day/Leave/Holiday
 * for a specific employee+date. Upserts by (employee_id, attendance_date),
 * same unique key the automatic punch-in path uses.
 *
 * 2026-10-15 — "manual punching kaam nahi kar raha ... usme ye bhi hona
 * chahiye ki kitne baje ka punch dalna hai": the form used to take only a
 * status + remark, so a manual entry could never record a PUNCH — the row
 * came out with no punch_in/punch_out and therefore no work hours, which is
 * why it looked like manual punching simply did not work. It now takes the
 * actual Punch In / Punch Out times (IST, 24h) and the server stores them as
 * real timestamptz values:
 *   • both times  → a complete manual punch; work hours compute themselves
 *   • only Punch In → status is derived from the same 09:45 IST late cutoff
 *     the live punch uses, unless a Status is picked explicitly
 *   • a blank time leaves the existing stored punch untouched (correcting the
 *     status must never wipe a real punch)
 */
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
  // Mirrored so the Punch Out field can be disabled until a Punch In time is
  // actually there (the server enforces the same rule, this is just courtesy).
  const [punchIn, setPunchIn] = useState("");
  const [status, setStatus] = useState("");

  return (
    <form action={formAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <input type="hidden" name="company_id" value={companyId} />
      {state.error && <p className="col-span-full rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
      {state.success && (
        <p className="col-span-full rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">
          ✓ {state.message ?? "Saved."}
        </p>
      )}
      <div>
        <label className={labelClass} htmlFor="ma_employee">Employee *</label>
        <select id="ma_employee" name="employee_id" required defaultValue="" className={inputClass}>
          <option value="" disabled>Select employee</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass} htmlFor="ma_date">Date *</label>
        <input id="ma_date" type="date" name="attendance_date" required defaultValue={today} className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor="ma_status">Status (optional when a punch time is entered)</label>
        <select
          id="ma_status"
          name="status"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className={inputClass}
        >
          <option value="">Auto (from Punch In time)</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass} htmlFor="ma_in">Punch In time (IST)</label>
        <input
          id="ma_in"
          type="time"
          name="punch_in_time"
          value={punchIn}
          onChange={(e) => setPunchIn(e.target.value)}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="ma_out">Punch Out time (IST)</label>
        <input
          id="ma_out"
          type="time"
          name="punch_out_time"
          disabled={!punchIn}
          className={`${inputClass} disabled:bg-slate-100 disabled:text-slate-400`}
        />
      </div>
      <div>
        <label className={labelClass} htmlFor="ma_remark">Remark (optional)</label>
        <input id="ma_remark" type="text" name="remark" placeholder="e.g. missed punch — verified with the employee" className={inputClass} />
      </div>
      <div className="col-span-full flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save attendance"}
        </button>
        <p className="text-[11px] text-slate-500">
          Punch times are saved in IST and drive the same Work Hours + Present/Late rules as a live punch
          (Present up to 09:45, Late after). Leave a time blank to keep an already-recorded punch.
        </p>
      </div>
    </form>
  );
}
