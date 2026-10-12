"use client";

// 2026-10-12 — client island for the Performance & KPIs report. The server
// page does all the fetching and every KPI calculation (src/lib/reports/
// kpi.ts); this file only formats, filters, sorts and exports what it is
// given. Numbers are never recomputed here — one engine, one truth.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";
import { BarChart, DonutChart, LineChart } from "@/components/simple-charts";
import type { PeriodKpis } from "@/lib/reports/kpi";
import { PERIOD_OPTIONS, type PeriodKey } from "@/lib/reports/period";
// Types come from the shared server builder (the same module the PDF route
// uses) so the screen and the PDF can't drift into disagreeing shapes.
import type { EmployeePerfRow, TrendPoint } from "@/lib/reports/build-performance-report";

export type { EmployeePerfRow, TrendPoint };

const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const qty = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
const hours = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)} h`);

/** "12.4%" style previous-period delta; "—" when either side has no data. */
function Delta({ current, previous, invert = false }: { current: number | null; previous: number | null; invert?: boolean }) {
  if (current === null || previous === null) return <span className="text-[11px] text-slate-400">vs prev: —</span>;
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) return <span className="text-[11px] text-slate-400">vs prev: no change</span>;
  const good = invert ? diff < 0 : diff > 0;
  return (
    <span className={`text-[11px] font-medium ${good ? "text-emerald-600" : "text-rose-600"}`}>
      vs prev: {diff > 0 ? "▲" : "▼"} {Math.abs(diff).toFixed(1)}
    </span>
  );
}

function KpiCard({
  label,
  value,
  hint,
  delta,
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
      <div className="mt-1 flex flex-wrap items-center gap-x-2">
        {delta}
        {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
      </div>
    </div>
  );
}

type SortKey = keyof Pick<
  EmployeePerfRow,
  | "name"
  | "assigned"
  | "completed"
  | "completionRate"
  | "overdue"
  | "onTimeRate"
  | "avgTurnaroundHours"
  | "taskHours"
  | "logs"
  | "achievementRate"
>;

const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Employee" },
  { key: "assigned", label: "Assigned" },
  { key: "completed", label: "Done" },
  { key: "completionRate", label: "Completion %" },
  { key: "overdue", label: "Overdue" },
  { key: "onTimeRate", label: "On-time %" },
  { key: "avgTurnaroundHours", label: "Avg TAT" },
  { key: "taskHours", label: "Task hours" },
  { key: "logs", label: "Work logs" },
  { key: "achievementRate", label: "Target %" },
];

export function PerformanceReportClient({
  companies,
  employeeRows,
  summary,
  previous,
  trend,
  periodLabel,
  periodFrom,
  periodTo,
  prevLabel,
  prevFrom,
  prevTo,
  currentFilters,
}: {
  companies: { id: string; name: string }[];
  employeeRows: EmployeePerfRow[];
  summary: PeriodKpis;
  previous: PeriodKpis;
  trend: TrendPoint[];
  periodLabel: string;
  periodFrom: string;
  periodTo: string;
  prevLabel: string;
  prevFrom: string;
  prevTo: string;
  currentFilters: { companyId: string; period: PeriodKey; from: string; to: string };
}) {
  const router = useRouter();
  const [companyId, setCompanyId] = useState(currentFilters.companyId);
  const [period, setPeriod] = useState<PeriodKey>(currentFilters.period);
  const [from, setFrom] = useState(currentFilters.from);
  const [to, setTo] = useState(currentFilters.to);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("completed");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function navigate(next: { companyId?: string; period?: PeriodKey; from?: string; to?: string }) {
    const p = new URLSearchParams();
    const nextCompany = next.companyId ?? companyId;
    const nextPeriod = next.period ?? period;
    p.set("period", nextPeriod);
    if (nextCompany) p.set("company", nextCompany);
    if (nextPeriod === "custom") {
      p.set("from", next.from ?? from);
      p.set("to", next.to ?? to);
    }
    router.push(`/dashboard/reports/performance?${p.toString()}`);
  }

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? employeeRows.filter(
          (r) => r.name.toLowerCase().includes(q) || r.designation.toLowerCase().includes(q)
        )
      : employeeRows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sortKey === "name") return a.name.localeCompare(b.name) * dir;
      const av = a[sortKey] ?? null;
      const bv = b[sortKey] ?? null;
      // nulls (no data) always sort last, regardless of direction — "no data"
      // is not "zero".
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir;
    });
  }, [employeeRows, search, sortKey, sortDir]);

  const exportColumns: ExportColumn<EmployeePerfRow>[] = useMemo(
    () => [
      { key: "name", label: "Employee", value: (r) => r.name },
      { key: "designation", label: "Designation", value: (r) => r.designation || "—" },
      { key: "status", label: "Status", value: (r) => (r.active ? "Active" : "Inactive") },
      { key: "assigned", label: "Assigned", value: (r) => r.assigned },
      { key: "completed", label: "Completed", value: (r) => r.completed },
      { key: "completion", label: "Completion %", value: (r) => (r.completionRate === null ? "" : r.completionRate) },
      { key: "inProgress", label: "In Progress", value: (r) => r.inProgress },
      { key: "pending", label: "Pending", value: (r) => r.pending },
      { key: "cancelled", label: "Cancelled (excluded)", value: (r) => r.cancelled },
      { key: "overdue", label: "Overdue", value: (r) => r.overdue },
      { key: "onTime", label: "On-time %", value: (r) => (r.onTimeRate === null ? "" : r.onTimeRate) },
      { key: "late", label: "Completed late", value: (r) => r.completedLate },
      { key: "tat", label: "Avg turnaround (h)", value: (r) => (r.avgTurnaroundHours === null ? "" : r.avgTurnaroundHours) },
      { key: "taskHours", label: "Task hours", value: (r) => (r.taskHours === null ? "" : r.taskHours) },
      { key: "logs", label: "Work logs", value: (r) => r.logs },
      { key: "submitted", label: "Logs submitted", value: (r) => r.submittedLogs },
      { key: "draft", label: "Logs still draft", value: (r) => r.draftLogs },
      { key: "planned", label: "Planned qty", value: (r) => r.plannedQty },
      { key: "actual", label: "Actual qty", value: (r) => r.actualQty },
      { key: "targetPct", label: "Target achievement %", value: (r) => (r.achievementRate === null ? "" : r.achievementRate) },
    ],
    []
  );

  const statusDonut = [
    { label: "Completed", value: summary.tasks.completed, color: "#059669" },
    { label: "In Progress", value: summary.tasks.inProgress, color: "#0284c7" },
    { label: "Pending", value: summary.tasks.pending, color: "#94a3b8" },
    { label: "Cancelled", value: summary.tasks.cancelled, color: "#e11d48" },
  ].filter((d) => d.value > 0);

  const topCompleted = [...employeeRows]
    .filter((r) => r.completed > 0)
    .sort((a, b) => b.completed - a.completed)
    .slice(0, 10)
    .map((r) => ({ label: r.name, value: r.completed, color: "#0284c7" }));

  const rangeText = periodFrom === periodTo ? periodFrom : `${periodFrom} → ${periodTo}`;
  const prevRangeText = prevFrom === prevTo ? prevFrom : `${prevFrom} → ${prevTo}`;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="perf-company">
              Company
            </label>
            <select
              id="perf-company"
              value={companyId}
              onChange={(e) => {
                setCompanyId(e.target.value);
                navigate({ companyId: e.target.value });
              }}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500"
            >
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="perf-period">
              Period
            </label>
            <select
              id="perf-period"
              value={period}
              onChange={(e) => {
                const next = e.target.value as PeriodKey;
                setPeriod(next);
                navigate({ period: next });
              }}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500"
            >
              {PERIOD_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {period === "custom" && (
            <>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="perf-from">
                  From
                </label>
                <input
                  id="perf-from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="perf-to">
                  To
                </label>
                <input
                  id="perf-to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500"
                />
              </div>
              <button
                type="button"
                onClick={() => navigate({ from, to })}
                className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700"
              >
                Apply
              </button>
            </>
          )}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          {periodLabel}: <span className="font-medium text-slate-500">{rangeText}</span> · comparing with{" "}
          <span className="font-medium text-slate-500">{prevLabel} ({prevRangeText})</span>. Tasks are counted by
          the date they were assigned; work logs by log date. Overdue is measured as of today and covers this
          period&apos;s tasks only.
        </p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          label="Task completion"
          value={pct(summary.tasks.completionRatePct)}
          hint={`${summary.tasks.completed}/${summary.tasks.assigned} done`}
          delta={<Delta current={summary.tasks.completionRatePct} previous={previous.tasks.completionRatePct} />}
        />
        <KpiCard
          label="On-time completion"
          value={pct(summary.onTime.onTimeRatePct)}
          hint={`${summary.onTime.completedOnTime} on time · ${summary.onTime.completedLate} late`}
          delta={<Delta current={summary.onTime.onTimeRatePct} previous={previous.onTime.onTimeRatePct} />}
        />
        <KpiCard
          label="Overdue tasks"
          value={String(summary.onTime.overdue)}
          hint="past deadline, not done"
          delta={<Delta current={summary.onTime.overdue} previous={previous.onTime.overdue} invert />}
        />
        <KpiCard
          label="Target achievement"
          value={pct(summary.target.achievementRatePct)}
          hint={
            summary.target.withBoth > 0
              ? `${qty(summary.target.actualQty)} / ${qty(summary.target.plannedQty)}`
              : "no target entered"
          }
          delta={<Delta current={summary.target.achievementRatePct} previous={previous.target.achievementRatePct} />}
        />
        <KpiCard
          label="Avg turnaround"
          value={hours(summary.turnaround.avgHours)}
          hint={`median ${hours(summary.turnaround.medianHours)}`}
          delta={<Delta current={summary.turnaround.avgHours} previous={previous.turnaround.avgHours} invert />}
        />
        <KpiCard
          label="Report discipline"
          value={pct(summary.submission.submissionRatePct)}
          hint={`${summary.submission.submitted}/${summary.submission.logged} logs submitted`}
          delta={<Delta current={summary.submission.submissionRatePct} previous={previous.submission.submissionRatePct} />}
        />
      </div>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
          <h3 className="mb-2 text-sm font-bold text-slate-700">Assigned vs completed — daily</h3>
          {trend.length === 0 ? (
            <p className="text-xs text-slate-400">
              Period longer than 120 days — daily trend hidden to keep the chart readable. Use the table below, or
              pick a shorter period.
            </p>
          ) : (
            <LineChart
              series={[
                {
                  name: "Assigned",
                  color: "#94a3b8",
                  points: trend.map((t) => ({ x: t.date.slice(5), value: t.assigned })),
                },
                {
                  name: "Completed",
                  color: "#059669",
                  points: trend.map((t) => ({ x: t.date.slice(5), value: t.completed })),
                },
              ]}
              height={200}
            />
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-bold text-slate-700">Task status</h3>
          <DonutChart
            data={statusDonut}
            centerLabel={{ title: "Tasks", value: String(summary.tasks.assigned + summary.tasks.cancelled) }}
            size={180}
          />
        </div>
      </div>

      {topCompleted.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-sm font-bold text-slate-700">Most tasks completed — top 10</h3>
          <BarChart data={topCompleted} height={168} />
        </div>
      )}

      {/* Employee table + exports */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-700">Employee performance</h3>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employee or designation…"
            className="w-64 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500"
          />
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                {SORT_COLUMNS.map((c) => (
                  <th key={c.key} className="px-2 py-2 font-medium">
                    <button
                      type="button"
                      onClick={() => {
                        if (sortKey === c.key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
                        else {
                          setSortKey(c.key);
                          setSortDir("desc");
                        }
                      }}
                      className="inline-flex items-center gap-1 hover:text-slate-700"
                    >
                      {c.label}
                      {sortKey === c.key ? <span>{sortDir === "asc" ? "↑" : "↓"}</span> : null}
                    </button>
                  </th>
                ))}
                <th className="px-2 py-2 font-medium">Designation</th>
                <th className="px-2 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={SORT_COLUMNS.length + 2} className="px-2 py-6 text-center text-slate-400">
                    No employees found for this filter.
                  </td>
                </tr>
              )}
              {visibleRows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="px-2 py-1.5 font-medium text-slate-800">{r.name}</td>
                  <td className="px-2 py-1.5 text-slate-600">{qty(r.assigned)}</td>
                  <td className="px-2 py-1.5 text-slate-600">{qty(r.completed)}</td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`font-semibold ${
                        r.completionRate === null
                          ? "text-slate-400"
                          : r.completionRate >= 80
                            ? "text-emerald-600"
                            : r.completionRate >= 50
                              ? "text-amber-600"
                              : "text-rose-600"
                      }`}
                    >
                      {pct(r.completionRate)}
                    </span>
                  </td>
                  <td className={`px-2 py-1.5 ${r.overdue > 0 ? "font-semibold text-rose-600" : "text-slate-400"}`}>
                    {r.overdue}
                  </td>
                  <td className="px-2 py-1.5 text-slate-600">{pct(r.onTimeRate)}</td>
                  <td className="px-2 py-1.5 text-slate-600">{hours(r.avgTurnaroundHours)}</td>
                  <td className="px-2 py-1.5 text-slate-600">{r.taskHours === null ? "—" : `${r.taskHours} h`}</td>
                  <td className="px-2 py-1.5 text-slate-600">
                    {qty(r.logs)}
                    {r.draftLogs > 0 && <span className="ml-1 text-[10px] text-amber-600">({r.draftLogs} draft)</span>}
                  </td>
                  <td className="px-2 py-1.5 text-slate-600">{pct(r.achievementRate)}</td>
                  <td className="px-2 py-1.5 text-slate-500">{r.designation || "—"}</td>
                  <td className="px-2 py-1.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        r.active ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      {r.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 border-t border-slate-100 pt-3">
          <ExportBar
            title={`Performance Report — ${periodLabel} (${rangeText})`}
            filenameBase={`performance-report-${periodFrom}-to-${periodTo}`}
            columns={exportColumns}
            rows={visibleRows}
            // 2026-10-12 — real A4 PDF (company logo header, KPI cards, trend,
            // the table with repeated headers, approval block). Only the
            // FILTERS go over the wire: the route re-derives every figure from
            // the database under this user's own permissions, so the file can
            // never show more (or different) numbers than the screen.
            pdfEndpoint="/api/performance-report-pdf"
            pdfPayload={{ companyId, period, from, to }}
            pdfFilename={`performance-report-${periodFrom}-to-${periodTo}.pdf`}
          />
        </div>
      </div>
    </div>
  );
}
