"use client";

// 2026-10-19 — "jaruri nahi hai ki leave MD approve kare Ajay Lohra & RD
// Lohra, or jisko leave approval ke liye assign kiya jaye uska naam aaye
// selection option aaye". MD/Admin designates any active employee as a leave
// approver for the selected company here. That person then appears by name on
// the Apply-for-Leve form and can decide requests (see
// leave-approver-queue.tsx) without holding leave_admin.
import { useActionState } from "react";
import { assignLeaveApprover, removeLeaveApprover, type LeaveActionState } from "../actions";
import type { LeaveApprover } from "../leave-queries";

const initialState: LeaveActionState = { error: null, success: false };
const inputClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

export function LeaveApproversPanel({
  companyId,
  employees,
  approvers,
  available,
}: {
  companyId: string;
  employees: { id: string; name: string }[];
  approvers: LeaveApprover[];
  available: boolean;
}) {
  const [state, formAction, pending] = useActionState(assignLeaveApprover, initialState);
  const [removeState, removeAction, removePending] = useActionState(removeLeaveApprover, initialState);

  if (!available) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
        <p className="text-sm font-semibold text-amber-800">👋 Leave Approvers</p>
        <p className="mt-1 text-xs text-amber-900">
          This database doesn&apos;t have the 2026-10-19 leave-approver migration yet, so nobody can be designated as
          an approver — leave goes to MD/Admin as before. Run db/2026-10-19-leave-approvers.sql in the Supabase SQL
          Editor to enable it.
        </p>
      </div>
    );
  }

  const assignable = employees.filter((e) => !approvers.some((a) => a.employee_id === e.id));

  return (
    <div className="rounded-xl border border-teal-200 bg-teal-50/40 p-4">
      <p className="mb-1 text-sm font-semibold text-teal-800">👋 Leave Approvers</p>
      <p className="mb-3 text-xs text-teal-700">
        These people can approve/reject leave for this company (and appear on the Apply form) — they don&apos;t need the
        Leave Approvals capability. MD/Admin can always approve too.
      </p>
      {state.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {removeState.error && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{removeState.error}</p>
      )}
      {state.success && state.message && (
        <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">{state.message}</p>
      )}

      {approvers.length > 0 && (
        <ul className="mb-3 space-y-1.5">
          {approvers.map((a) => (
            <li key={a.employee_id} className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium text-teal-900">{a.name}</span>
              <form action={removeAction} className="flex items-center gap-2">
                <input type="hidden" name="company_id" value={companyId} />
                <input type="hidden" name="employee_id" value={a.employee_id} />
                <button
                  type="submit"
                  disabled={removePending}
                  className="rounded-lg border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  {removePending ? "Removing..." : "Remove"}
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}
      {approvers.length === 0 && (
        <p className="mb-3 text-xs text-teal-700">No leave approvers designated yet — everyone&apos;s leave goes to MD/Admin.</p>
      )}

      <form action={formAction} className="flex flex-wrap items-end gap-2 border-t border-teal-100 pt-3">
        <input type="hidden" name="company_id" value={companyId} />
        <div className="min-w-[12rem] flex-1">
          <label className="mb-1 block text-xs text-teal-700">Add an employee as leave approver</label>
          <select name="employee_id" required defaultValue="" className={`${inputClass} w-full`}>
            <option value="">— Select employee —</option>
            {assignable.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={pending || assignable.length === 0}
          className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
        >
          {pending ? "Adding..." : "+ Add Approver"}
        </button>
      </form>
    </div>
  );
}
