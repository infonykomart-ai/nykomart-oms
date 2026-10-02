// 2026-10-02 — TeamOffice's "Other Report" menu entry (its miscellaneous
// bucket): the three report shapes that don't fit the day/per-employee
// lists — Punch Source Summary (Web/Manual/Import + GPS-captured counts),
// Department Rollup (grouped totals per department) and Working Hours
// Summary (total/avg/OT/short days). All three ride the shared
// range-report engine, so company/department/employee filters, the date
// range and the export toolbar come for free.
import { OTHER_REPORT_TYPES } from "@/lib/attendance/range-report";
import { RangeReportPage } from "../range-report-page";

export default async function OtherReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <RangeReportPage
      searchParams={searchParams}
      mode="range"
      basePath="/dashboard/attendance/admin/other-report"
      heading="Other Report"
      blurb="Miscellaneous reports — punch source summary, department rollup aur working-hours summary (default: pichhle 30 din), company/department/employee filter + export ke saath."
      reportTypes={OTHER_REPORT_TYPES}
      defaultReport="source"
    />
  );
}
