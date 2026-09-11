"use client";

// 2026-09-11 (Payroll Phase 2): admin-only panel on the Leave Approvals
// page — configure real leave categories (Casual/Sick/Earned/...) and make
// one-off manual balance corrections (opening balances migrated from
// before this system existed, carry-forward each January since this app
// doesn't automate that — see the honest caveat below, or fixing a
// mistake). Gated by the SAME leave_admin capability as everything else on
// this page — no new capability was added for Phase 2.
import { useActionState, useEffect, useState } from "react";
import { manageLeaveType, adjustLeaveBalance, type LeaveActionState } from "../actions";

const initialState: LeaveActionState = { error: null, success: false };
const inputClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs text-slate-500";

export type LeaveTypeRow = {
  id: string;
  name: string;
  code: string | null;
  paid: boolean;
  annual_accrual_days: number;
  accrual_frequency: "Monthly" | "Upfront";
  carry_forward_cap: number | null;
  active: boolean;
};

export function LeaveTypesPanel({
  leaveTypes,
  employees,
  currentYear,
}: {
  leaveTypes: LeaveTypeRow[];
  employees: { id: string; name: string }[];
  currentYear: number;
}) {
  const [showAddNew, setShowAddNew] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-700">🗂️ Leave Types</p>
          <button
            type="button"
            onClick={() => setShowAddNew((v) => !v)}
            className="rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100"
          >
            {showAddNew ? "Cancel" : "+ Add Leave Type"}
          </button>
        </div>

        {showAddNew && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50/40 p-3">
            <LeaveTypeForm onSaved={() => setShowAddNew(false)} />
          </div>
        )}

        <div className="space-y-2">
          {leaveTypes.map((t) =>
            editingId === t.id ? (
              <div key={t.id} className="rounded-lg border border-slate-300 bg-slate-50 p-3">
                <LeaveTypeForm leaveType={t} onSaved={() => setEditingId(null)} />
              </div>
            ) : (
              <div key={t.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-2.5 text-sm">
                <div>
                  <span className="font-medium text-slate-800">{t.name}</span>
                  {t.code && <span className="ml-1 text-xs text-slate-400">({t.code})</span>}
                  {!t.active && <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500">Inactive</span>}
                  {!t.paid && <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-600">Unpaid</span>}
                  <p className="mt-0.5 text-xs text-slate-500">
                    {t.annual_accrual_days} days/year · {t.accrual_frequency}
                    {t.carry_forward_cap != null ? ` · carry-forward cap ${t.carry_forward_cap}` : ""}
                  </p>
                </div>
                <button type="button" onClick={() => setEditingId(t.id)} className="text-xs font-medium text-blue-600 hover:underline">
                  Edit
                </button>
              </div>
            )
          )}
          {leaveTypes.length === 0 && !showAddNew && (
            <p className="py-4 text-center text-xs text-slate-400">
              No leave types set up yet — leave requests use the original flat monthly allowance until you add some.
            </p>
          )}
        </div>
        <p className="mt-3 text-[11px] text-slate-400">
          Accrual convention: &quot;Monthly&quot; grants 1/12th of the annual figure at the start of each active
          calendar month; &quot;Upfront&quot; grants the whole figure as soon as the employee is active this year.
          This is a common/standard default, not a verified copy of this company&apos;s actual written leave policy.
          Carry-forward isn&apos;t automated — use &quot;Adjust Balance&quot; below each January to carry over what
          you want to allow.
        </p>
      </div>

      {leaveTypes.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-3 text-sm font-semibold text-slate-700">⚖️ Adjust Employee Balance</p>
          <AdjustBalanceForm employees={employees} leaveTypes={leaveTypes.filter((t) => t.paid)} currentYear={currentYear} />
        </div>
      )}
    </div>
  );
}

function LeaveTypeForm({ leaveType, onSaved }: { leaveType?: LeaveTypeRow; onSaved: () => void }) {
  const [state, formAction, pending] = useActionState(manageLeaveType, initialState);

  useEffect(() => {
    if (state.success) onSaved();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      {leaveType && <input type="hidden" name="id" value={leaveType.id} />}
      {state.error && <p className="w-full rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
      {state.success && state.message && <p className="w-full rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">{state.message}</p>}
      <div>
        <label className={labelClass}>Name *</label>
        <input name="name" defaultValue={leaveType?.name} required placeholder="Casual Leave" className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Code</label>
        <input name="code" defaultValue={leaveType?.code ?? ""} placeholder="CL" className={`${inputClass} w-16`} />
      </div>
      <div>
        <label className={labelClass}>Days/Year *</label>
        <input type="number" step="0.5" min="0" name="annual_accrual_days" defaultValue={leaveType?.annual_accrual_days ?? 12} required className={`${inputClass} w-20`} />
      </div>
      <div>
        <label className={labelClass}>Accrual</label>
        <select name="accrual_frequency" defaultValue={leaveType?.accrual_frequency ?? "Monthly"} className={inputClass}>
          <option value="Monthly">Monthly</option>
          <option value="Upfront">Upfront</option>
        </select>
      </div>
      <div>
        <label className={labelClass}>Carry-Fwd Cap</label>
        <input type="number" step="0.5" min="0" name="carry_forward_cap" defaultValue={leaveType?.carry_forward_cap ?? ""} placeholder="none" className={`${inputClass} w-20`} />
      </div>
      <label className="flex items-center gap-1.5 text-xs text-slate-600">
        <input type="checkbox" name="paid" value="true" defaultChecked={leaveType?.paid ?? true} />
        Paid
      </label>
      <label className="flex items-center gap-1.5 text-xs text-slate-600">
        <input type="checkbox" name="active" value="true" defaultChecked={leaveType?.active ?? true} />
        Active
      </label>
      {/* Unchecked checkboxes simply aren't submitted, so an explicit
          hidden "false" fallback (only reachable when unchecked, since the
          checked box's own value wins by DOM order) keeps the action able
          to tell "false" apart from "not present". */}
      <input type="hidden" name="paid" value="false" />
      <input type="hidden" name="active" value="false" />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save"}
      </button>
    </form>
  );
}

function AdjustBalanceForm({
  employees,
  leaveTypes,
  currentYear,
}: {
  employees: { id: string; name: string }[];
  leaveTypes: LeaveTypeRow[];
  currentYear: number;
}) {
  const [state, formAction, pending] = useActionState(adjustLeaveBalance, initialState);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-2">
      {state.error && <p className="w-full rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
      {state.success && state.message && <p className="w-full rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">{state.message}</p>}
      <div>
        <label className={labelClass}>Employee *</label>
        <select name="employee_id" required className={inputClass}>
          <option value="">—</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>Leave Type *</label>
        <select name="leave_type_id" required className={inputClass}>
          <option value="">—</option>
          {leaveTypes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>Leave Year *</label>
        <input type="number" name="leave_year" defaultValue={currentYear} required className={`${inputClass} w-20`} />
      </div>
      <div>
        <label className={labelClass}>Adjustment (days) *</label>
        <input type="number" step="0.5" name="adjustment_days" placeholder="+5 or -2" required className={`${inputClass} w-24`} />
      </div>
      <div className="min-w-[8rem] flex-1">
        <label className={labelClass}>Reason</label>
        <input name="reason" placeholder="e.g. carry-forward from 2025" className={`${inputClass} w-full`} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-teal-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-teal-700 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Apply"}
      </button>
    </form>
  );
}
