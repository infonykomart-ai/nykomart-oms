import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { buildPerformanceReport } from "@/lib/reports/build-performance-report";
import {
  PERIOD_OPTIONS,
  resolvePeriod,
  previousPeriod,
  formatRange,
  type PeriodKey,
} from "@/lib/reports/period";
import { PerformanceReportClient } from "./performance-report-client";

// 2026-10-12 — Performance & KPIs report. The reporting system previously
// covered money (Orders, Purchase Bills, Party Ledger, Outstanding, Salary…)
// but had no single screen answering "how did the team actually perform over
// this period". This is that screen.
//
// All fetching + KPI maths lives in src/lib/reports/build-performance-report
// (shared with /api/performance-report-pdf, so the downloaded file can never
// disagree with what's on screen), on top of:
//
//   src/lib/reports/kpi.ts     — every formula, once, unit-testable
//   src/lib/reports/period.ts  — what "Weekly / Monthly / FY Half" means, in IST
//
// SCOPE RULE (stated in the UI too, because a number without a definition is
// a rumour): the period selects TASKS BY created_at — work assigned during
// the period — and DAILY WORK LOGS BY log_date. Overdue is the one
// point-in-time measure: among this period's tasks, how many are past their
// deadline and still not Done as of today (IST).
//
// Capability: the same `reports` capability as every other hub report — this
// is a read-only team-performance view, not a payroll or HR-admin screen.
export default async function PerformanceReportPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("reports");
  const supabase = await createClient();
  const sp = await searchParams;

  const { data: companies } = await supabase
    .from("companies")
    .select("id, name")
    .in("id", employee.companyIds)
    .order("name");

  const companyId =
    typeof sp.company === "string" && employee.companyIds.includes(sp.company)
      ? sp.company
      : employee.currentCompanyId;

  const today = todayIST();
  const periodKey: PeriodKey =
    typeof sp.period === "string" && PERIOD_OPTIONS.some((o) => o.key === sp.period)
      ? (sp.period as PeriodKey)
      : "monthly";

  const period = resolvePeriod(periodKey, {
    today,
    from: typeof sp.from === "string" ? sp.from : undefined,
    to: typeof sp.to === "string" ? sp.to : undefined,
  });
  const prev = previousPeriod(period);

  const data = await buildPerformanceReport(supabase, { companyId, period, previous: prev, today });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">📈 Performance &amp; KPIs</h1>
          <p className="mt-1 text-sm text-slate-500">
            Team output, timeliness and report discipline for {formatRange(period)} —{" "}
            {data.summary.tasks.assigned} task{data.summary.tasks.assigned === 1 ? "" : "s"} assigned,{" "}
            {data.summary.submission.logged} work-log entr{data.summary.submission.logged === 1 ? "y" : "ies"}.
          </p>
        </div>
        <Link href="/dashboard/reports" className="shrink-0 text-sm text-slate-500 hover:underline">
          ← Back to Reports
        </Link>
      </div>

      <PerformanceReportClient
        companies={companies ?? []}
        employeeRows={data.employeeRows}
        summary={data.summary}
        previous={data.previous}
        trend={data.trend}
        periodLabel={period.label}
        periodFrom={period.from}
        periodTo={period.to}
        prevLabel={prev.label}
        prevFrom={prev.from}
        prevTo={prev.to}
        currentFilters={{ companyId, period: periodKey, from: period.from, to: period.to }}
      />
    </div>
  );
}
