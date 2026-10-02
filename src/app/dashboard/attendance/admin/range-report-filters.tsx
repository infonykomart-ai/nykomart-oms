"use client";

// 2026-10-01 — filter panel for the Daily / Periodic / Yearly report
// pages, modeled on the same TeamOffice screenshot family as the Monthly
// one (date control / report-type list / All-or-Few Company / All-or-Few
// Employee / Generate). Query-string driven (GET navigation), same
// convention as monthly-report-filters — the server page re-reads
// searchParams and recomputes; no client data-fetch anywhere.
import { useRouter } from "next/navigation";
import { useState } from "react";

type Company = { id: string; name: string };
type EmployeeOpt = { id: string; name: string; company_id: string };

export function RangeReportFilters({
  basePath,
  mode,
  date,
  from,
  to,
  reportKey,
  reportTypes,
  companies,
  employees,
  departments,
  department,
  companyScope,
  selectedCompanyIds,
  employeeScope,
  selectedEmployeeIds,
}: {
  basePath: string;
  mode: "date" | "range";
  date: string;
  from: string;
  to: string;
  reportKey: string;
  reportTypes: { key: string; label: string }[];
  companies: Company[];
  employees: EmployeeOpt[];
  /** Distinct employees.department values (2026-10-02 TeamOffice parity). */
  departments: string[];
  department: string;
  companyScope: "all" | "few";
  selectedCompanyIds: string[];
  employeeScope: "all" | "few";
  selectedEmployeeIds: string[];
}) {
  const router = useRouter();
  const [localDate, setLocalDate] = useState(date);
  const [localFrom, setLocalFrom] = useState(from);
  const [localTo, setLocalTo] = useState(to);
  const [localReport, setLocalReport] = useState(reportKey);
  const [localDepartment, setLocalDepartment] = useState(department);
  const [localCompanyScope, setLocalCompanyScope] = useState(companyScope);
  const [localCompanyIds, setLocalCompanyIds] = useState<Set<string>>(new Set(selectedCompanyIds));
  const [localEmployeeScope, setLocalEmployeeScope] = useState(employeeScope);
  const [localEmployeeIds, setLocalEmployeeIds] = useState<Set<string>>(new Set(selectedEmployeeIds));

  function toggle(set: Set<string>, id: string, setter: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  }

  function submit() {
    const params = new URLSearchParams();
    if (mode === "date") {
      params.set("date", localDate);
    } else {
      params.set("from", localFrom);
      params.set("to", localTo);
    }
    params.set("report", localReport);
    if (localDepartment) params.set("department", localDepartment);
    params.set("companyScope", localCompanyScope);
    if (localCompanyScope === "few") params.set("companyIds", Array.from(localCompanyIds).join(","));
    params.set("employeeScope", localEmployeeScope);
    if (localEmployeeScope === "few") params.set("employeeIds", Array.from(localEmployeeIds).join(","));
    router.push(`${basePath}?${params.toString()}`);
  }

  const visibleEmployees =
    localCompanyScope === "all" || localCompanyIds.size === 0
      ? employees
      : employees.filter((e) => localCompanyIds.has(e.company_id));

  const inputClass = "rounded-lg border border-slate-300 px-3 py-2 text-sm";

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_auto]">
        {mode === "date" ? (
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Select Punch Date</label>
            <input type="date" value={localDate} onChange={(e) => setLocalDate(e.target.value)} className={inputClass} />
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">From</label>
              <input type="date" value={localFrom} onChange={(e) => setLocalFrom(e.target.value)} className={inputClass} />
            </div>
            <span className="pb-2 text-xs font-semibold text-slate-400">To</span>
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600">&nbsp;</label>
              <input type="date" value={localTo} onChange={(e) => setLocalTo(e.target.value)} className={inputClass} />
            </div>
          </div>
        )}
      </div>

      {/* 2026-10-02 — Department filter (TeamOffice's 3-level
          Company/Department/Employee filter). Options are the distinct
          employees.department values the loader found; an empty list =
          nobody has a department filled in yet. */}
      <div className="mt-4">
        <label className="mb-1 block text-xs font-medium text-slate-600">Department</label>
        <select value={localDepartment} onChange={(e) => setLocalDepartment(e.target.value)} className={inputClass}>
          <option value="">All Departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        {departments.length === 0 && (
          <p className="mt-1 text-xs text-slate-400">No departments set yet — add one from Employees → Edit Details.</p>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Report type list */}
        <div className="rounded-lg border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">Report Type</div>
          <div className="max-h-64 overflow-y-auto p-2">
            {reportTypes.map((r) => (
              <label key={r.key} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-slate-50">
                <input
                  type="radio"
                  name="report"
                  checked={localReport === r.key}
                  onChange={() => setLocalReport(r.key)}
                  className="accent-amber-600"
                />
                {r.label}
              </label>
            ))}
          </div>
        </div>

        {/* Company */}
        <div className="rounded-lg border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <label className="flex items-center gap-1.5 font-medium text-slate-600">
              <input type="radio" name="companyScope" checked={localCompanyScope === "all"} onChange={() => setLocalCompanyScope("all")} className="accent-amber-600" />
              All Company
            </label>
            <label className="flex items-center gap-1.5 font-medium text-slate-600">
              <input type="radio" name="companyScope" checked={localCompanyScope === "few"} onChange={() => setLocalCompanyScope("few")} className="accent-amber-600" />
              Few Company
            </label>
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {companies.map((c) => (
              <label key={c.id} className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${localCompanyScope === "few" ? "cursor-pointer hover:bg-slate-50" : "text-slate-400"}`}>
                <input
                  type="checkbox"
                  disabled={localCompanyScope !== "few"}
                  checked={localCompanyScope === "few" && localCompanyIds.has(c.id)}
                  onChange={() => toggle(localCompanyIds, c.id, setLocalCompanyIds)}
                />
                {c.name}
              </label>
            ))}
          </div>
        </div>

        {/* Employee */}
        <div className="rounded-lg border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs">
            <label className="flex items-center gap-1.5 font-medium text-slate-600">
              <input type="radio" name="employeeScope" checked={localEmployeeScope === "all"} onChange={() => setLocalEmployeeScope("all")} className="accent-amber-600" />
              All Employee
            </label>
            <label className="flex items-center gap-1.5 font-medium text-slate-600">
              <input type="radio" name="employeeScope" checked={localEmployeeScope === "few"} onChange={() => setLocalEmployeeScope("few")} className="accent-amber-600" />
              Few Employee
            </label>
          </div>
          <div className="max-h-64 overflow-y-auto p-2">
            {visibleEmployees.map((e) => (
              <label key={e.id} className={`flex items-center gap-2 rounded px-2 py-1.5 text-sm ${localEmployeeScope === "few" ? "cursor-pointer hover:bg-slate-50" : "text-slate-400"}`}>
                <input
                  type="checkbox"
                  disabled={localEmployeeScope !== "few"}
                  checked={localEmployeeScope === "few" && localEmployeeIds.has(e.id)}
                  onChange={() => toggle(localEmployeeIds, e.id, setLocalEmployeeIds)}
                />
                {e.name}
              </label>
            ))}
          </div>
          <div className="border-t border-slate-100 px-3 py-1.5 text-xs text-slate-400">
            Selected Emp: {localEmployeeScope === "all" ? visibleEmployees.length : localEmployeeIds.size}
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={submit}
        className="mt-4 rounded-lg bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
      >
        ⬇️ Generate Report
      </button>
      <p className="mt-2 text-xs text-slate-400">
        Department comes from the free-text field on each employee (Employees → Edit Details); leave it empty for &quot;—&quot;.
        Export CSV/Excel/Word/PDF from the toolbar above the results.
      </p>
    </div>
  );
}
