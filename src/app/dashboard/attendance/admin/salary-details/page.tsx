// 2026-10-02 — TeamOffice's "Salary Details" menu entry: the salary
// MASTER sheet — one row per employee of the selected company showing
// what their salary structure IS (monthly salary / CTC, allowance
// percentages, PF/ESI/PT config, allowed leaves, effective date), plus a
// live monthly PF/ESI/PT preview from the same computeCtcBreakdown()
// /dashboard/salary uses. Read-only: setting/updating a salary row stays
// on /dashboard/salary (Set / Update Salary card). Employees with no
// salary row yet still list, with "—" for the structure columns — that's
// exactly what makes this a master VIEW: "kiska salary set hai, kiska
// nahi" is visible at a glance. Gated salary_admin.
import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { todayIST, daysInMonth } from "@/lib/attendance/ist-date";
import { computeCtcBreakdown } from "@/lib/attendance/statutory";
import type { ReportColumnDef, ReportRow } from "@/lib/attendance/monthly-report";
import { ReportResults } from "../report-results";

const COLUMNS: ReportColumnDef[] = [
  { key: "employee", label: "Employee" },
  { key: "employee_code", label: "Code" },
  { key: "department", label: "Department" },
  { key: "designation", label: "Designation" },
  { key: "company", label: "Company" },
  { key: "date_of_joining", label: "Join Date" },
  { key: "monthly_salary", label: "Monthly Salary (₹)" },
  { key: "ctc_annual", label: "CTC / Year (₹)" },
  { key: "allowed_leaves", label: "Allowed Leave/Mo" },
  { key: "effective_from", label: "Effective From" },
  { key: "basic_pct", label: "Basic %" },
  { key: "hra_pct", label: "HRA %" },
  { key: "ee_pf_pct", label: "EE PF %" },
  { key: "pf_ceiling", label: "PF Ceiling (₹)" },
  { key: "esi", label: "ESI" },
  { key: "esi_ee_pct", label: "ESI EE %" },
  { key: "pt", label: "PT (₹/mo)" },
  { key: "preview_pf", label: "Preview EE PF (₹)" },
  { key: "preview_esi", label: "Preview ESI (₹)" },
  { key: "preview_net", label: "Preview Net bef. Att. (₹)" },
];

export default async function SalaryDetailsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const authed = await requireCapability("salary_admin");
  const supabase = await createClient();
  const sp = await searchParams;

  const { data: companies } = await supabase.from("companies").select("id, name").in("id", authed.companyIds).order("name");
  const companyId =
    typeof sp.company === "string" && authed.companyIds.includes(sp.company) ? sp.company : authed.currentCompanyId;
  const company = (companies ?? []).find((c) => c.id === companyId);

  const today = todayIST();
  const month = typeof sp.month === "string" && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const [year, monthNum] = month.split("-").map(Number);
  const monthEnd = `${month}-${String(daysInMonth(year, monthNum)).padStart(2, "0")}`;

  const [{ data: employees }, { data: departments }, { data: salaryRows }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, name, employee_code, department_id, designation, date_of_joining")
      .eq("company_id", companyId)
      .eq("active", true)
      .order("name"),
    supabase.from("departments").select("id, name").eq("company_id", companyId),
    // Same "which row was in effect at the end of this month" window the
    // payroll + salary report screens use.
    supabase
      .from("employee_salary")
      .select(
        "employee_id, monthly_salary, allowed_leaves_per_month, effective_from, ctc_annual, basic_percent_of_ctc, hra_percent_of_basic, employer_pf_percent, employee_pf_percent, pf_wage_ceiling, esi_applicable, esi_employee_percent, professional_tax_amount"
      )
      .lte("effective_from", monthEnd)
      .order("effective_from", { ascending: false }),
  ]);

  const salaryAsOf = new Map<string, NonNullable<typeof salaryRows>[number]>();
  for (const row of salaryRows ?? []) {
    if (!salaryAsOf.has(row.employee_id)) salaryAsOf.set(row.employee_id, row); // newest-first
  }
  const departmentName = new Map((departments ?? []).map((d) => [d.id, d.name]));

  const rows: ReportRow[] = (employees ?? []).map((e) => {
    const s = salaryAsOf.get(e.id);
    const statutory = s?.ctc_annual
      ? computeCtcBreakdown({
          ctcAnnual: Number(s.ctc_annual),
          basicPercentOfCtc: Number(s.basic_percent_of_ctc),
          hraPercentOfBasic: Number(s.hra_percent_of_basic),
          employerPfPercent: Number(s.employer_pf_percent),
          employeePfPercent: Number(s.employee_pf_percent),
          pfWageCeiling: Number(s.pf_wage_ceiling),
          esiApplicable: s.esi_applicable,
          esiEmployeePercent: Number(s.esi_employee_percent),
          esiEmployerPercent: 0, // employer ESI isn't shown on this sheet
          professionalTaxAmount: Number(s.professional_tax_amount),
        })
      : null;
    return {
      employee: e.name,
      employee_code: e.employee_code,
      department: (e.department_id && departmentName.get(e.department_id)) ?? null,
      designation: e.designation ?? "—",
      company: company?.name ?? "—",
      date_of_joining: e.date_of_joining ?? "—",
      monthly_salary: s ? Number(s.monthly_salary) : null,
      ctc_annual: s?.ctc_annual ? Number(s.ctc_annual) : null,
      allowed_leaves: s ? Number(s.allowed_leaves_per_month) : null,
      effective_from: s?.effective_from ?? null,
      basic_pct: s?.ctc_annual ? Number(s.basic_percent_of_ctc) : null,
      hra_pct: s?.ctc_annual ? Number(s.hra_percent_of_basic) : null,
      ee_pf_pct: s?.ctc_annual ? Number(s.employee_pf_percent) : null,
      pf_ceiling: s?.ctc_annual ? Number(s.pf_wage_ceiling) : null,
      esi: s ? (s.esi_applicable ? "Yes" : "No") : "—",
      esi_ee_pct: s?.esi_applicable ? Number(s.esi_employee_percent) : null,
      pt: s ? Number(s.professional_tax_amount) : null,
      preview_pf: statutory?.employeePf ?? null,
      preview_esi: statutory?.esiEmployee ?? null,
      preview_net: statutory?.estimatedNetBeforeAttendance ?? null,
    };
  });

  const title = `Salary Details — ${month} (${company?.name ?? "—"})`;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">🧾 Salary Details</h1>
          <p className="text-sm text-slate-500">
            Salary master sheet — har employee ki structure (monthly/CTC, PF/ESI/PT %, allowed leaves) + live statutory preview.
            Structure set/update karne ke liye Payroll screen use karo.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/dashboard/salary"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            💼 Set / Update Salary
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
          <select name="company" defaultValue={companyId} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">As of Month</label>
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
