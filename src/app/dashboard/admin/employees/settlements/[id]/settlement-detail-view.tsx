"use client";

// 2026-09-11 (Payroll Phase 4 — final phase) — the working screen for one
// Full & Final settlement. Everything under "Reference numbers" is exactly
// that — reference only, computed live from src/lib/attendance/settlement.ts
// and Phase 2's leave-balance math — nothing here is a line item until the
// admin explicitly adds one via the form below. See employee_settlement_
// line_items' own DB comment for why this is deliberately manual.
//
// Status machine: Draft (line items can be added/removed, or the whole
// settlement cancelled) -> Finalized (locked; only "Record Payment" left)
// -> Paid (read-only from here on; mirrored into bill_pass_register).
import { useActionState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PrintArea, PrintButton } from "@/components/print-view";
import {
  addSettlementLineItem,
  deleteSettlementLineItem,
  finalizeSettlement,
  recordSettlementPayment,
  cancelSettlement,
  type SettlementActionState,
} from "../actions";

const initialState: SettlementActionState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type LineItemRow = {
  id: string;
  kind: string;
  category: string;
  description: string | null;
  amount: number;
  created_at: string;
};

export type LeaveBalanceReference = {
  id: string;
  name: string;
  balance: number;
  referenceAmount: number;
};

type SettlementInfo = {
  id: string;
  separationType: string;
  resignationDate: string;
  lastWorkingDay: string;
  reason: string | null;
  noticeRequiredDays: number;
  noticeServedDays: number;
  status: string;
  initiatedAt: string;
  finalizedAt: string | null;
  paymentDate: string | null;
  remark: string | null;
};

type EmployeeInfo = {
  name: string;
  designation: string | null;
  employeeCode: string | null;
  dateOfJoining: string | null;
  panNumber: string | null;
  bankAccountHolderName: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  bankName: string | null;
};

type ReferenceInfo = {
  monthlySalary: number;
  basicForGratuity: number;
  yearsOfService: number;
  gratuityEligible: boolean;
  gratuityCompletedYears: number;
  gratuityEstimate: number;
  noticeShortfallDays: number;
  perDayRate: number;
  noticePayReference: number;
  outstandingAdvanceTotal: number;
  leaveBalances: LeaveBalanceReference[];
}

