import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { SalaryStructureEditor, type CurrentSalary, type StructureEmployee } from "./salary-structure-editor";

// 2026-10-19 — "sallery set karne ka stracture sahi nahi hai isko alag se
// bano sahi se". The salary DECISION (what someone is paid, from when, flat
// or CTC) now lives on its own page instead of being a cramped strip on the
// Salary & Payroll page — the payroll page keeps the month's numbers, this
// page keeps the structure behind them.
//
// Same auth (salary_admin), same company scoping (employee.companyIds) and
// same server action (setEmployeeSalary, see ../actions.ts) as before, so
// nothing about how payroll is calculated changed — only where the
// structure is entered and how it is laid out.
export default async function SalaryStructurePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("salary_admin");
  const supabase = await createClient();
  const sp = await searchParams;

  const { data: companies } = await supabase
    .from("companies")
    .select("id, name")
    .in("id", employee.companyIds)
    .order("name");
  const selectedCompanyId =
    typeof sp.company === "string" && employee.companyIds.includes(sp.company)
      ? sp.company
      : employee.currentCompanyId;
  const highlightEmployeeId = typeof sp.employee === "string" ? sp.employee : null;

  const [{ data: teamEmployees }, { data: salaryRows }] = await Promise.all([
    supabase
      .from("employees")
      .select("id, name, employee_code")
      .eq("company_id", selectedCompanyId)
      .eq("active", true)
      .order("name"),
    supabase
      .from("employee_salary")
      .select(
        "id, employee_id, monthly_salary, allowed_leaves_per_month, effective_from, ctc_annual, basic_percent_of_ctc, hra_percent_of_basic, employer_pf_percent, employee_pf_percent, pf_wage_ceiling, esi_applicable, esi_employee_percent, esi_employer_percent, professional_tax_amount"
      )
      .order("effective_from", { ascending: false }),
  ]);

  // Rows arrive newest-first across all months, so the first row seen per
  // employee IS their latest decided structure — the same rule the Salary
  // page's prefill uses (see ../page.tsx).
  const latest = new Map<string, NonNullable<typeof salaryRows>[number]>();
  const versions = new Map<string, number>();
  for (const row of salaryRows ?? []) {
    versions.set(row.employee_id, (versions.get(row.employee_id) ?? 0) + 1);
    if (!latest.has(row.employee_id)) latest.set(row.employee_id, row);
  }

  const rows: StructureEmployee[] = (teamEmployees ?? []).map((e) => {
    const row = latest.get(e.id);
    const current: CurrentSalary | null = row
      ? {
          monthly_salary: Number(row.monthly_salary),
          allowed_leaves_per_month: Number(row.allowed_leaves_per_month),
          effective_from: row.effective_from,
          ctc_annual: row.ctc_annual === null ? null : Number(row.ctc_annual),
          basic_percent_of_ctc: Number(row.basic_percent_of_ctc),
          hra_percent_of_basic: Number(row.hra_percent_of_basic),
          employer_pf_percent: Number(row.employer_pf_percent),
          employee_pf_percent: Number(row.employee_pf_percent),
          pf_wage_ceiling: Number(row.pf_wage_ceiling),
          esi_applicable: row.esi_applicable,
          esi_employee_percent: Number(row.esi_employee_percent),
          esi_employer_percent: Number(row.esi_employer_percent),
          professional_tax_amount: Number(row.professional_tax_amount),
        }
      : null;
    return { id: e.id, name: e.name, employee_code: e.employee_code, current, versions: versions.get(e.id) ?? 0 };
  });

  const decided = rows.filter((r) => r.current).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">🧾 Salary Structure</h1>
          <p className="mt-1 text-sm text-slate-500">
            What each employee is paid, from when, and how it splits into Basic / HRA / PF / ESI / Professional Tax.
            The monthly payroll itself — attendance, deductions, payslips — stays on the Salary &amp; Payroll page.
          </p>
        </div>
        <Link
          href={`/dashboard/salary?company=${selectedCompanyId}`}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Salary &amp; Payroll
        </Link>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Company</label>
          <select name="company" defaultValue={selectedCompanyId} className={selectClass}>
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">
          View
        </button>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-medium text-slate-600">
          {decided} of {rows.length} employees have a structure decided
        </span>
      </form>

      <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-900">
        <strong>How a change works:</strong> saving with a NEW &ldquo;Effective From&rdquo; date adds a version — earlier
        months keep the salary they were actually paid on. Saving with an EXISTING date corrects that version in place
        (for a typo or a wrong figure). Individual versions can be edited or deleted from the Salary History table on the
        Salary &amp; Payroll page.
      </div>

      <SalaryStructureEditor employees={rows} today={todayIST()} selectedEmployeeId={highlightEmployeeId} />
    </div>
  );
}

const selectClass =
  "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
