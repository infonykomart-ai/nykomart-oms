// 2026-10-02 — TeamOffice's "COFF Report" menu entry (Compensatory Off):
// per-employee credit over a date range, DERIVED rather than stored —
// days actually worked on a weekly-off day or holiday, minus Leave days
// under a leave type named COFF/Comp Off. Balance can go negative when
// more was availed than earned (shown as-is). Thin wrapper around
// RangeReportPage.
import { type RangeReportKey } from "@/lib/attendance/range-report";
import { RangeReportPage } from "../range-report-page";

const REPORT_TYPES: { key: RangeReportKey; label: string }[] = [
  { key: "coff", label: "COFF Report (week-off/holiday work credit)" },
];

export default async function CoffReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <RangeReportPage
      searchParams={searchParams}
      mode="range"
      basePath="/dashboard/attendance/admin/coff-report"
      heading="COFF Report (Compensatory Off)"
      blurb="Week-off/holiday par kaam karke kitna COFF bana aur kitna use hua (default: pichhle 30 din). Availed = leave type jiska naam COFF/Comp Off ho."
      reportTypes={REPORT_TYPES}
      defaultReport="coff"
    />
  );
}
