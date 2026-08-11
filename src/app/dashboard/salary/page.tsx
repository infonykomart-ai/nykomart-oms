import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { todayIST, daysInMonth } from "@/lib/attendance/ist-date";
import { categorizeMonth, summarizeCategories, computeDeduction } from "@/lib/attendance/payroll";
import { SalaryForm } from "./salary-form";

// 2026-08-11: "SELLERY STRACTURE" — monthly fixed salary per employee, with
// absent-day deduction beyond their allowed paid leaves (see
// src/lib/attendance/payroll.ts for the exact, clearly-documented
// convention this uses — it's a standard/common one, not a verified copy
// of this company's actual written policy). Salary is versioned by
// effective_from (see setEmployeeSalary) so a raise never rewrites past
// months' payroll numbers.
export default async function SalaryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("salary_admin");
  const supabase = await createClient();
  const sp = await searchParams;

  const { data: companies } = await supabase.from("companies").select("id, name, weekly_off_days").in("id", employee.companyIds);
  const selectedCompanyId = (typeof sp.company === "string" && employee.companyIds.includes(sp.company)) ? sp.company : employee.currentCompanyId;
  const selectedCompany = (companies ?? []).find((c) => c.id === selectedCompanyId) ?? companies?.[0];

  const today = todayIST();
  const monthParam = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const [year, month] = monthParam.split("-").map(Number);
  const monthStart = `${monthParam}-01`;
  const monthEnd = `${monthParam}-31`;

  const [{ data: teamEmployees }, { data: salaryRows }, { data: attendanceRows }, { data: holidays }] = await Promise.all([
    supabase.from("employees").select("id, name, date_of_joining").eq("company_id", selectedCompanyId).eq("active", true).order("name"),
    supabase.from("employee_salary").select("employee_id, monthly_salary, allowed_leaves_per_month, effective_from").order("effective_from", { ascending: false }),
    supabase.from("attendance").select("employee_id, attendance_date, status").eq("company_id", selectedCompanyId).gte("attendance_date", monthStart).lte("attendance_date", monthEnd),
    supabase.from("holidays").select("holiday_date").or(`company_id.eq.${selectedCompanyId},company_id.is.null`).gte("holiday_date", monthStart).lte("holiday_date", monthEnd),
  ]);

  // Latest salary row per employee with effective_from <= end of the
  // selected month — same "which value was in effect back then" lookup
  // computeDeduction's caller needs to do, described in the migration's
  // own comment on employee_salary.
  const salaryAsOf = new Map<string, { monthly_salary: number; allowed_leaves_per_month: number }>();
  for (const row of salaryRows ?? []) {
    if (row.effective_from > monthEnd) continue;
    if (!salaryAsOf.has(row.employee_id)) salaryAsOf.set(row.employee_id, row); // rows are already newest-first
  }

  const holidayDates = new Set((holidays ?? []).map((h) => h.holiday_date));
  const weeklyOffDays = (selectedCompany?.weekly_off_days as number[] | undefined) ?? [0];
  const rowsByEmployee = new Map<string, Map<string, { status: string | null }>>();
  for (const r of attendanceRows ?? []) {
    if (!rowsByEmployee.has(r.employee_id)) rowsByEmployee.set(r.employee_id, new Map());
    rowsByEmployee.get(r.employee_id)!.set(r.attendance_date, { status: r.status });
  }
  const daysThisMonth = daysInMonth(year, month);

  const payroll = (teamEmployees ?? []).map((e) => {
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
    if (!salary) return { employee: e, salary: null, summary, deduction: null };
    const deduction = computeDeduction({
      monthlySalary: Number(salary.monthly_salary),
      allowedLeavesPerMonth: Number(salary.allowed_leaves_per_month),
      daysInThisMonth: daysThisMonth,
      counts: summary,
    });
    return { employee: e, salary, summary, deduction };
  });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">💰 Salary &amp; Payroll</h1>
        <p className="mt-1 text-sm text-slate-500">
          Monthly fixed salary, absent-day deduction beyond allowed paid leaves. See the note below for the exact formula.
        </p>
      </div>

      <form method="get" className="mb-6 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Company</label>
          <select name="company" defaultValue={selectedCompanyId} className={selectClass}>
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Payroll Month</label>
          <input type="month" name="month" defaultValue={monthParam} className={selectClass} />
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">
          View
        </button>
      </form>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Set / Update Salary</h2>
        <SalaryForm employees={teamEmployees ?? []} today={today} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Payroll — {monthParam} ({daysThisMonth} days)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="text-slate-400">
                <th className="py-1 pr-3">Employee</th>
                <th className="px-2">Monthly Salary</th>
                <th className="px-2">Allowed Leave</th>
                <th className="px-2">Present/Late</th>
                <th className="px-2">Leave</th>
                <th className="px-2">Absent</th>
                <th className="px-2">Deducted Days</th>
                <th className="px-2">Deduction</th>
                <th className="px-2">Net Pay</th>
              </tr>
            </thead>
            <tbody>
              {payroll.map(({ employee: e, salary, summary, deduction }) => (
                <tr key={e.id} className="border-t border-slate-100">
                  <td className="py-1.5 pr-3 font-medium text-slate-800">{e.name}</td>
                  {salary && deduction ? (
                    <>
                      <td className="px-2">{Number(salary.monthly_salary).toFixed(2)}</td>
                      <td className="px-2">{salary.allowed_leaves_per_month}</td>
                      <td className="px-2">{summary.Present + summary.Late}</td>
                      <td className="px-2 text-sky-700">{summary.Leave}</td>
                      <td className="px-2 text-red-700">{summary.Absent}</td>
                      <td className="px-2">{deduction.deductedDays}</td>
                      <td className="px-2 text-red-700">{deduction.deductionAmount.toFixed(2)}</td>
                      <td className="px-2 font-semibold text-green-700">{deduction.netPay.toFixed(2)}</td>
                    </>
                  ) : (
                    <td colSpan={7} className="px-2 text-slate-400">No salary set yet for this employee.</td>
                  )}
                </tr>
              ))}
              {payroll.length === 0 && (
                <tr><td colSpan={9} className="py-3 text-center text-slate-400">No active employees in this company.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Deduction = (Absent days + Half Days×0.5 + Leave days beyond the allowance) × (Monthly Salary ÷ days in month).
          Holidays and Week Offs never cost anything. This is a common Indian-payroll convention, not a verified copy of
          this company&apos;s written policy — tell me if the real rule is different and I&apos;ll change the formula.
        </p>
      </div>
    </div>
  );
}

const selectClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
