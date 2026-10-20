"use client";

// 2026-10-19 — "jaruri nahi hai ki leave MD approve kare ... jisko leave
// approval ke liye assign kiya jaye uska naam aaye selection option aaye".
// The Apply form now routes a request to a NAMED approver; this queue is
// where that approver decides it. They don't hold the leave_admin capability
// (that's MD/Admin) — decideLeaveRequest's server gate accepts either a
// leave_admin or a designated approver for the request's own company, so the
// buttons below are the only UI this approver needs.
import { useActionState } from "react";
import { decideLeaveRequest, type LeaveActionState } from "./actions";
import type { LeaveRequestRow } from "./leave-queries";

const initialState: LeaveActionState = { error: null, success: false };
const inputClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

export function LeaveApproverQueue({ requests }: { requests: LeaveRequestRow[] }) {
  // One shared action state is fine — a decision navigates/revalidates away,
  // and the server's compare-and-swap on status guards against double submits.
  const [state, formAction, pending] = useActionState(decideLeaveRequest, initialState);
  if (requests.length === 0) return null;

  return (
    <div className="mb-6 rounded-xl border border-teal-200 bg-teal-50/60 p-4">
      <p className="mb-1 text-sm font-semibold text-teal-800">✋ Awaiting your decision</p>
      <p className="mb-3 text-xs text-teal-700">
        These leave requests were sent to you for approval.
      </p>
      {state.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      <div className="space-y-3">
        {requests.map((r) => (
          <form
            key={r.id}
            action={formAction}
            className="rounded-lg border border-teal-200 bg-white p-3"
          >
            <input type="hidden" name="leave_request_id" value={r.id} />
            <p className="text-sm font-semibold text-slate-800">
              {r.from_date} → {r.to_date}
            </p>
            <p className="mt-0.5 text-xs text-slate-600">{r.reason}</p>
            <p className="mt-1 text-[11px] text-slate-500">Applied {formatIST(r.requested_at)}</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                name="decision_remark"
                placeholder="Remark (optional)"
                className={`${inputClass} min-w-[10rem] flex-1`}
              />
              <button
                type="submit"
                name="decision"
                value="Approved"
                disabled={pending}
                className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                ✓ Approve
              </button>
              <button
                type="submit"
                name="decision"
                value="Rejected"
                disabled={pending}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                ✕ Reject
              </button>
            </div>
          </form>
        ))}
      </div>
    </div>
  );
}

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
