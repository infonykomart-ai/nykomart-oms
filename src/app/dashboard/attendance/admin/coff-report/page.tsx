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
      blurb="How much COFF was earned by working on weekly offs / holidays and how much was used (default: the last 30 days). Availed = rows whose leave type is named COFF / Comp Off."
      reportTypes={REPORT_TYPES}
      defaultReport="coff"
    />
  );
}
