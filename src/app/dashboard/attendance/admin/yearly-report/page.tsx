// 2026-10-01 — TeamOffice's "Yearly Report" menu entry: the FINANCIAL
// YEAR (Apr 1 → Mar 31, same FY anchoring the rest of this app uses —
// see src/lib/fy-date.ts) performance report per employee: Present/Late/
// Half Day/Leave/Absent/Holiday/Week-Off totals + Work hrs + OT hrs,
// exportable like every other report. Thin wrapper — all loading and
// rendering lives in RangeReportPage.
import { yearlyReportTypes } from "@/lib/attendance/range-report";
import { todayIST } from "@/lib/attendance/ist-date";
import { RangeReportPage } from "../range-report-page";

function currentFyRange(): { from: string; to: string } {
  const today = todayIST(); // YYYY-MM-DD (IST)
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));
  // FY starts April: Apr 2026 – Mar 2027 → from 2026-04-01 to 2027-03-31.
  const startYear = month >= 4 ? year : year - 1;
  return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
}

export default async function YearlyReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const fy = currentFyRange();
  return (
    <RangeReportPage
      searchParams={searchParams}
      mode="range"
      basePath="/dashboard/attendance/admin/yearly-report"
      heading="Yearly Report"
      blurb="Current financial year (1 April – 31 March) ka per-employee performance summary — Present, Late, Half Day, Leave, Absent, Work hrs aur OT hrs — export ke saath."
      reportTypes={yearlyReportTypes()}
      defaultReport="performance"
      defaultFrom={fy.from}
      defaultTo={fy.to}
    />
  );
}
