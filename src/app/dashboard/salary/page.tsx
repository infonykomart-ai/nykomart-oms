import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST, daysInMonth } from "@/lib/attendance/ist-date";
import { categorizeMonth, summarizeCategories, computeDeduction } from "@/lib/attendance/payroll";
import { SalaryForm } from "./salary-form";
import { PayrollRow } from "./payroll-row";
import { AdvanceSection, type AdvanceRow } from "./advance-section";
import { FinanceLedger, type LedgerRow } from "./finance-ledger";

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
  // `${monthParam}-31` is an invalid Postgres date for 5 of 12 months (Apr/
  // Jun/Sep/Nov have 30 days, Feb has 28/29) — a .lte(..., that invalid
  // string) silently errors and Supabase returns no rows, so use the real
  // last day of the month instead (same fix mirrored in actions.ts and
  // attendance/admin/page.tsx).
  const monthEnd = `${monthParam}-${String(daysInMonth(year, month)).padStart(2, "0")}`;

  // 2026-08-12 (round 7): employee_advances / salary_payments /
  // bill_pass_register are all either brand-new this round or never had a
  // UI before — same RLS-vs-service-role gotcha bitten twice already this
  // project (tasks table, daily_work_logs table): reads default to the
  // service-role client here from day one rather than waiting to get bitten
  // a third time. Writes (in actions.ts) already use it, as always.
  const finSupabase = createServiceRoleClient();

  const [
    { data: teamEmployees },
    { data: salaryRows },
    { data: attendanceRows },
    { data: holidays },
    { data: companyProfile },
    { data: parties },
    { data: employeesForNames },
    { data: advanceRowsRaw },
    { data: salaryPaymentsThisMonth },
    { data: ledgerRowsRaw },
  ] = await Promise.all([
    supabase.from("employees").select("id, name, date_of_joining").eq("company_id", selectedCompanyId).eq("active", true).order("name"),
    supabase.from("employee_salary").select("employee_id, monthly_salary, allowed_leaves_per_month, effective_from").order("effective_from", { ascending: false }),
    supabase.from("attendance").select("employee_id, attendance_date, status").eq("company_id", selectedCompanyId).gte("attendance_date", monthStart).lte("attendance_date", monthEnd),
    supabase.from("holidays").select("holiday_date").or(`company_id.eq.${selectedCompanyId},company_id.is.null`).gte("holiday_date", monthStart).lte("holiday_date", monthEnd),
    supabase.from("company_profiles").select("bank_name, account_no").eq("company_id", selectedCompanyId).maybeSingle(),
    supabase.from("parties").select("id, name").order("name"),
    // Not filtered to active-only — an advance/payment/ledger row can
    // reference someone since deactivated, and should still show a real
    // name rather than "—".
    supabase.from("employees").select("id, name").eq("company_id", selectedCompanyId),
    finSupabase
      .from("employee_advances")
      .select("id, employee_id, amount, date_given, reason, recovered_amount, outstanding_amount, recovery_months, monthly_installment")
      .eq("company_id", selectedCompanyId)
      .order("date_given", { ascending: false }),
    finSupabase.from("salary_payments").select("employee_id, net_paid_amount, payment_date, advance_deduction_amount").eq("company_id", selectedCompanyId).eq("pay_month", monthStart),
    finSupabase
      .from("bill_pass_register")
      .select("id, invoice_type, invoice_no, invoice_date, party_id, employee_id, total_amt, credit_note_amt, to_be_pay, total_paid, balance_due, due_date, source, remark")
      .eq("company_id", selectedCompanyId)
      .order("created_at", { ascending: false })
      .limit(100),
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

  const employeeName = new Map((employeesForNames ?? []).map((e) => [e.id, e.name]));
  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name]));

  const paidByEmployee = new Map(
    (salaryPaymentsThisMonth ?? []).map((p) => [
      p.employee_id,
      { net_paid_amount: Number(p.net_paid_amount), payment_date: p.payment_date, advance_deduction_amount: Number(p.advance_deduction_amount) },
    ])
  );

  const advanceRows: AdvanceRow[] = (advanceRowsRaw ?? []).map((a) => ({
    id: a.id,
    employee_name: employeeName.get(a.employee_id) ?? "—",
    amount: Number(a.amount),
    date_given: a.date_given,
    reason: a.reason,
    recovered_amount: Number(a.recovered_amount),
    outstanding_amount: Number(a.outstanding_amount),
    recovery_months: a.recovery_months,
    monthly_installment: a.monthly_installment === null ? null : Number(a.monthly_installment),
  }));

  // Outstanding advance total PER EMPLOYEE — used for the company-wide
  // "Advance Outstanding" summary stat and the Employees/HR admin screen's
  // "Advance Due" badge (both are legitimately a SUM across all of that
  // employee's advances).
  const outstandingByEmployee = new Map<string, number>();
  // But submitSalaryPayment only ever recovers against the SINGLE oldest
  // still-outstanding advance (see actions.ts) — so PayrollRow's "Deduct
  // from Advance" field must offer/cap at THAT advance's own outstanding
  // amount, not the sum of every advance the employee has. Offering the
  // sum as the max let the form accept more than the server would ever
  // actually recover in one payment.
  const oldestOutstandingByEmployee = new Map<string, number>();
  // 2026-08-12 (round 9): "10 mahine me recover karna hai to har mahine
  // 1000 kate jaye" — the SAME oldest-outstanding advance's own
  // monthly_installment (when a recovery schedule was set on it), clamped
  // to what's actually still outstanding, fed into PayrollRow as the
  // pre-filled "Deduct from Advance" suggestion. null = no schedule on
  // that advance, field stays blank/manual exactly as before.
  const recommendedDeductionByEmployee = new Map<string, number | null>();
  const oldestDateSeenByEmployee = new Map<string, string>();
  for (const a of advanceRowsRaw ?? []) {
    const outstanding = Number(a.outstanding_amount);
    const prevSum = outstandingByEmployee.get(a.employee_id) ?? 0;
    outstandingByEmployee.set(a.employee_id, prevSum + outstanding);

    if (outstanding <= 0) continue;
    const prevOldestDate = oldestDateSeenByEmployee.get(a.employee_id);
    if (!prevOldestDate || a.date_given < prevOldestDate) {
      oldestDateSeenByEmployee.set(a.employee_id, a.date_given);
      oldestOutstandingByEmployee.set(a.employee_id, outstanding);
      const installment = a.monthly_installment === null ? null : Number(a.monthly_installment);
      recommendedDeductionByEmployee.set(a.employee_id, installment === null ? null : Math.min(installment, outstanding));
    }
  }

  const ledgerRows: LedgerRow[] = (ledgerRowsRaw ?? []).map((r) => ({
    id: r.id,
    invoice_type: r.invoice_type,
    invoice_no: r.invoice_no,
    invoice_date: r.invoice_date,
    who: (r.party_id ? partyName.get(r.party_id) : null) ?? (r.employee_id ? employeeName.get(r.employee_id) : null) ?? "—",
    total_amt: Number(r.total_amt),
    credit_note_amt: Number(r.credit_note_amt),
    to_be_pay: Number(r.to_be_pay),
    total_paid: Number(r.total_paid),
    balance_due: Number(r.balance_due),
    due_date: r.due_date,
    source: r.source,
    remark: r.remark,
  }));

  // "apne account me ki bhya is company me itne bande the unki is account
  // se sellery gyi" — per-company (the page is already scoped to one
  // company via the dropdown above) headcount + this month's total salary
  // paid + total outstanding advance, against that company's own bank
  // account on file (company_profiles — already existed, no new column
  // needed for this).
  const totalSalaryPaidThisMonth = (salaryPaymentsThisMonth ?? []).reduce((sum, p) => sum + Number(p.net_paid_amount), 0);
  const totalOutstandingAdvance = Array.from(outstandingByEmployee.values()).reduce((sum, v) => sum + v, 0);

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

      {/* 2026-08-12 (round 7): "apne account me ki bhya is company me itne
          bande the unki is account se sellery gyi" — this company's own
          bank account (company_profiles, already on file) + headcount +
          what's actually moved through it this month/overall. */}
      <div className="mb-6 grid grid-cols-2 gap-3 rounded-xl border border-slate-200 bg-white p-4 md:grid-cols-4">
        <SummaryStat label="Company Account" value={companyProfile?.bank_name ? `${companyProfile.bank_name} · ${companyProfile.account_no ?? "—"}` : "Not on file"} />
        <SummaryStat label="Active Employees" value={String((teamEmployees ?? []).length)} />
        <SummaryStat label={`Salary Paid — ${monthParam}`} value={`₹${totalSalaryPaidThisMonth.toFixed(2)}`} />
        <SummaryStat label="Advance Outstanding" value={`₹${totalOutstandingAdvance.toFixed(2)}`} />
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Set / Update Salary</h2>
        <SalaryForm employees={teamEmployees ?? []} today={today} />
      </div>

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4">
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
                <th className="px-2">Payment</th>
              </tr>
            </thead>
            <tbody>
              {payroll.map(({ employee: e, salary, summary, deduction }) => (
                <PayrollRow
                  key={e.id}
                  employeeId={e.id}
                  employeeName={e.name}
                  monthParam={monthParam}
                  today={today}
                  monthlySalary={salary ? Number(salary.monthly_salary) : null}
                  allowedLeaves={salary ? Number(salary.allowed_leaves_per_month) : null}
                  present={summary.Present + summary.Late}
                  leave={summary.Leave}
                  absent={summary.Absent}
                  deductedDays={deduction?.deductedDays ?? null}
                  deductionAmount={deduction?.deductionAmount ?? null}
                  netPay={deduction?.netPay ?? null}
                  hasSalarySet={!!(salary && deduction)}
                  alreadyPaid={paidByEmployee.get(e.id) ?? null}
                  outstandingAdvance={oldestOutstandingByEmployee.get(e.id) ?? 0}
                  recommendedAdvanceDeduction={recommendedDeductionByEmployee.get(e.id) ?? null}
                />
              ))}
              {payroll.length === 0 && (
                <tr><td colSpan={10} className="py-3 text-center text-slate-400">No active employees in this company.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Deduction = (Absent days + Half Days×0.5 + Leave days beyond the allowance) × (Monthly Salary ÷ days in month).
          Holidays and Week Offs never cost anything. This is a common Indian-payroll convention, not a verified copy of
          this company&apos;s written policy — tell me if the real rule is different and I&apos;ll change the formula.
          &quot;Pay Salary&quot; recomputes everything fresh from Attendance at the moment you click it — never from
          whatever this table happens to be showing.
        </p>
      </div>

      <div className="mb-6">
        <div className="mb-3">
          <h2 className="text-sm font-semibold text-slate-700">💸 Advances</h2>
          <p className="mt-1 text-xs text-slate-500">
            An advance given here shows up immediately in the Finance ledger below, and on the Employees (HR) screen
            for that person.
          </p>
        </div>
        <AdvanceSection employees={(teamEmployees ?? []).map((e) => ({ id: e.id, name: e.name }))} today={today} advances={advanceRows} />
      </div>

      <div className="mb-6">
        <FinanceLedger companyId={selectedCompanyId} parties={parties ?? []} rows={ledgerRows} />
      </div>
    </div>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}

const selectClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
