// 2026-10-02 — TeamOffice's "Location Report" menu entry: per-day,
// per-employee work location over a date range — attendance.store_id's
// store name when set, else the Web-Punch GPS fix, else "—". Thin wrapper
// around RangeReportPage (all loading/rendering shared with Daily/
// Periodic/Yearly).
import { type RangeReportKey } from "@/lib/attendance/range-report";
import { RangeReportPage } from "../range-report-page";

const REPORT_TYPES: { key: RangeReportKey; label: string }[] = [
  { key: "location", label: "Location Report (day-wise store / GPS)" },
];

export default async function LocationReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <RangeReportPage
      searchParams={searchParams}
      mode="range"
      basePath="/dashboard/attendance/admin/location-report"
      heading="Location Report"
      blurb="Har employee ka din-k-din kaam ki location — store name ya Web-Punch GPS fix (default: pichhle 30 din), company/department/employee filter aur export ke saath."
      reportTypes={REPORT_TYPES}
      defaultReport="location"
    />
  );
}
