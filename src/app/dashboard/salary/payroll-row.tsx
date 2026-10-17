"use client";

// 2026-08-12 (round 7): the payroll table used to be a pure PREVIEW — no
// way to actually mark salary as paid. Each row now expands into a real
// "Pay Salary" form (submitSalaryPayment) that recomputes everything
// server-side from Attendance (never trusts what's shown here) and,
// once paid, auto-mirrors into the Finance ledger (bill_pass_register)
// AND optionally recovers part of an outstanding Advance in the same
// action — "jitni sellery debit hoyegi account se to uska bhi konse
// section me jayegi finance ke".
//
// 2026-09-11 (Payroll Phase 1): also now shows a "Statutory Ded." column
// (Employee PF + ESI + Professional Tax, live-previewed for a CTC-mode
// employee — see src/lib/attendance/statutory.ts) and a "Final Net" that
// subtracts it, and links to a printable Payslip once paid.
//
// 2026-10-17 — Salary rules round: the row now also carries the earnings
// side of the calculation (Sunday/holiday extra-duty pay, unused paid-leave
// encashment) and a manual Half Day / Full Day deduction the admin can pick
// per month. Every one of those figures is recomputed server-side by
// submitSalaryPayment from the same computeMonthlyPayroll() the page used.
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import {
  deleteSalaryPayment,
  submitSalaryPayment,
  updateSalaryPayment,
  type FinanceActionState,
  type SimpleActionState,
} from "./actions";

const initialState: FinanceActionState = { error: null, success: false };
const initialSimpleState: SimpleActionState = { error: null, success: false };

