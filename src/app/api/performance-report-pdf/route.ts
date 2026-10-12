import { NextResponse } from "next/server";
import { requireCapability, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { buildPerformanceReport } from "@/lib/reports/build-performance-report";
import { PERIOD_OPTIONS, resolvePeriod, previousPeriod, formatRange, type PeriodKey } from "@/lib/reports/period";
import { renderPerformanceReportPdf, type PerformancePdfKpi, type PerformancePdfRow } from "@/lib/performance-report-pdf";

// 2026-10-12 — the Performance & KPIs report as a real A4 PDF file.
//
// POST (not GET) because the request carries the report's filters. Unlike the
// ledger PDF, this route does NOT accept rows from the client: it re-runs the
// same buildPerformanceReport() the dashboard page uses, under the caller's own
// `reports` capability and company scope. So the file can only ever contain
// what that person is already allowed to see, and "PDF figures match the
// database" is guaranteed rather than hoped for.
//
// Body: { companyId, period, from?, to? } — from/to only matter for period=
// "custom". Anything else is ignored.
export async function POST(request: Request) {
  let employee;
  try {
    employee = await requireCapability("reports");
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "Sign in first." }, { status: 401 });
    }
    return NextResponse.json({ ok: false, error: "This report requires the Reports permission." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as
    | { companyId?: string; period?: string; from?: string; to?: string }
    | null;
  if (!body?.period || !PERIOD_OPTIONS.some((o) => o.key === body.period)) {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  // Company scope is re-checked here — the payload can never widen access.
  const companyId = body.companyId && employee.companyIds.includes(body.companyId) ? body.companyId : employee.currentCompanyId;
  if (!companyId || !employee.companyIds.includes(companyId)) {
    return NextResponse.json({ ok: false, error: "You don't have access to this company." }, { status: 403 });
  }

  const today = todayIST();
  const period = resolvePeriod(body.period as PeriodKey, { today, from: body.from, to: body.to });
  const prev = previousPeriod(period);

  const supabase = createServiceRoleClient();
  const [data, { data: company }, { data: profile }] = await Promise.all([
    buildPerformanceReport(supabase, { companyId, period, previous: prev, today }),
    supabase.from("companies").select("id, name, logo_url").eq("id", companyId).maybeSingle(),
    supabase.from("company_profiles").select("address, phone, email, gstin").eq("company_id", companyId).maybeSingle(),
  ]);

  const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
  const qty = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  const hours = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)} h`);

  const s = data.summary;
  const kpis: PerformancePdfKpi[] = [
    {
      label: "Task completion",
      value: pct(s.tasks.completionRatePct),
      detail: `${s.tasks.completed}/${s.tasks.assigned} done`,
    },
    {
      label: "On-time completion",
      value: pct(s.onTime.onTimeRatePct),
      detail: `${s.onTime.completedOnTime} on time · ${s.onTime.completedLate} late`,
    },
    { label: "Overdue tasks", value: String(s.onTime.overdue), detail: "past deadline, not done" },
    {
      label: "Target achievement",
      value: pct(s.target.achievementRatePct),
      detail: s.target.withBoth > 0 ? `${qty(s.target.actualQty)} / ${qty(s.target.plannedQty)}` : "no target entered",
    },
    { label: "Avg turnaround", value: hours(s.turnaround.avgHours), detail: `median ${hours(s.turnaround.medianHours)}` },
    {
      label: "Report discipline",
      value: pct(s.submission.submissionRatePct),
      detail: `${s.submission.submitted}/${s.submission.logged} logs submitted`,
    },
  ];

  const rows: PerformancePdfRow[] = data.employeeRows.map((r) => ({
    name: r.name,
    designation: r.designation,
    active: r.active,
    assigned: r.assigned,
    completed: r.completed,
    completionRate: r.completionRate,
    overdue: r.overdue,
    onTimeRate: r.onTimeRate,
    avgTurnaroundHours: r.avgTurnaroundHours,
    taskHours: r.taskHours,
    logs: r.logs,
    submittedLogs: r.submittedLogs,
    plannedQty: r.plannedQty,
    actualQty: r.actualQty,
    achievementRate: r.achievementRate,
  }));

  const companyName = company?.name ?? "Company";

  const buffer = await renderPerformanceReportPdf({
    companyName,
    logoUrl: company?.logo_url ?? null,
    profile: profile ?? null,
    title: "Performance & KPIs Report",
    periodLabel: period.label,
    periodFrom: period.from,
    periodTo: period.to,
    prevLabel: prev.label,
    prevFrom: prev.from,
    prevTo: prev.to,
    generatedAt: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true }),
    filtersLine: `${companyName} · ${period.label} (${formatRange(period)}) · ${data.staffCount} employee(s)`,
    kpis,
    trend: data.trend,
    rows,
    totals: {
      assigned: s.tasks.assigned,
      completed: s.tasks.completed,
      completionRate: s.tasks.completionRatePct,
      overdue: s.onTime.overdue,
      onTimeRate: s.onTime.onTimeRatePct,
      taskHours: s.taskHours,
      logs: s.submission.logged,
      submittedLogs: s.submission.submitted,
      plannedQty: s.target.plannedQty,
      actualQty: s.target.actualQty,
      achievementRate: s.target.achievementRatePct,
      cancelled: s.tasks.cancelled,
    },
  });

  const filename = `performance-report-${period.from}-to-${period.to}.pdf`;
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
