// 2026-10-01 — TeamOffice's "Periodic Report" menu entry: any from–to
// date range (default: last 30 days) with the full range report-type
// list, company/employee scoped, exportable. Thin wrapper — all loading
// and rendering lives in RangeReportPage.
import { RANGE_REPORT_TYPES } from "@/lib/attendance/range-report";
import { RangeReportPage } from "../range-report-page";

export default async function PeriodicReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <RangeReportPage
      searchParams={searchParams}
      mode="range"
      basePath="/dashboard/attendance/admin/periodic-report"
      heading="Periodic Report"
      blurb="Kisi bhi date range (default: pichhle 30 din) ki performance, IN/OUT, absent/late/OT reports — company/employee filter aur export ke saath."
      reportTypes={RANGE_REPORT_TYPES}
      defaultReport="performance"
    />
  );
}
