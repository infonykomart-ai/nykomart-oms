"use client";

import { ExportBar } from "@/components/export-bar";
import { PrintArea } from "@/components/print-view";
import type { ExportColumn } from "@/lib/export/export-table";
import { useColumnVisibility } from "@/lib/export/use-column-visibility";

// Salary / Attendance report (2026-08-22) — one of the 3 new report
// pages. See page.tsx's header comment: an exportable version of the
// interactive Payroll table already at /dashboard/salary, reusing the
// exact same categorizeMonth/summarizeCategories/computeDeduction
// computation (src/lib/attendance/payroll.ts) rather than inventing a
// second formula.
export type SalaryReportRow = {
  id: string;
  employee_name: string;
  monthly_salary: number | null;
  allowed_leaves: number | null;
  present: number;
  half_day: number;
  leave: number;
  absent: number;
  deducted_days: number | null;
  deduction_amount: number | null;
  net_pay: number | null;
  paid: boolean;
  paid_amount: number | null;
  payment_date: string | null;
};

const COLUMNS: ExportColumn<SalaryReportRow>[] = [
  { key: "employee_name", label: "Employee", value: (r) => r.employee_name },
  { key: "monthly_salary", label: "Monthly Salary", value: (r) => r.monthly_salary },
  { key: "allowed_leaves", label: "Allowed Leave", value: (r) => r.allowed_leaves },
  { key: "present", label: "Present/Late", value: (r) => r.present },
  { key: "half_day", label: "Half Day", value: (r) => r.half_day },
  { key: "leave", label: "Leave", value: (r) => r.leave },
  { key: "absent", label: "Absent", value: (r) => r.absent },
  { key: "deducted_days", label: "Deducted Days", value: (r) => r.deducted_days },
  { key: "deduction_amount", label: "Deduction", value: (r) => r.deduction_amount },
  { key: "net_pay", label: "Net Pay", value: (r) => r.net_pay },
  { key: "paid", label: "Paid?", value: (r) => (r.paid ? "Yes" : "No") },
  { key: "paid_amount", label: "Paid Amount", value: (r) => r.paid_amount },
  { key: "payment_date", label: "Payment Date", value: (r) => r.payment_date },
];

export function SalaryReportTable({
  rows,
  companies,
  filters,
}: {
  rows: SalaryReportRow[];
  companies: { id: string; name: string }[];
  filters: { companyId: string; month: string };
}) {
  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  const { visibleColumns, hiddenKeys, toggleColumn } = useColumnVisibility(COLUMNS);

  const totalNetPay = rows.reduce((s, r) => s + (r.net_pay ?? 0), 0);
  const totalPaid = rows.filter((r) => r.paid).length;

  return (
    <div className="space-y-4">
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 print:hidden">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="company">Company</label>
          <select id="company" name="company" defaultValue={filters.companyId} className={inputClass}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="month">Month</label>
          <input id="month" name="month" type="month" defaultValue={filters.month} className={inputClass} />
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600">
          Filter
        </button>
      </form>

      <div className="flex items-center justify-between print:hidden">
        <p className="text-sm text-slate-500">
          {rows.length} employee(s) · {totalPaid} paid this month · Total Net Pay:{" "}
          <span className="font-semibold text-slate-800">₹{totalNetPay.toFixed(2)}</span>
        </p>
        <ExportBar
          title="Salary / Attendance Report"
          filenameBase="salary-attendance-report"
          columns={visibleColumns}
          rows={rows}
          printAreaId="salary-report-print-area"
          allColumns={COLUMNS}
          hiddenKeys={hiddenKeys}
          onToggleColumn={toggleColumn}
        />
      </div>

      <p className="text-xs text-slate-400 print:hidden">
        Deduction = (Absent days + Half Days×0.5 + Leave days beyond the allowance) × (Monthly Salary ÷ days in
        month) — same formula as the interactive Salary &amp; Payroll page. A common Indian-payroll convention, not a
        verified copy of this company&apos;s written policy.
      </p>

      <PrintArea id="salary-report-print-area">
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {visibleColumns.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                {visibleColumns.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-3 py-2 text-slate-700">{String(c.value(r) ?? "")}</td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-slate-400">No active employees found for this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </PrintArea>
    </div>
  );
}
