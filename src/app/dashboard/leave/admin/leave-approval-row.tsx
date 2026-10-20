"use client";

// 2026-08-12 (round 8): one row per leave request on the MD/Admin Leave
// Approvals screen. Pending -> Approve/Reject (with an optional remark on
// reject). Approved -> an "Assign Coverage" mini-form (covering employee +
// store + date range, defaulting to the leave's own range) that is ITSELF
// the access grant — see assignCoverage/getAuthedEmployee().
//
// 2026-10-17 (leave audit + lifecycle): the row now also SHOWS the full
// audit facts — applied-at with location, approved-by name + time,
// cancelled-on — the event timeline, and the cancel/modify actions
// (shared component, server-gated) so an admin can handle the
// "leave lekr bhi office aa gaya" case right here.
import { useActionState, useState, useTransition } from "react";
import { decideLeaveRequest, assignCoverage, removeCoverage, type LeaveActionState } from "../actions";
import { LeaveLifecycleActions } from "../leave-lifecycle-actions";

const initialState: LeaveActionState = { error: null, success: false };
const inputClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

export type RequestEventRow = {
  id: string;
  event_type: string;
  actor_name: string | null;
  event_at: string;
  details: string | null;
};

export type CoverageRow = {
  id: string;
  covering_employee_name: string;
  store_name: string;
  from_date: string;
  to_date: string;
};

