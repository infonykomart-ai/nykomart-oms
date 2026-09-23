"use client";

// 2026-09-23 — filter panel for the new Monthly Report page, modeled on
// the TeamOffice attendance software screenshot the user sent (Select
// Punch Date / All-or-Few Company / All-or-Few Employee / a left-hand list
// of report types / PDF-or-Excel). Query-string driven (GET navigation),
// same convention the rest of this app's report filters already use
// (e.g. attendance/admin's own ?company=&month=) rather than a client
// data-fetch — the server page re-reads searchParams and recomputes.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { REPORT_TYPES, type ReportKey } from "@/lib/attendance/monthly-report";

type Company = { id: string; name: string };
type EmployeeOpt = { id: string; name: string; company_id: string };

export function MonthlyReportFilters({
  companies,
  employees,
  month,
  reportKey,
  companyScope,
  selectedCompanyIds,
  employeeScope,
  selectedEmployeeIds,
}: {
  companies: Company[];
  employees: EmployeeOpt[];
  month: string;
  reportKey: ReportKey;
  companyScope: "all" | "few";
  selectedCompanyIds: string[];
  employeeScope: "all" | "few";
  selectedEmployeeIds: string[];
}) {
  const router = useRouter();
  const [localMonth, setLocalMonth] = useState(month);
  const [localReport, setLocalReport] = useState<ReportKey>(reportKey);
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
    params.set("month", localMonth);
    params.set("report", localReport);
    params.set("companyScope", localCompanyScope);
    if (localCompanyScope === "few") params.set("companyIds", Array.from(localCompanyIds).join(","));
    params.set("employeeScope", localEmployeeScope);
    if (localEmployeeScope === "few") params.set("employeeIds", Array.from(localEmployeeIds).join(","));
    router.push(`/dashboard/attendance/admin/monthly-report?${params.toString()}`);
  }

  const visibleEmployees =
    localCompanyScope === "all" || localCompanyIds.size === 0
      ? employees
      : employees.filter((e) => localCompanyIds.has(e.company_id));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">Select Month</label>
          <input
            type="month"
            value={localMonth}
            onChange={(e) => setLocalMonth(e.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Report type list */}
        <div className="rounded-lg border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">Monthly Report</div>
          <div className="max-h-64 overflow-y-auto p-2">
            {REPORT_TYPES.map((r) => (
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
        Department filter isn&apos;t available — this system doesn&apos;t have a department field on employees yet (only role/designation).
      </p>
    </div>
  );
}