export function PayrollRow({
  employeeId,
  employeeName,
  monthParam,
  today,
  monthlySalary,
  allowedLeaves,
  perDayRate,
  present,
  leave,
  absent,
  extraDutyDays,
  extraDutyPay,
  noLeaveBonusPay,
  deductedDays,
  deductionAmount,
  netPay,
  hasSalarySet,
  isCtc,
  employeePf,
  employeeEsi,
  professionalTax,
  alreadyPaid,
  outstandingAdvance,
  recommendedAdvanceDeduction,
}: {
  employeeId: string;
  employeeName: string;
  monthParam: string;
  today: string;
  monthlySalary: number | null;
  allowedLeaves: number | null;
  perDayRate: number | null;
  present: number;
  leave: number;
  absent: number;
  extraDutyDays: number;
  extraDutyPay: number;
  noLeaveBonusPay: number;
  deductedDays: number | null;
  deductionAmount: number | null;
  netPay: number | null;
  hasSalarySet: boolean;
  isCtc: boolean;
  employeePf: number;
  employeeEsi: number;
  professionalTax: number;
  alreadyPaid: { id: string; net_paid_amount: number; payment_date: string; advance_deduction_amount: number; statutory_deduction_amount: number } | null;
  outstandingAdvance: number;
  // 2026-08-12 (round 9): "10000 advance, 10 mahine me recover karna hai
  // to har mahine 1000 kate jaye" — the oldest outstanding advance's own
  // scheduled monthly installment (clamped to what's left), or null if
  // that advance has no fixed schedule (fully manual, as before).
  recommendedAdvanceDeduction: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [state, formAction, pending] = useActionState(submitSalaryPayment, initialState);
  const [editState, editAction, editPending] = useActionState(updateSalaryPayment, initialSimpleState);
  const [editingPayment, setEditingPayment] = useState(false);
  // "Confirm Pay ₹X" used to always show the full pre-deduction netPay,
  // never reflecting whatever the admin actually typed into "Deduct from
  // Advance" — this tracks that input live so the button caption matches
  // what submitSalaryPayment will really pay out. Pre-seeded with the
  // recommended scheduled installment (if any), matching the input's own
  // defaultValue below, so the caption is right even before the admin
  // touches the field.
  const [advanceInput, setAdvanceInput] = useState(recommendedAdvanceDeduction ?? 0);
  // 2026-10-17 — manual Half Day / Full Day deduction ("kisi ka deduction
  // karna ho halfday full day"). 0 = none; 0.5 = half day; 1 = full day;
  // 2/3 = that many full days.
  const [manualDeductionDays, setManualDeductionDays] = useState(0);
  const [isPending, startTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleDeletePayment() {
    if (!alreadyPaid) return;
    if (
      !window.confirm(
        `Delete the ${monthParam} salary payment of ₹${alreadyPaid.net_paid_amount} for ${employeeName}? Its Finance ledger row and any advance recovery are reversed too.`
      )
    ) {
      return;
    }
    setDeleteError(null);
    startTransition(async () => {
      const r = await deleteSalaryPayment(alreadyPaid.id);
      if (r.error) setDeleteError(r.error);
    });
  }
  const previewAdvanceDeduction = Math.min(Math.max(advanceInput, 0), outstandingAdvance);
  const statutoryDeduction = employeePf + employeeEsi + professionalTax;
  const manualDeductionAmount = perDayRate ? Math.round(manualDeductionDays * perDayRate * 100) / 100 : 0;
  const previewNetPay =
    netPay != null ? Math.max(0, netPay - previewAdvanceDeduction - statutoryDeduction - manualDeductionAmount) : null;

  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="py-1.5 pr-3 font-medium text-slate-800">
          {employeeName}
          {isCtc && <span className="ml-1 rounded bg-amber-100 px-1 py-0.5 text-[9px] font-semibold text-amber-700">CTC</span>}
        </td>
        {hasSalarySet ? (
          <>
            <td className="px-2">{monthlySalary?.toFixed(2)}</td>
            <td className="px-2 text-slate-600">{perDayRate ? perDayRate.toFixed(2) : "—"}</td>
            <td className="px-2">{present}</td>
            <td className="px-2 text-sky-700">
              {leave}
              {allowedLeaves != null && <span className="text-slate-400"> / {allowedLeaves}</span>}
            </td>
            <td className="px-2 text-red-700">{absent}</td>
            <td className="px-2 text-purple-700">
              {extraDutyDays > 0 ? extraDutyDays : "—"}
            </td>
            <td className="px-2 text-green-700">{extraDutyPay > 0 ? extraDutyPay.toFixed(2) : "—"}</td>
            <td className="px-2 text-green-700">{noLeaveBonusPay > 0 ? noLeaveBonusPay.toFixed(2) : "—"}</td>
            <td className="px-2">{deductedDays}</td>
            <td className="px-2 text-red-700">{deductionAmount?.toFixed(2)}</td>
            <td className="px-2 text-red-700">{statutoryDeduction > 0 ? statutoryDeduction.toFixed(2) : "—"}</td>
            <td className="px-2 font-semibold text-green-700">{previewNetPay?.toFixed(2)}</td>
            <td className="px-2">
              {alreadyPaid ? (
                <div className="text-green-700">
                  <div className="font-medium">✓ Paid ₹{alreadyPaid.net_paid_amount}</div>
                  <div className="text-slate-400">{alreadyPaid.payment_date}</div>
                  {alreadyPaid.advance_deduction_amount > 0 && (
                    <div className="text-purple-600">Advance recovered ₹{alreadyPaid.advance_deduction_amount}</div>
                  )}
                  <Link href={`/dashboard/salary/payslip/${employeeId}/${monthParam}`} className="mt-0.5 inline-block font-medium text-blue-600 underline">
                    🧾 View Payslip
                  </Link>
                  <div>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={handleDeletePayment}
                      className="mt-0.5 text-[10px] font-medium text-red-600 underline disabled:opacity-50"
                    >
                      {isPending ? "Deleting…" : "Delete payment"}
                    </button>
                    <span className="mx-1 text-slate-300">·</span>
                    <button
                      type="button"
                      onClick={() => setEditingPayment((v) => !v)}
                      className="text-[10px] font-medium text-slate-500 underline"
                    >
                      {editingPayment ? "Cancel edit" : "Edit payment"}
                    </button>
                    {deleteError && <div className="text-[10px] text-red-600">{deleteError}</div>}
                    {editingPayment && (
                      <form action={editAction} className="mt-1 flex flex-wrap items-center gap-1">
                        <input type="hidden" name="id" value={alreadyPaid.id} />
                        <input
                          type="date"
                          name="payment_date"
                          required
                          defaultValue={alreadyPaid.payment_date}
                          className="rounded border border-slate-300 px-1 py-0.5 text-[10px]"
                        />
                        <input
                          name="remark"
                          placeholder="remark"
                          className="w-28 rounded border border-slate-300 px-1 py-0.5 text-[10px]"
                        />
                        <button
                          type="submit"
                          disabled={editPending}
                          className="rounded bg-slate-700 px-1.5 py-0.5 text-[10px] font-semibold text-white disabled:opacity-50"
                        >
                          {editPending ? "Saving…" : "Save"}
                        </button>
                        {editState.error && <span className="text-[10px] text-red-600">{editState.error}</span>}
                        {editState.success && <span className="text-[10px] text-green-700">✓ saved</span>}
                      </form>
                    )}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="rounded-lg bg-blue-600 px-2.5 py-1 font-semibold text-white hover:bg-blue-700"
                >
                  {expanded ? "Cancel" : "Pay Salary"}
                </button>
              )}
            </td>
          </>
        ) : (
          <td colSpan={12} className="px-2 text-slate-400">No salary set yet for this employee.</td>
        )}
      </tr>
      {expanded && !alreadyPaid && (
        <tr className="border-t border-slate-100 bg-blue-50/40">
          <td colSpan={13} className="px-3 py-3">
            <form action={formAction} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="employee_id" value={employeeId} />
              <input type="hidden" name="pay_month" value={monthParam} />
              {state.error && <p className="w-full rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
              {state.success && state.message && (
                <p className="w-full rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">{state.message}</p>
              )}
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">Payment Date</label>
                <input type="date" name="payment_date" defaultValue={today} max={today} required className={fieldClass} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500">
                  Deduction {perDayRate ? `(₹${perDayRate.toFixed(2)}/day)` : ""}
                </label>
                <select
                  name="manual_deduction_days"
                  value={manualDeductionDays}
                  onChange={(e) => setManualDeductionDays(Number(e.target.value) || 0)}
                  className={fieldClass}
                >
                  <option value={0}>None — full pay</option>
                  <option value={0.5}>Half Day — 0.5 day</option>
                  <option value={1}>Full Day — 1 day</option>
                  <option value={2}>2 Full Days</option>
                  <option value={3}>3 Full Days</option>
                </select>
              </div>
              {outstandingAdvance > 0 && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    Deduct from Advance (oldest outstanding advance: ₹{outstandingAdvance})
                    {recommendedAdvanceDeduction != null && (
                      <span className="ml-1 text-purple-600">— scheduled installment, editable</span>
                    )}
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min={0}
                    max={outstandingAdvance}
                    name="advance_deduction_amount"
                    defaultValue={recommendedAdvanceDeduction ?? undefined}
                    placeholder="0"
                    onChange={(e) => setAdvanceInput(Number(e.target.value) || 0)}
                    className={fieldClass}
                  />
                </div>
              )}
              {statutoryDeduction > 0 && (
                <div className="text-xs text-amber-700">
                  Statutory Ded. (PF/ESI/PT): <span className="font-semibold">₹{statutoryDeduction.toFixed(2)}</span> — applied automatically
                </div>
              )}
              <div className="min-w-[10rem] flex-1">
                <label className="mb-1 block text-xs font-medium text-slate-500">Remark</label>
                <input name="remark" placeholder="optional" className={fieldClass} />
              </div>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {pending ? "Paying..." : `✔ Confirm Pay ₹${previewNetPay?.toFixed(2)}`}
              </button>
            </form>
            <p className="mt-2 text-[11px] text-slate-500">
              This month includes Extra Duty Pay ₹{extraDutyPay.toFixed(2)} (Sunday/holiday work) and No-Leave Bonus ₹
              {noLeaveBonusPay.toFixed(2)}. The manual deduction above is applied on top of attendance deductions and is
              recorded in the payment remark.
            </p>
          </td>
        </tr>
      )}
    </>
  );
}

const fieldClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
