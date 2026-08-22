import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST, daysInMonth } from "@/lib/attendance/ist-date";
import { categorizeMonth, summarizeCategories, computeDeduction } from "@/lib/attendance/payroll";
import { SalaryReportTable, type SalaryReportRow } from "./salary-report-table";

// Salary / Attendance report (2026-08-22) — one of the 3 new report pages
// requested after "Reports hub — remaining scope".
//
// Grain chosen: one row per ACTIVE employee for the selected company +
// month — same as the interactive Payroll table on /dashboard/salary.
// This is deliberately an exportable REPORT wrapper around that page's
// existing computation, not a second attendance-day-by-day report: the
// existing Payroll table already answers "what does each employee's
// month look like" (present/leave/absent counts + deduction + net pay),
// and the salary_payments lookup below adds whether it was actually paid
// yet. A separate day-by-day Attendance export wasn't requested and would
// duplicate /dashboard/attendance/admin's own view — flagged here rather
// than silently built, in case that's wanted as a follow-up.
//
// Uses this app's `reports` capability (same as every other report on
// this hub) rather than /dashboard/salary's own `salary_admin` capability
// — deliberate: this is a read-only export, not a payroll-admin screen,
// so the RBAC boundary should match what other reports (financially
// sensitive too — Outstanding, Purchase Bill) already use.
export default async function SalaryReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("reports");
  const supabase = await createClient();
  const finSupabase = createServiceRoleClient();
  const sp = await searchParams;

  const { data: companies } = await supabase.from("companies").select("id, name, weekly_off_days").in("id", employee.companyIds).order("name");
  const companyId = (typeof sp.company === "string" && employee.companyIds.includes(sp.company)) ? sp.company : employee.currentCompanyId;
  const selectedCompany = (companies ?? []).find((c) => c.id === companyId) ?? companies?.[0];

  const today = todayIST();
  const monthParam = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const [year, month] = monthParam.split("-").map(Number);
  const monthStart = `${monthParam}-01`;
  const monthEnd = `${monthParam}-${String(daysInMonth(year, month)).padStart(2, "0")}`;

  const [
    { data: teamEmployees },
    { data: salaryRows },
    { data: attendanceRows },
    { data: holidays },
    { data: salaryPaymentsThisMonth },
  ] = await Promise.all([
    supabase.from("employees").select("id, name, date_of_joining").eq("company_id", companyId).eq("active", true).order("name"),
    supabase.from("employee_salary").select("employee_id, monthly_salary, allowed_leaves_per_month, effective_from").order("effective_from", { ascending: false }),
    supabase.from("attendance").select("employee_id, attendance_date, status").eq("company_id", companyId).gte("attendance_date", monthStart).lte("attendance_date", monthEnd),
    supabase.from("holidays").select("holiday_date").or(`company_id.eq.${companyId},company_id.is.null`).gte("holiday_date", monthStart).lte("holiday_date", monthEnd),
    finSupabase.from("salary_payments").select("employee_id, net_paid_amount, payment_date").eq("company_id", companyId).eq("pay_month", monthStart),
  ]);

  const salaryAsOf = new Map<string, { monthly_salary: number; allowed_leaves_per_month: number }>();
  for (const row of salaryRows ?? []) {
    if (row.effective_from > monthEnd) continue;
    if (!salaryAsOf.has(row.employee_id)) salaryAsOf.set(row.employee_id, row);
  }

  const holidayDates = new Set((holidays ?? []).map((h) => h.holiday_date));
  const weeklyOffDays = (selectedCompany?.weekly_off_days as number[] | undefined) ?? [0];
  const rowsByEmployee = new Map<string, Map<string, { status: string | null }>>();
  for (const r of attendanceRows ?? []) {
    if (!rowsByEmployee.has(r.employee_id)) rowsByEmployee.set(r.employee_id, new Map());
    rowsByEmployee.get(r.employee_id)!.set(r.attendance_date, { status: r.status });
  }
  const daysThisMonth = daysInMonth(year, month);
  const paidByEmployee = new Map((salaryPaymentsThisMonth ?? []).map((p) => [p.employee_id, { net_paid_amount: Number(p.net_paid_amount), payment_date: p.payment_date }]));

  const rows: SalaryReportRow[] = (teamEmployees ?? []).map((e) => {
    const salary = salaryAsOf.get(e.id);
    const days = categorizeMonth({
      year,
      month,
      weeklyOffDays,
      holidayDates,
      attendanceByDate: rowsByEmployee.get(e.id) ?? new Map(),
      todayStr: today,
      joinDate: e.date_of_joining,
    });
    const summary = summarizeCategories(days);
    const deduction = salary
      ? computeDeduction({
          monthlySalary: Number(salary.monthly_salary),
          allowedLeavesPerMonth: Number(salary.allowed_leaves_per_month),
          daysInThisMonth: daysThisMonth,
          counts: summary,
        })
      : null;
    const paid = paidByEmployee.get(e.id);
    return {
      id: e.id,
      employee_name: e.name,
      monthly_salary: salary ? Number(salary.monthly_salary) : null,
      allowed_leaves: salary ? Number(salary.allowed_leaves_per_month) : null,
      present: summary.Present + summary.Late,
      half_day: summary["Half Day"],
      leave: summary.Leave,
      absent: summary.Absent,
      deducted_days: deduction?.deductedDays ?? null,
      deduction_amount: deduction?.deductionAmount ?? null,
      net_pay: deduction?.netPay ?? null,
      paid: !!paid,
      paid_amount: paid?.net_paid_amount ?? null,
      payment_date: paid?.payment_date ?? null,
    };
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">🧑‍💼 Salary / Attendance Report</h1>
          <p className="mt-1 text-sm text-slate-500">
            Monthly payroll summary per employee — apply filters, then download or send.
          </p>
        </div>
        <Link href="/dashboard/reports" className="shrink-0 text-sm text-slate-500 hover:underline">
          ← Back to Reports
        </Link>
      </div>

      <SalaryReportTable rows={rows} companies={companies ?? []} filters={{ companyId, month: monthParam }} />
    </div>
  );
}
