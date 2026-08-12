"use client";

// 2026-08-12 (round 8): one row per leave request on the MD/Admin Leave
// Approvals screen. Pending -> Approve/Reject (with an optional remark on
// reject). Approved -> an "Assign Coverage" mini-form (covering employee +
// store + date range, defaulting to the leave's own range) that is ITSELF
// the access grant — see assignCoverage/getAuthedEmployee().
import { useActionState, useState, useTransition } from "react";
import { decideLeaveRequest, assignCoverage, removeCoverage, type LeaveActionState } from "../actions";

const initialState: LeaveActionState = { error: null, success: false };
const inputClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

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
          <p className="text-sm font-semibold text-slate-800">{employeeName}</p>
          <p className="text-xs text-slate-500">
            {fromDate} → {toDate} · applied {requestedAt.slice(0, 10)}
          </p>
          <p className="mt-1 text-xs text-slate-600">{reason}</p>
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
        : "bg-amber-50 text-amber-700";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}
