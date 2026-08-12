"use client";

// 2026-08-12 (round 7): the payroll table used to be a pure PREVIEW — no
// way to actually mark salary as paid. Each row now expands into a real
// "Pay Salary" form (submitSalaryPayment) that recomputes everything
// server-side from Attendance (never trusts what's shown here) and,
// once paid, auto-mirrors into the Finance ledger (bill_pass_register)
// AND optionally recovers part of an outstanding Advance in the same
// action — "jitni sellery debit hoyegi account se to uska bhi konse
// section me jayegi finance ke".
import { useActionState, useState } from "react";
import { submitSalaryPayment, type FinanceActionState } from "./actions";

const initialState: FinanceActionState = { error: null, success: false };

export function PayrollRow({
  employeeId,
  employeeName,
  monthParam,
  today,
  monthlySalary,
  allowedLeaves,
  present,
  leave,
  absent,
  deductedDays,
  deductionAmount,
  netPay,
  hasSalarySet,
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
  present: number;
  leave: number;
  absent: number;
  deductedDays: number | null;
  deductionAmount: number | null;
  netPay: number | null;
  hasSalarySet: boolean;
  alreadyPaid: { net_paid_amount: number; payment_date: string; advance_deduction_amount: number } | null;
  outstandingAdvance: number;
  // 2026-08-12 (round 9): "10000 advance, 10 mahine me recover karna hai
  // to har mahine 1000 kate jaye" — the oldest outstanding advance's own
  // scheduled monthly installment (clamped to what's left), or null if
  // that advance has no fixed schedule (fully manual, as before).
  recommendedAdvanceDeduction: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const [state, formAction, pending] = useActionState(submitSalaryPayment, initialState);
  // "Confirm Pay ₹X" used to always show the full pre-deduction netPay,
  // never reflecting whatever the admin actually typed into "Deduct from
  // Advance" — this tracks that input live so the button caption matches
  // what submitSalaryPayment will really pay out. Pre-seeded with the
  // recommended scheduled installment (if any), matching the input's own
  // defaultValue below, so the caption is right even before the admin
  // touches the field.
  const [advanceInput, setAdvanceInput] = useState(recommendedAdvanceDeduction ?? 0);
  const previewAdvanceDeduction = Math.min(Math.max(advanceInput, 0), outstandingAdvance);
  const previewNetPay = netPay != null ? Math.max(0, netPay - previewAdvanceDeduction) : null;

  return (
    <>
      <tr className="border-t border-slate-100">
        <td className="py-1.5 pr-3 font-medium text-slate-800">{employeeName}</td>
        {hasSalarySet ? (
          <>
            <td className="px-2">{monthlySalary?.toFixed(2)}</td>
            <td className="px-2">{allowedLeaves}</td>
            <td className="px-2">{present}</td>
            <td className="px-2 text-sky-700">{leave}</td>
            <td className="px-2 text-red-700">{absent}</td>
            <td className="px-2">{deductedDays}</td>
            <td className="px-2 text-red-700">{deductionAmount?.toFixed(2)}</td>
            <td className="px-2 font-semibold text-green-700">{netPay?.toFixed(2)}</td>
            <td className="px-2">
              {alreadyPaid ? (
                <div className="text-green-700">
                  <div className="font-medium">✓ Paid ₹{alreadyPaid.net_paid_amount}</div>
                  <div className="text-slate-400">{alreadyPaid.payment_date}</div>
                  {alreadyPaid.advance_deduction_amount > 0 && (
                    <div className="text-purple-600">Advance recovered ₹{alreadyPaid.advance_deduction_amount}</div>
                  )}
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
          <td colSpan={9} className="px-2 text-slate-400">No salary set yet for this employee.</td>
        )}
      </tr>
      {expanded && !alreadyPaid && (
        <tr className="border-t border-slate-100 bg-blue-50/40">
          <td colSpan={10} className="px-3 py-3">
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
          </td>
        </tr>
      )}
    </>
  );
}

const fieldClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
