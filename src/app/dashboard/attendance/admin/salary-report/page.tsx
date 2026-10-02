// 2026-10-02 — TeamOffice's "Salary Report" menu entry: a month-based,
// per-employee salary summary table (attendance counts + gross +
// deductions + net + paid status) exportable via the shared ExportBar.
//
// It does NOT rebuild the payroll pipeline — every figure is derived by
// the exact same functions /dashboard/salary already uses (categorizeMonth
// → summarizeCategories → summarizeLeaveDetail → computeDeduction, plus
// computeCtcBreakdown's statutory preview when the salary row is in CTC
// mode), so this report can never disagree with the Payroll screen about
// the same month. Paying/marking-paid still happens on /dashboard/salary;
// this page is the read-only report view. Gated by salary_admin (same
// capability as the payroll screen), NOT attendance_admin.
import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST, daysInMonth } from "@/lib/attendance/ist-date";
import { categorizeMonth, summarizeCategories, summarizeLeaveDetail, computeDeduction } from "@/lib/attendance/payroll";
import { computeCtcBreakdown } from "@/lib/attendance/statutory";
import type { ReportColumnDef, ReportRow } from "@/lib/attendance/monthly-report";
import { ReportResults } from "../report-results";

const COLUMNS: ReportColumnDef[] = [
  { key: "employee", label: "Employee" },
  { key: "employee_code", label: "Code" },
  { key: "department", label: "Department" },
  { key: "company", label: "Company" },
  { key: "present", label: "Present" },
  { key: "late", label: "Late" },
  { key: "half_day", label: "Half Day" },
  { key: "leave", label: "Leave" },
  { key: "absent", label: "Absent" },
  { key: "week_off", label: "Week Off" },
  { key: "holiday", label: "Holiday" },
  { key: "gross", label: "Gross (₹)" },
  { key: "att_ded", label: "Att. Ded. (₹)" },
  { key: "pf", label: "PF (₹)" },
  { key: "esi", label: "ESI (₹)" },
  { key: "pt", label: "PT (₹)" },
  { key: "net_pay", label: "Net Pay (₹)" },
  { key: "paid_on", label: "Paid On" },
  { key: "net_paid", label: "Net Paid (₹)" },
];

