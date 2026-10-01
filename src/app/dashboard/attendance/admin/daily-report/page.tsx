// 2026-10-01 — TeamOffice's "Daily Report" menu entry: one date, every
// report type that makes sense for a single day (Day Performance with
// Late IN / Early OUT, Present, IN/OUT, Absent, Late IN, Early IN/OUT,
// Overtime, Half Day, Mis Punch), company/employee scoped, exportable via
// the shared ExportBar (PDF/Excel/Word/CSV). Thin wrapper — all loading
// and rendering lives in RangeReportPage.
import { RANGE_REPORT_TYPES } from "@/lib/attendance/range-report";
import { RangeReportPage } from "../range-report-page";

export default async function DailyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <RangeReportPage
      searchParams={searchParams}
      mode="date"
      basePath="/dashboard/attendance/admin/daily-report"
      heading="Daily Report"
      blurb="Kisi bhi ek din ki team ki poori attendance — Day Performance (IN/OUT, Late IN, Early OUT ke saath), Present/Absent/Late lists, export toolbar ke saath."
      reportTypes={RANGE_REPORT_TYPES}
      defaultReport="day"
    />
  );
}
