// 2026-10-01 — one server component behind all three range-report pages
// (Daily / Periodic / Yearly). They differ ONLY in their date control
// (one date vs a from–to range), heading and available report types, so
// the whole load → filter → render pipeline lives here once; each page
// file is just its own configuration.
import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { addDaysToDateStr, todayIST } from "@/lib/attendance/ist-date";
import { loadRangeReport, validDate } from "./range-report-data";
import { RangeReportFilters } from "./range-report-filters";
import { ReportResults } from "./report-results";
import type { RangeReportKey } from "@/lib/attendance/range-report";

type SP = { [key: string]: string | string[] | undefined };

export async function RangeReportPage({
  searchParams,
  mode,
  basePath,
  heading,
  blurb,
  reportTypes,
  defaultReport,
  defaultFrom,
  defaultTo,
}: {
  searchParams: Promise<SP>;
  mode: "date" | "range";
  basePath: string;
  heading: string;
  blurb: string;
  reportTypes: { key: RangeReportKey; label: string }[];
  defaultReport: RangeReportKey;
  /** range mode only — defaults to (today − 30 days) .. today. */
  defaultFrom?: string;
  /** range mode only — defaults to today. */
  defaultTo?: string;
}) {
  const authed = await requireCapability("attendance_admin");
  const sp = await searchParams;
  const today = todayIST();

  let startDate: string;
  let endDate: string;
  if (mode === "date") {
    startDate = validDate(sp.date, today);
    endDate = startDate;
  } else {
    startDate = validDate(sp.from, defaultFrom ?? addDaysToDateStr(today, -30));
    endDate = validDate(sp.to, defaultTo ?? today);
    if (startDate > endDate) {
      // A reversed range is user error, not an empty report — swap it.
      const t = startDate;
      startDate = endDate;
      endDate = t;
    }
  }

  const reportKey: RangeReportKey = reportTypes.some((r) => r.key === sp.report) ? (sp.report as RangeReportKey) : defaultReport;
  const reportLabel = reportTypes.find((r) => r.key === reportKey)?.label ?? reportKey;

  const data = await loadRangeReport({ authed, sp, startDate, endDate, reportKey });
  const rangeLabel = mode === "date" ? startDate : `${startDate} to ${endDate}`;
  const title = `${reportLabel} — ${rangeLabel}`;

  return (
    <div className="space-y-4 p-4 md:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-900">{heading}</h1>
          <p className="text-sm text-slate-500">{blurb}</p>
        </div>
        <Link
          href="/dashboard/attendance/admin"
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Attendance Admin
        </Link>
      </div>

      {data.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{data.error}</p>}

      <RangeReportFilters
        basePath={basePath}
        mode={mode}
        date={mode === "date" ? startDate : today}
        from={startDate}
        to={endDate}
        reportKey={reportKey}
        reportTypes={reportTypes}
        companies={data.companies}
        employees={data.allEmployees}
        departments={data.departments}
        department={data.scope.department}
        companyScope={data.scope.companyScope}
        selectedCompanyIds={data.scope.companyScope === "few" ? data.scope.requestedCompanyIds : data.scope.effectiveCompanyIds}
        employeeScope={data.scope.employeeScope}
        selectedEmployeeIds={data.scope.requestedEmployeeIds}
      />

      <ReportResults title={title} columns={data.columns} rows={data.rows} />
    </div>
  );
}