export function SettlementDetailView({
  settlement,
  employee,
  companyName,
  reference,
  lineItems,
}: {
  settlement: SettlementInfo;
  employee: EmployeeInfo;
  companyName: string;
  reference: ReferenceInfo;
  lineItems: LineItemRow[];
}) {
  const router = useRouter();
  const [addState, addAction, addPending] = useActionState(addSettlementLineItem, initialState);
  const [finalizeState, finalizeAction, finalizePending] = useActionState(finalizeSettlement, initialState);
  const [payState, payAction, payPending] = useActionState(recordSettlementPayment, initialState);
  const [deletePending, startDeleteTransition] = useTransition();
  const [cancelPending, startCancelTransition] = useTransition();

  const isDraft = settlement.status === "Draft";
  const isFinalized = settlement.status === "Finalized";
  const isPaid = settlement.status === "Paid";

  const additions = lineItems.filter((l) => l.kind === "Addition");
  const deductions = lineItems.filter((l) => l.kind === "Deduction");
  const additionsTotal = additions.reduce((sum, l) => sum + l.amount, 0);
  const deductionsTotal = deductions.reduce((sum, l) => sum + l.amount, 0);
  const netAmount = Math.max(0, Math.round((additionsTotal - deductionsTotal) * 100) / 100);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 print:hidden">
        <div>
          <button
            type="button"
            onClick={() => router.push("/dashboard/admin/employees/settlements")}
            className="mb-1 text-xs text-slate-400 hover:text-slate-600"
          >
            ← All Settlements
          </button>
          <h1 className="text-xl font-semibold text-slate-900">
            🧾 {employee.name} — {settlement.separationType}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={settlement.status} />
          <PrintButton label="🖨 Settlement Statement" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 print:hidden">
        <div className="space-y-6 lg:col-span-2">
          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Settlement Details</h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
              <Field label="Employee" value={`${employee.name}${employee.employeeCode ? ` (${employee.employeeCode})` : ""}`} />
              <Field label="Designation" value={employee.designation} />
              <Field label="Company" value={companyName} />
              <Field label="Date of Joining" value={employee.dateOfJoining} />
              <Field label="Resignation / Decision Date" value={settlement.resignationDate} />
              <Field label="Last Working Day" value={settlement.lastWorkingDay} />
              <Field label="Notice Required / Served" value={`${settlement.noticeRequiredDays} / ${settlement.noticeServedDays} days`} />
              <Field label="Reason" value={settlement.reason} />
            </div>
          </section>

          <section className="rounded-xl border border-amber-200 bg-amber-50/40 p-4">
            <h2 className="mb-1 text-sm font-semibold text-slate-700">Reference Numbers (not line items)</h2>
            <p className="mb-3 text-[11px] text-slate-500">
              These are calculated for your reference only — nothing here is added to the settlement until you add it
              yourself as a line item below. The gratuity figure is a rough estimate (Basic × 15/26 × completed years)
              and needs your CA/accountant&apos;s confirmation before use.
            </p>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <RefTile label="Years of Service" value={reference.yearsOfService.toFixed(2)} />
              <RefTile label="Per-Day Rate" value={`₹${reference.perDayRate.toFixed(2)}`} />
              <RefTile label="Notice Shortfall" value={`${reference.noticeShortfallDays} days`} sub={`≈ ₹${reference.noticePayReference.toFixed(2)}`} />
              <RefTile
                label="Gratuity Estimate"
                value={reference.gratuityEligible ? `₹${reference.gratuityEstimate.toFixed(2)}` : "Not eligible"}
                sub={reference.gratuityEligible ? `${reference.gratuityCompletedYears} completed yrs` : "needs 5+ yrs service"}
              />
              <RefTile label="Outstanding Advances" value={`₹${reference.outstandingAdvanceTotal.toFixed(2)}`} />
              {reference.leaveBalances.map((lb) => (
                <RefTile
                  key={lb.id}
                  label={`${lb.name} Balance`}
                  value={`${lb.balance.toFixed(1)} days`}
                  sub={`≈ ₹${lb.referenceAmount.toFixed(2)}`}
                />
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-700">Line Items</h2>
            {lineItems.length === 0 && <p className="py-3 text-center text-xs text-slate-400">No line items yet.</p>}

            {additions.length > 0 && (
              <div className="mb-3">
                <p className="mb-1 text-xs font-semibold text-green-700">Additions</p>
                <div className="space-y-1">
                  {additions.map((l) => (
                    <LineItemRowView key={l.id} item={l} editable={isDraft} pending={deletePending} onDelete={() => startDeleteTransition(async () => { await deleteSettlementLineItem(l.id); })} />
                  ))}
                </div>
              </div>
            )}

            {deductions.length > 0 && (
              <div className="mb-3">
                <p className="mb-1 text-xs font-semibold text-red-700">Deductions</p>
                <div className="space-y-1">
                  {deductions.map((l) => (
                    <LineItemRowView key={l.id} item={l} editable={isDraft} pending={deletePending} onDelete={() => startDeleteTransition(async () => { await deleteSettlementLineItem(l.id); })} />
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
              <span className="font-medium text-slate-600">Net (Additions − Deductions)</span>
              <span className="text-base font-bold text-slate-900">₹{netAmount.toFixed(2)}</span>
            </div>

            {isDraft && (
              <form action={addAction} className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                <input type="hidden" name="settlement_id" value={settlement.id} />
                <p className="text-xs font-semibold text-slate-600">+ Add Line Item</p>
                {addState.error && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{addState.error}</p>}
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <select name="kind" required defaultValue="Addition" className={inputClass}>
                    <option value="Addition">Addition</option>
                    <option value="Deduction">Deduction</option>
                  </select>
                  <input name="category" required placeholder="Category (e.g. Leave Encashment)" className={`${inputClass} sm:col-span-2`} />
                  <input type="number" name="amount" min={0.01} step={0.01} required placeholder="Amount ₹" className={inputClass} />
                </div>
                <input name="description" placeholder="Note (optional)" className={inputClass} />
                <button
                  type="submit"
                  disabled={addPending}
                  className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  {addPending ? "Adding..." : "Add Line Item"}
                </button>
              </form>
            )}
          </section>
        </div>

        <div className="space-y-6">
          {isDraft && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Finalize</h2>
              <p className="mb-3 text-[11px] text-slate-500">
                Locks the line items — no more additions or deletions after this. You can still Record Payment once
                finalized.
              </p>
              <form action={finalizeAction} className="space-y-2">
                <input type="hidden" name="settlement_id" value={settlement.id} />
                {finalizeState.error && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{finalizeState.error}</p>}
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  <input type="checkbox" name="deactivate_employee" value="true" className="rounded" />
                  Also deactivate this employee&apos;s login
                </label>
                <button
                  type="submit"
                  disabled={finalizePending}
                  className="w-full rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {finalizePending ? "Finalizing..." : "Finalize Settlement"}
                </button>
              </form>
              <button
                type="button"
                disabled={cancelPending}
                onClick={() => {
                  if (!confirm("Cancel this Draft settlement and delete its line items?")) return;
                  startCancelTransition(async () => {
                    const res = await cancelSettlement(settlement.id);
                    if (res.success) router.push("/dashboard/admin/employees/settlements");
                  });
                }}
                className="mt-2 w-full rounded-lg border border-red-200 px-4 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                {cancelPending ? "Cancelling..." : "Cancel Settlement"}
              </button>
            </section>
          )}

          {isFinalized && (
            <section className="rounded-xl border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-700">Record Payment</h2>
              <p className="mb-3 text-[11px] text-slate-500">
                Marks this settlement Paid — irreversible from here. A net amount above ₹0 is mirrored into the Finance
                ledger (Bill Pass Register) automatically.
              </p>
              <form action={payAction} className="space-y-2">
                <input type="hidden" name="settlement_id" value={settlement.id} />
                {payState.error && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{payState.error}</p>}
                <div>
                  <label className={labelClass}>Payment Date *</label>
                  <input type="date" name="payment_date" required className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Remark (optional)</label>
                  <input name="remark" className={inputClass} />
                </div>
                <button
                  type="submit"
                  disabled={payPending}
                  className="w-full rounded-lg bg-green-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {payPending ? "Recording..." : `Record Payment — ₹${netAmount.toFixed(2)}`}
                </button>
              </form>
            </section>
          )}

          {isPaid && (
            <section className="rounded-xl border border-green-200 bg-green-50 p-4 text-xs text-green-800">
              <p className="font-semibold">Paid on {settlement.paymentDate}</p>
              {settlement.remark && <p className="mt-1">{settlement.remark}</p>}
              <p className="mt-2 text-green-700">Mirrored into the Finance ledger if the net amount was above ₹0.</p>
            </section>
          )}
        </div>
      </div>

      <PrintArea id="settlement-print-area">
        <div className="mx-auto hidden max-w-2xl rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-800 print:block">
          <div className="mb-4 flex items-start justify-between border-b border-slate-200 pb-3">
            <div>
              <div className="text-base font-bold">{companyName}</div>
              <div className="text-xs text-slate-500">Full &amp; Final Settlement Statement</div>
            </div>
            <div className="text-right text-xs text-slate-500">
              <div>Status: {settlement.status}</div>
              {settlement.paymentDate && <div>Paid: {settlement.paymentDate}</div>}
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <Field label="Employee" value={employee.name} />
            <Field label="Employee Code" value={employee.employeeCode} />
            <Field label="Designation" value={employee.designation} />
            <Field label="Date of Joining" value={employee.dateOfJoining} />
            <Field label="Last Working Day" value={settlement.lastWorkingDay} />
            <Field label="Separation Type" value={settlement.separationType} />
            <Field label="PAN" value={employee.panNumber} />
            <Field
              label="Bank A/c"
              value={employee.bankAccountNo ? `${employee.bankAccountNo}${employee.bankIfsc ? ` · ${employee.bankIfsc}` : ""}` : null}
            />
          </div>

          <table className="mb-3 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left text-slate-500">
                <th className="py-1">Additions</th>
                <th className="py-1 text-right">Amount (₹)</th>
                <th className="py-1 pl-4">Deductions</th>
                <th className="py-1 text-right">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: Math.max(additions.length, deductions.length, 1) }).map((_, i) => (
                <tr key={i}>
                  <td className="py-0.5">{additions[i]?.category ?? ""}</td>
                  <td className="py-0.5 text-right">{additions[i] ? additions[i].amount.toFixed(2) : ""}</td>
                  <td className="py-0.5 pl-4">{deductions[i]?.category ?? ""}</td>
                  <td className="py-0.5 text-right">{deductions[i] ? deductions[i].amount.toFixed(2) : ""}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-300 font-semibold">
                <td className="py-1">Total Additions</td>
                <td className="py-1 text-right">{additionsTotal.toFixed(2)}</td>
                <td className="py-1 pl-4">Total Deductions</td>
                <td className="py-1 text-right">{deductionsTotal.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          <div className="mb-4 flex items-center justify-between rounded-lg bg-green-50 px-3 py-2">
            <span className="text-sm font-semibold text-green-800">Net Settlement Amount</span>
            <span className="text-lg font-bold text-green-800">₹{netAmount.toFixed(2)}</span>
          </div>

          <p className="border-t border-slate-200 pt-2 text-[10px] text-slate-400">
            This is a computer-generated statement. Reference figures used while preparing this settlement (gratuity
            estimate, notice pay, leave encashment) are not independently verified against statutory filings — contact
            your CA/accountant before treating any estimate here as final. TDS (income tax) on this settlement is not
            computed here.
          </p>
        </div>
      </PrintArea>
    </div>
  );
}

function LineItemRowView({
  item,
  editable,
  pending,
  onDelete,
}: {
  item: LineItemRow;
  editable: boolean;
  pending: boolean;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 px-2.5 py-1.5 text-xs">
      <div>
        <span className="font-medium text-slate-700">{item.category}</span>
        {item.description && <span className="ml-1.5 text-slate-400">— {item.description}</span>}
      </div>
      <div className="flex items-center gap-2">
        <span className="font-semibold text-slate-800">₹{item.amount.toFixed(2)}</span>
        {editable && (
          <button type="button" disabled={pending} onClick={onDelete} className="text-red-500 hover:underline disabled:opacity-50">
            ✕
          </button>
        )}
      </div>
    </div>
  );
}

function RefTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-amber-200/70 bg-white px-2.5 py-2">
      <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-800">{value}</div>
      {sub && <div className="text-[10px] text-slate-400">{sub}</div>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <span className="text-slate-400">{label}: </span>
      <span className="font-medium">{value || "—"}</span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "Paid"
      ? "bg-green-50 text-green-700"
      : status === "Finalized"
        ? "bg-blue-50 text-blue-700"
        : "bg-amber-50 text-amber-700";
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{status}</span>;
}