export function LeaveApprovalRow({
  requestId,
  employeeName,
  fromDate,
  toDate,
  reason,
  status,
  requestedAt,
  decisionRemark,
  decidedByName,
  decidedAt,
  approverName,
  cancelledAt,
  cancelledRemark,
  appliedLat,
  appliedLng,
  events,
  today,
  leaveTypeName,
  employees,
  stores,
  coverage,
}: {
  requestId: string;
  employeeName: string;
  fromDate: string;
  toDate: string;
  reason: string;
  status: string;
  requestedAt: string;
  decisionRemark: string | null;
  // 2026-10-17 audit fields.
  decidedByName?: string | null;
  decidedAt?: string | null;
  /** 2026-10-19 — who the application was routed to (designated approver). */
  approverName?: string | null;
  cancelledAt?: string | null;
  cancelledRemark?: string | null;
  appliedLat?: number | null;
  appliedLng?: number | null;
  events?: RequestEventRow[];
  today: string;
  // 2026-09-11 (Payroll Phase 2): null = untyped request, governed by the
  // original flat allowed_leaves_per_month pool exactly as before.
  leaveTypeName?: string | null;
  employees: { id: string; name: string }[];
  stores: { id: string; name: string }[];
  coverage: CoverageRow[];
}) {
  const [decideState, decideAction, decidePending] = useActionState(decideLeaveRequest, initialState);
  const [assignState, assignAction, assignPending] = useActionState(assignCoverage, initialState);
  const [showAssign, setShowAssign] = useState(false);
  const [revokePending, startRevokeTransition] = useTransition();
  const [revokingId, setRevokingId] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            {employeeName}
            {leaveTypeName && (
              <span className="ml-1.5 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-medium text-sky-700">{leaveTypeName}</span>
            )}
          </p>
          {/* 2026-10-17 — "usme date & time nahi aata with location" /
              "approve kisne ki hai kis time par ki hai". */}
          <p className="text-xs text-slate-500">
            {fromDate} → {toDate} · applied {formatIST(requestedAt)}
            {appliedLat != null && appliedLng != null && (
              <>
                {" "}
                ·{" "}
                <a
                  href={`https://www.google.com/maps?q=${appliedLat},${appliedLng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sky-600 hover:underline"
                >
                  📍 {appliedLat.toFixed(4)}, {appliedLng.toFixed(4)}
                </a>
              </>
            )}
          </p>
          <p className="mt-1 text-xs text-slate-600">{reason}</p>
          {status === "Pending" && approverName && (
            <p className="mt-1 text-xs text-teal-700">📨 Routed to {approverName} for approval</p>
          )}
          {(status === "Approved" || status === "Rejected") && decidedAt && (
            <p className={`mt-1 text-xs ${status === "Approved" ? "text-green-700" : "text-red-700"}`}>
              {status === "Approved" ? "✓ Approved" : "✕ Rejected"} by {decidedByName ?? "MD/Admin"} on {formatIST(decidedAt)}
            </p>
          )}
          {status === "Cancelled" && cancelledAt && (
            <p className="mt-1 text-xs text-slate-500">🗑 Cancelled on {formatIST(cancelledAt)}{cancelledRemark ? ` — ${cancelledRemark}` : ""}</p>
          )}
        </div>
        <StatusBadge status={status} />
      </div>

      {status === "Pending" && (
        <form action={decideAction} className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
          <input type="hidden" name="leave_request_id" value={requestId} />
          {decideState.error && <p className="w-full rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{decideState.error}</p>}
          <div className="min-w-[10rem] flex-1">
            <input name="decision_remark" placeholder="Remark (optional, shown if rejected)" className={`${inputClass} w-full`} />
          </div>
          <button
            type="submit"
            name="decision"
            value="Approved"
            disabled={decidePending}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            ✓ Approve
          </button>
          <button
            type="submit"
            name="decision"
            value="Rejected"
            disabled={decidePending}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            ✕ Reject
          </button>
        </form>
      )}

      {status === "Rejected" && decisionRemark && <p className="mt-2 text-xs text-red-700">Remark: {decisionRemark}</p>}

      {/* 2026-10-17 — cancel/modify for the "came to office anyway" case
          (server action gates own-vs-admin; see canActOnRequest). */}
      {(status === "Pending" || status === "Approved") && (
        <LeaveLifecycleActions requestId={requestId} status={status} fromDate={fromDate} toDate={toDate} today={today} />
      )}

      {/* 2026-10-17 — full audit timeline (always shown when there is more
          than the single Applied event, e.g. after a cancel or a half-day
          conversion). */}
      {(events?.length ?? 0) > 1 && (
        <div className="mt-2 border-t border-slate-100 pt-2">
          <p className="mb-1 text-[11px] font-medium text-slate-400">History</p>
          <ul className="space-y-0.5 text-[11px] text-slate-500">
            {events!.map((ev) => (
              <li key={ev.id}>
                <span className="font-medium text-slate-600">{ev.event_type}</span>
                {ev.actor_name ? ` by ${ev.actor_name}` : ""} · {formatIST(ev.event_at)}
                {ev.details ? ` — ${ev.details}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {status === "Approved" && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <p className="mb-1.5 text-xs font-semibold text-slate-500">Coverage while away</p>
          {coverage.length > 0 && (
            <ul className="mb-2 space-y-1 text-xs text-slate-700">
              {coverage.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <span>
                    {c.covering_employee_name} → {c.store_name} ({c.from_date} to {c.to_date})
                  </span>
                  <button
                    type="button"
                    disabled={revokePending}
                    onClick={() => {
                      setRevokingId(c.id);
                      startRevokeTransition(async () => {
                        await removeCoverage(c.id);
                      });
                    }}
                    className="shrink-0 text-red-600 hover:underline disabled:opacity-50"
                  >
                    {revokePending && revokingId === c.id ? "Revoking..." : "Revoke"}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!showAssign ? (
            <button
              type="button"
              onClick={() => setShowAssign(true)}
              className="rounded-lg border border-teal-300 bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700 hover:bg-teal-100"
            >
              + Assign Coverage
            </button>
          ) : (
            <form action={assignAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="leave_request_id" value={requestId} />
              {assignState.error && <p className="w-full rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{assignState.error}</p>}
              {assignState.success && assignState.message && (
                <p className="w-full rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">{assignState.message}</p>
              )}
              <div>
                <label className="mb-1 block text-xs text-slate-500">Covering Employee</label>
                <select name="covering_employee_id" required className={inputClass}>
                  <option value="">—</option>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>{e.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">Store</label>
                <select name="store_id" required className={inputClass}>
                  <option value="">—</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">From</label>
                <input type="date" name="from_date" defaultValue={fromDate} min={fromDate} max={toDate} required className={inputClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs text-slate-500">To</label>
                <input type="date" name="to_date" defaultValue={toDate} min={fromDate} max={toDate} required className={inputClass} />
              </div>
              <div className="min-w-[8rem] flex-1">
                <label className="mb-1 block text-xs text-slate-500">Remark</label>
                <input name="remark" placeholder="optional" className={`${inputClass} w-full`} />
              </div>
              <button
                type="submit"
                disabled={assignPending}
                className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
              >
                {assignPending ? "Saving..." : "Grant Access"}
              </button>
              <button
                type="button"
                onClick={() => setShowAssign(false)}
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "Approved"
      ? "bg-green-50 text-green-700"
      : status === "Rejected"
        ? "bg-red-50 text-red-700"
        : status === "Cancelled"
          ? "bg-slate-100 text-slate-500"
          : "bg-amber-50 text-amber-700";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}

/** Full "17 Oct 2026, 09:42" IST rendering for audit timestamps. */
function formatIST(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
