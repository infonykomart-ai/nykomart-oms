"use client";

import { PrintArea, PrintButton } from "@/components/print-view";

type PayslipEmployee = {
  name: string;
  designation: string | null;
  employeeCode: string | null;
  dateOfJoining: string | null;
  panNumber: string | null;
  uanNumber: string | null;
  pfNumber: string | null;
  esiNumber: string | null;
  bankAccountHolderName: string | null;
  bankAccountNo: string | null;
  bankIfsc: string | null;
  bankName: string | null;
};

type PayslipCompany = {
  name: string;
  logoUrl: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
};

type PayslipPayment = {
  grossSalary: number;
  basicAmount: number | null;
  hraAmount: number | null;
  specialAllowanceAmount: number | null;
  attendanceDeductionAmount: number;
  advanceDeductionAmount: number;
  employeePfAmount: number;
  employerPfAmount: number;
  employeeEsiAmount: number;
  employerEsiAmount: number;
  professionalTaxAmount: number;
  netPaidAmount: number;
  paymentDate: string;
  remark: string | null;
};

// 2026-09-11 (Payroll Phase 1) — first real payslip in this app. Same
// window.print()-via-PrintArea pattern as every other "PDF download" in
// the codebase (see src/components/print-view.tsx's own header comment on
// why — no separate PDF library needed). Shows a component breakdown
// (Basic/HRA/Special Allowance) only when the payment came from a CTC-mode
// salary row; a flat-salary payment shows one plain "Gross Salary" line
// instead — matches exactly what was actually stored, nothing re-derived.
export function PayslipView({
  payMonth,
  employee,
  company,
  payment,
}: {
  payMonth: string;
  employee: PayslipEmployee;
  company: PayslipCompany;
  payment: PayslipPayment;
}) {
  const hasBreakdown = payment.basicAmount !== null;
  const totalEmployeeDeductions =
    payment.attendanceDeductionAmount + payment.advanceDeductionAmount + payment.employeePfAmount + payment.employeeEsiAmount + payment.professionalTaxAmount;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <h1 className="text-xl font-semibold text-slate-900">🧾 Payslip — {employee.name} — {payMonth}</h1>
        <PrintButton label="🖨 Download PDF" />
      </div>

      <PrintArea id="payslip-print-area">
        <div className="mx-auto max-w-2xl rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-800">
          <div className="mb-4 flex items-start justify-between border-b border-slate-200 pb-3">
            <div className="flex items-center gap-3">
              {company.logoUrl && <img src={company.logoUrl} alt="" className="h-10 w-10 rounded object-contain" />}
              <div>
                <div className="text-base font-bold">{company.name}</div>
                {company.address && <div className="text-xs text-slate-500">{company.address}</div>}
                <div className="text-xs text-slate-500">
                  {[company.phone, company.email].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-semibold">Payslip</div>
              <div className="text-xs text-slate-500">For the month of {payMonth}</div>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <Field label="Employee Name" value={employee.name} />
            <Field label="Employee Code" value={employee.employeeCode} />
            <Field label="Designation" value={employee.designation} />
            <Field label="Date of Joining" value={employee.dateOfJoining} />
            <Field label="PAN" value={employee.panNumber} />
            <Field label="UAN (PF)" value={employee.uanNumber} />
            <Field label="PF Account No." value={employee.pfNumber} />
            <Field label="ESI No." value={employee.esiNumber} />
            <Field
              label="Bank A/c"
              value={employee.bankAccountNo ? `${employee.bankAccountNo}${employee.bankIfsc ? ` · ${employee.bankIfsc}` : ""}` : null}
            />
            <Field label="A/c Holder" value={employee.bankAccountHolderName} />
          </div>

          <table className="mb-3 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-300 text-left text-slate-500">
                <th className="py-1">Earnings</th>
                <th className="py-1 text-right">Amount (₹)</th>
                <th className="py-1 pl-4">Deductions</th>
                <th className="py-1 text-right">Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              {hasBreakdown ? (
                <>
                  <Row l="Basic" lv={payment.basicAmount} r="Attendance (LOP)" rv={payment.attendanceDeductionAmount} />
                  <Row l="HRA" lv={payment.hraAmount} r="Employee PF" rv={payment.employeePfAmount} />
                  <Row l="Special Allowance" lv={payment.specialAllowanceAmount} r="Employee ESI" rv={payment.employeeEsiAmount} />
                  <Row l="" lv={null} r="Professional Tax" rv={payment.professionalTaxAmount} />
                  <Row l="" lv={null} r="Advance Recovered" rv={payment.advanceDeductionAmount} />
                </>
              ) : (
                <>
                  <Row l="Gross Salary" lv={payment.grossSalary} r="Attendance (LOP)" rv={payment.attendanceDeductionAmount} />
                  <Row l="" lv={null} r="Advance Recovered" rv={payment.advanceDeductionAmount} />
                </>
              )}
              <tr className="border-t border-slate-300 font-semibold">
                <td className="py-1">Gross Earnings</td>
                <td className="py-1 text-right">{payment.grossSalary.toFixed(2)}</td>
                <td className="py-1 pl-4">Total Deductions</td>
                <td className="py-1 text-right">{totalEmployeeDeductions.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          <div className="mb-4 flex items-center justify-between rounded-lg bg-green-50 px-3 py-2">
            <span className="text-sm font-semibold text-green-800">Net Pay</span>
            <span className="text-lg font-bold text-green-800">₹{payment.netPaidAmount.toFixed(2)}</span>
          </div>
          <div className="mb-4 text-xs text-slate-500">
            Paid on {payment.paymentDate}{payment.remark ? ` — ${payment.remark}` : ""}
          </div>

          {(payment.employerPfAmount > 0 || payment.employerEsiAmount > 0) && (
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-500">
              Employer Contributions (cost to company, not deducted from your pay): Employer PF ₹{payment.employerPfAmount.toFixed(2)}
              {payment.employerEsiAmount > 0 && ` · Employer ESI ₹${payment.employerEsiAmount.toFixed(2)}`}
            </div>
          )}

          <p className="border-t border-slate-200 pt-2 text-[10px] text-slate-400">
            This is a computer-generated payslip. Statutory (PF/ESI/Professional Tax) figures use rates entered at the
            time of payment and are not independently verified against this company&apos;s statutory filings — contact
            HR/Accounts for any discrepancy. TDS (income tax) is not shown here.
          </p>
        </div>
      </PrintArea>
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

function Row({ l, lv, r, rv }: { l: string; lv: number | null; r: string; rv: number }) {
  if (!l && rv === 0) return null;
  return (
    <tr>
      <td className="py-0.5">{l}</td>
      <td className="py-0.5 text-right">{lv !== null ? lv.toFixed(2) : ""}</td>
      <td className="py-0.5 pl-4">{r}</td>
      <td className="py-0.5 text-right">{rv > 0 ? rv.toFixed(2) : "—"}</td>
    </tr>
  );
}
