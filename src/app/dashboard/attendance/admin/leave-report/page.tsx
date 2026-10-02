// 2026-10-02 — TeamOffice's "Leave Report" menu entry: per-employee
// summary over a date range — leave days from categorizeMonth's Leave
// category (the same source payroll deducts from), paid/unpaid split,
// leave-type breakdown, and Approved/Pending/Rejected leave_requests
// counts overlapping the range. Thin wrapper around RangeReportPage.
import { type RangeReportKey } from "@/lib/attendance/range-report";
import { RangeReportPage } from "../range-report-page";

const REPORT_TYPES: { key: RangeReportKey; label: string }[] = [
  { key: "leave", label: "Leave Report (days + requests)" },
];

export default async function LeaveReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <RangeReportPage
      searchParams={searchParams}
      mode="range"
      basePath="/dashboard/attendance/admin/leave-report"
      heading="Leave Report"
      blurb="Period ki leave summary per employee — leave days (paid/unpaid + type ke hisaab se) aur Approved/Pending/Rejected request counts (default: pichhle 30 din)."
      reportTypes={REPORT_TYPES}
      defaultReport="leave"
    />
  );
}
