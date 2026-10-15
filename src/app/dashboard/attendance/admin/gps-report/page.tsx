// 2026-10-02 — TeamOffice's "GPS Report" menu entry: one row per punch
// over a date range with the captured coordinates (attendance.
// punch_in/out_lat,lng) and a Google Maps deep link. Rows without coords
// still list ("—") so the page doubles as an audit of punches missing a
// location. Thin wrapper around RangeReportPage.
import { type RangeReportKey } from "@/lib/attendance/range-report";
import { RangeReportPage } from "../range-report-page";

const REPORT_TYPES: { key: RangeReportKey; label: string }[] = [
  { key: "gps", label: "GPS Report (punch-wise coordinates)" },
];

export default async function GpsReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <RangeReportPage
      searchParams={searchParams}
      mode="range"
      basePath="/dashboard/attendance/admin/gps-report"
      heading="GPS Report"
      blurb="Punch-wise GPS coordinates with a Google Maps link (default: the last 30 days). Rows that came in without server-side punch/import coordinates are listed too, which is what makes this usable as a missing-location audit."
      reportTypes={REPORT_TYPES}
      defaultReport="gps"
    />
  );
}