export default async function SalaryReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const authed = await requireCapability("salary_admin");
  const supabase = await createClient();
  const finSupabase = createServiceRoleClient(); // salary_payments: same RLS-vs-service-role gotcha as the payroll screen
  const sp = await searchParams;

  const { data: companies } = await supabase.from("companies").select("id, name, weekly_off_days").in("id", authed.companyIds);
  const selectedCompanyId =
    typeof sp.company === "string" && authed.companyIds.includes(sp.company) ? sp.company : authed.currentCompanyId;
  const selectedCompany = (companies ?? []).find((c) => c.id === selectedCompanyId) ?? companies?.[0];

  const today = todayIST();
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const [year, monthNum] = month.split("-").map(Number);
  const monthStart = `${month}-01`;
  // `${month}-31` is invalid for 5 of 12 months and a .lte on it silently
  // errors (returns no rows) — same trap fixed on the payroll screen.
  const monthEnd = `${month}-${String(daysInMonth(year, monthNum)).padStart(2, "0")}`;

  const [
    { data: teamEmployees },
    { data: salaryRows },
    { data: attendanceRows },
    { data: holidays },
    { data: salaryPayments },
  ] = await Promise.all([
    supabase
      .from("employees")
      .select("id, name, employee_code, department, date_of_joining")
      .eq("company_id", selectedCompanyId)
      .eq("active", true)
      .order("name"),
    supabase
      .from("employee_salary")
      .select(
        "employee_id, monthly_salary, allowed_leaves_per_month, effective_from, ctc_annual, basic_percent_of_ctc, hra_percent_of_basic, employer_pf_percent, employee_pf_percent, pf_wage_ceiling, esi_applicable, esi_employee_percent, esi_employer_percent, professional_tax_amount"
      )
      .order("effective_from", { ascending: false }),
    supabase
      .from("attendance")
      .select("employee_id, attendance_date, status, leave_type_id, leave_unpaid")
      .eq("company_id", selectedCompanyId)
      .gte("attendance_date", monthStart)
      .lte("attendance_date", monthEnd),
    supabase
      .from("holidays")
      .select("holiday_date")
      .or(`company_id.eq.${selectedCompanyId},company_id.is.null`)
      .gte("holiday_date", monthStart)
      .lte("holiday_date", monthEnd),
    finSupabase
      .from("salary_payments")
      .select("employee_id, net_paid_amount, payment_date")
      .eq("company_id", selectedCompanyId)
      .eq("pay_month", monthStart),
  ]);

  // Latest salary row per employee with effective_from <= end of the month
  // — "which value was in effect back then", same lookup as the payroll
  // screen (rows already newest-first).
  const salaryAsOf = new Map<string, NonNullable<typeof salaryRows>[number]>();
  for (const row of salaryRows ?? []) {
    if (row.effective_from > monthEnd) continue;
    if (!salaryAsOf.has(row.employee_id)) salaryAsOf.set(row.employee_id, row);
  }

  const holidayDates = new Set((holidays ?? []).map((h) => h.holiday_date));
  const weeklyOffDays = (selectedCompany?.weekly_off_days as number[] | undefined) ?? [0];
  const rowsByEmployee = new Map<string, Map<string, { status: string | null; leave_type_id?: string | null; leave_unpaid?: boolean | null }>>();
  for (const r of attendanceRows ?? []) {
    if (!rowsByEmployee.has(r.employee_id)) rowsByEmployee.set(r.employee_id, new Map());
    rowsByEmployee.get(r.employee_id)!.set(r.attendance_date, { status: r.status, leave_type_id: r.leave_type_id, leave_unpaid: r.leave_unpaid });
  }

  const paidByEmployee = new Map(
    (salaryPayments ?? []).map((p) => [p.employee_id, { net: Number(p.net_paid_amount), date: p.payment_date }])
  );

  const companyName = selectedCompany?.name ?? "—";
  const daysThisMonth = daysInMonth(year, monthNum);

  const rows: ReportRow[] = (teamEmployees ?? []).map((e) => {
    const salary = salaryAsOf.get(e.id);
    const days = categorizeMonth({
      year,
      month: monthNum,
      weeklyOffDays,
      holidayDates,
      attendanceByDate: rowsByEmployee.get(e.id) ?? new Map(),
      todayStr: today,
      joinDate: e.date_of_joining,
    });
    const counts = summarizeCategories(days);
    const leaveDetail = summarizeLeaveDetail(days);
    const paid = paidByEmployee.get(e.id);

    let gross: number | null = null;
    let attDed: number | null = null;
    let pf: number | null = null;
    let esi: number | null = null;
    let pt: number | null = null;
    let netPay: number | null = null;
    if (salary) {
      const deduction = computeDeduction({
        monthlySalary: Number(salary.monthly_salary),
        allowedLeavesPerMonth: Number(salary.allowed_leaves_per_month),
        daysInThisMonth: daysThisMonth,
        counts,
        untypedLeaveDays: leaveDetail.untypedLeaveDays,
        unpaidTypedLeaveDays: leaveDetail.unpaidTypedLeaveDays,
      });
      gross = Number(salary.monthly_salary);
      attDed = deduction.deductionAmount;
      const statutory = salary.ctc_annual
        ? computeCtcBreakdown({
            ctcAnnual: Number(salary.ctc_annual),
            basicPercentOfCtc: Number(salary.basic_percent_of_ctc),
            hraPercentOfBasic: Number(salary.hra_percent_of_basic),
            employerPfPercent: Number(salary.employer_pf_percent),
            employeePfPercent: Number(salary.employee_pf_percent),
            pfWageCeiling: Number(salary.pf_wage_ceiling),
            esiApplicable: salary.esi_applicable,
            esiEmployeePercent: Number(salary.esi_employee_percent),
            esiEmployerPercent: Number(salary.esi_employer_percent),
            professionalTaxAmount: Number(salary.professional_tax_amount),
          })
        : null;
      pf = statutory?.employeePf ?? null;
      esi = statutory?.esiEmployee ?? null;
      pt = statutory?.professionalTax ?? null;
      // Same "Final Net" convention as the payroll screen's preview:
      // attendance net minus the employee-side statutory deductions.
      netPay = Math.max(0, deduction.netPay - (statutory?.totalEmployeeStatutoryDeductions ?? 0));
    }

    return {
      employee: e.name,
      employee_code: e.employee_code,
      department: e.department,
      company: companyName,
      present: counts.Present,
      late: counts.Late,
      half_day: counts["Half Day"],
      leave: counts.Leave,
      absent: counts.Absent,
      week_off: counts["Week Off"],
      holiday: counts.Holiday,
      gross,
      att_ded: attDed,
      pf,
      esi,
      pt,
      net_pay: netPay === null ? null : Math.round(netPay * 100) / 100,
      paid_on: paid?.date ?? "—",
      net_paid: paid ? paid.net : null,
    };
  });

  const title = `Salary Report — ${month} (${companyName})`;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">💰 Salary Report</h1>
          <p className="text-sm text-slate-500">
            Month-wise salary summary — attendance counts, gross, PF/ESI/PT, net pay aur paid status. Figures exactly match the
            Payroll screen ({month}, {daysThisMonth} days); paying salaries still happens there.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard/salary"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            💼 Payroll
          </Link>
          <Link
            href="/dashboard/attendance/admin"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Attendance Admin
          </Link>
        </div>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Company</label>
          <select name="company" defaultValue={selectedCompanyId} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Salary Month</label>
          <input type="month" name="month" defaultValue={month} className="rounded-lg border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <button
          type="submit"
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
        >
          ⬇️ Generate Report
        </button>
      </form>

      <ReportResults title={title} columns={COLUMNS} rows={rows} />
    </div>
  );
}
