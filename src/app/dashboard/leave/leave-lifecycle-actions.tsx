"use client";

// 2026-10-17 (leave audit + lifecycle) — "agar koi leave lekr bhi office
// aajata hai to vo apni leave approve ko cancel karvayega ya phir modify
// karvayega ki full day ki jagah halfday ya jitne din ki application hai
// usme kitne din pahle aaya hai". ONE component reused on both sides —
// the employee's own Leave page and the admin's Leave Approvals row —
// because the server actions already gate who may act (own request OR
// leave_admin, see canActOnRequest in ../actions.ts); the UI only needs
// to offer the buttons.
import { useActionState, useState } from "react";
import { cancelLeaveRequest, markLeaveHalfDay, shortenLeaveRequest, type LeaveActionState } from "./actions";
import { addDaysToDateStr } from "@/lib/attendance/ist-date";

const initialState: LeaveActionState = { error: null, success: false };
const inputClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

export function LeaveLifecycleActions({
  requestId,
  status,
  fromDate,
  toDate,
  today,
}: {
  requestId: string;
  status: string;
  fromDate: string;
  toDate: string;
  /** IST today — dates after it can't be half-day-converted (nothing to convert yet). */
  today: string;
}) {
  const [cancelState, cancelAction, cancelPending] = useActionState(cancelLeaveRequest, initialState);
  const [halfState, halfAction, halfPending] = useActionState(markLeaveHalfDay, initialState);
  const [shortState, shortAction, shortPending] = useActionState(shortenLeaveRequest, initialState);
  const [showCancel, setShowCancel] = useState(false);
  const [showModify, setShowModify] = useState(false);

  // Half-day conversion only makes sense for days already being taken
  // (from .. min(today, to)) — converting a future day has nothing in
  // attendance to flip yet.
  const halfDayDates: string[] = [];
  if (status === "Approved") {
    const lastConvertible = today < toDate ? today : toDate;
    let d = fromDate;
    while (d <= lastConvertible) {
      halfDayDates.push(d);
      d = addDaysToDateStr(d, 1);
    }
  }
  // Shorten: end date can move to any day strictly after the start.
  const minShortTo = fromDate;
  const maxShortTo = toDate;

  if (status !== "Pending" && status !== "Approved") return null;

  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      {!showCancel && !showModify && (
        <div className="flex flex-wrap gap-2">
          {status === "Approved" && (
            <button
              type="button"
              onClick={() => setShowModify(true)}
              className="rounded-lg border border-sky-300 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100"
            >
              ✏️ Came to office — modify
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowCancel(true)}
            className="rounded-lg border border-red-300 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-100"
          >
            🗑 Cancel this leave
          </button>
        </div>
      )}

      {showModify && status === "Approved" && (
        <div className="space-y-3 rounded-lg bg-sky-50/50 p-2.5">
          <p className="text-xs font-semibold text-slate-600">Modify — you came to office</p>
          {cancelState.error && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{cancelState.error}</p>}
          {halfState.error && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{halfState.error}</p>}
          {halfState.success && halfState.message && (
            <p className="rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">{halfState.message}</p>
          )}
          {shortState.error && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{shortState.error}</p>}
          {shortState.success && shortState.message && (
            <p className="rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">{shortState.message}</p>
          )}

          {/* Full day → half day, for one already-taken day. */}
          {halfDayDates.length > 0 && (
            <form action={halfAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="leave_request_id" value={requestId} />
              <div>
                <label className="mb-1 block text-[11px] text-slate-500">Half day instead of full leave</label>
                <select name="date" required className={inputClass}>
                  {halfDayDates.map((d) => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
              </div>
              <div className="min-w-[8rem] flex-1">
                <label className="mb-1 block text-[11px] text-slate-500">Remark</label>
                <input name="remark" placeholder="optional" className={`${inputClass} w-full`} />
              </div>
              <button
                type="submit"
                disabled={halfPending}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {halfPending ? "Saving..." : "Mark Half Day"}
              </button>
            </form>
          )}

          {/* Shorten — returned before the approved end date. */}
          {toDate > fromDate && (
            <form action={shortAction} className="flex flex-wrap items-end gap-2 border-t border-sky-100 pt-2">
              <input type="hidden" name="leave_request_id" value={requestId} />
              <div>
                <label className="mb-1 block text-[11px] text-slate-500">Now ends on (came back early)</label>
                <input type="date" name="new_to_date" min={minShortTo} max={maxShortTo} required className={inputClass} />
              </div>
              <div className="min-w-[8rem] flex-1">
                <label className="mb-1 block text-[11px] text-slate-500">Remark</label>
                <input name="remark" placeholder="optional" className={`${inputClass} w-full`} />
              </div>
              <button
                type="submit"
                disabled={shortPending}
                className="rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
              >
                {shortPending ? "Saving..." : "Shorten Leave"}
              </button>
            </form>
          )}

          <button
            type="button"
            onClick={() => setShowModify(false)}
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      )}

      {showCancel && (
        <form action={cancelAction} className="space-y-2 rounded-lg bg-red-50/50 p-2.5">
          <input type="hidden" name="leave_request_id" value={requestId} />
          {cancelState.error && <p className="rounded bg-red-100 px-2 py-1.5 text-xs text-red-800">{cancelState.error}</p>}
          <p className="text-xs text-slate-600">
            {status === "Approved"
              ? "Cancelling removes the Leave marked in attendance for these dates and ends any coverage access."
              : "Withdraw this application before it is decided?"}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[10rem] flex-1">
              <label className="mb-1 block text-[11px] text-slate-500">Remark</label>
              <input name="remark" placeholder="e.g. came to office" className={`${inputClass} w-full`} />
            </div>
            <button
              type="submit"
              disabled={cancelPending}
              className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            >
              {cancelPending ? "Cancelling..." : "Yes, Cancel Leave"}
            </button>
            <button
              type="button"
              onClick={() => setShowCancel(false)}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Keep Leave
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
