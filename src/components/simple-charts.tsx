// 2026-09-17 (evening) — lightweight, dependency-free charts for the CRM
// page's new per-section graphs ("sabhi section ka digram/graph vagera").
// No chart library (recharts/chart.js/d3/visx/nivo) is installed in
// package.json — rather than add one for a handful of small server-rendered
// charts, these hand-roll just enough per the `dataviz` skill's method:
//   - color assigned by job (categorical identity / sequential magnitude /
//     status), never a rainbow, never cycled
//   - one shared axis only — a bar+line combo on the same INR scale is fine,
//     two different y-scales never is
//   - thin marks (2px lines, rounded bar caps), a legend whenever 2+ series
//     share a chart, none needed for a single series (the section heading
//     already names it)
//   - a hover layer — this page is a plain server component (no "use
//     client" island anywhere else on it), so the hover layer here is a
//     native SVG/HTML <title> tooltip instead of a JS crosshair: zero
//     bundle cost, works with no script, degrades to "no tooltip" only in
//     browsers with no title-attribute support at all.
// Pure presentational — every caller passes already-fetched numbers, no
// data fetching here.

export type BarDatum = { label: string; value: number; color?: string };

const DEFAULT_BAR_COLOR = "#0284c7"; // sky-600 — same "money/neutral" hue used elsewhere on this page

export function BarChart({
  data,
  height = 168,
  valueFormatter = (v: number) => v.toLocaleString("en-IN"),
}: {
  data: BarDatum[];
  height?: number;
  valueFormatter?: (v: number) => string;
}) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.value)));
  const barAreaHeight = height - 34;
  if (data.length === 0) {
    return <p className="text-xs text-[var(--oms-text-muted)]">No data yet.</p>;
  }
  return (
    <div className="w-full overflow-x-auto">
      <div className="flex items-end gap-3 px-1" style={{ height, minWidth: Math.max(320, data.length * 56) }}>
        {data.map((d) => {
          const h = Math.max(2, Math.round((Math.abs(d.value) / max) * barAreaHeight));
          return (
            <div key={d.label} className="flex min-w-[44px] flex-1 flex-col items-center justify-end gap-1" title={`${d.label}: ${valueFormatter(d.value)}`}>
              <span className="text-[10px] font-semibold text-[var(--oms-text)]">{valueFormatter(d.value)}</span>
              <div
                className="w-full rounded-t-md"
                style={{ height: h, background: d.color ?? DEFAULT_BAR_COLOR }}
              />
              <span className="line-clamp-2 text-center text-[10px] leading-tight text-[var(--oms-text-muted)]">{d.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type GroupedBarGroup = { label: string; values: number[] };
export type GroupedBarSeries = { name: string; color: string };

// Multi-series bars sharing one axis (e.g. Sale / Expenses / Net Earn per
// company, all INR) — legend is mandatory here since color now carries
// series identity, not just magnitude.
export function GroupedBarChart({
  groups,
  series,
  height = 200,
  valueFormatter = (v: number) => v.toLocaleString("en-IN"),
}: {
  groups: GroupedBarGroup[];
  series: GroupedBarSeries[];
  height?: number;
  valueFormatter?: (v: number) => string;
}) {
  const max = Math.max(1, ...groups.flatMap((g) => g.values.map((v) => Math.abs(v))));
  const barAreaHeight = height - 24;
  if (groups.length === 0) {
    return <p className="text-xs text-[var(--oms-text-muted)]">No data yet.</p>;
  }
  return (
    <div className="w-full">
      <div className="mb-2 flex flex-wrap gap-3 text-[11px]">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="text-[var(--oms-text-muted)]">{s.name}</span>
          </span>
        ))}
      </div>
      <div className="w-full overflow-x-auto">
        <div className="flex items-end gap-5 px-1" style={{ height, minWidth: Math.max(320, groups.length * 90) }}>
          {groups.map((g) => (
            <div key={g.label} className="flex min-w-[80px] flex-1 flex-col items-center gap-1">
              <div className="flex items-end gap-1" style={{ height: barAreaHeight }}>
                {g.values.map((v, i) => {
                  const h = Math.max(2, Math.round((Math.abs(v) / max) * barAreaHeight));
                  return (
                    <div
                      key={series[i]?.name ?? i}
                      title={`${g.label} — ${series[i]?.name ?? ""}: ${valueFormatter(v)}`}
                      className="w-3 rounded-t-sm sm:w-4"
                      style={{ height: h, background: series[i]?.color ?? DEFAULT_BAR_COLOR }}
                    />
                  );
                })}
              </div>
              <span className="line-clamp-2 text-center text-[10px] leading-tight text-[var(--oms-text-muted)]">{g.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 2026-09-18 — Donut chart, added for the Finance Dashboard's "Expense
// Breakdown" panel ("esa desboard banega P&L ka" — reference mockup has a
// KPI-cards + bar/donut/line + transaction-lists layout; this fills the
// donut slot). Categorical color-by-identity (never cycled/generated),
// palette checked via the dataviz skill's validate_palette.js: 5 real hues
// pass every check; the 6th slot (a genuine "Other/misc" bucket) is a
// deliberately low-chroma neutral, which the skill's own rule allows ONLY
// paired with a visible label+value — this component always renders both
// in its legend, never color alone.
export type DonutDatum = { label: string; value: number; color: string };

export function DonutChart({
  data,
  size = 200,
  thickness = 34,
  valueFormatter = (v: number) => v.toLocaleString("en-IN"),
  centerLabel,
}: {
  data: DonutDatum[];
  size?: number;
  thickness?: number;
  valueFormatter?: (v: number) => string;
  centerLabel?: { title: string; value: string };
}) {
  const total = data.reduce((s, d) => s + Math.max(0, d.value), 0);
  if (total <= 0) {
    return <p className="text-xs text-[var(--oms-text-muted)]">No data yet.</p>;
  }
  const r = (size - thickness) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  // Cumulative offsets computed WITHOUT a render-time reassigned accumulator
  // (the react-compiler rule): one pass over the positive slices up front.
  const positive = data.filter((d) => d.value > 0);
  const offsets = positive.map((_, i) =>
    positive.slice(0, i).reduce((s, x) => s + (x.value / total) * circumference, 0)
  );
  return (
    <div className="flex flex-wrap items-center gap-4">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Expense breakdown">
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--oms-surface-border)" strokeWidth={thickness} />
        {positive.map((d, i) => {
            const frac = d.value / total;
            const dash = Math.max(0, frac * circumference - 1.5); // 1.5px gap between segments
            const dashArray = `${dash} ${circumference - dash}`;
            const dashOffset = circumference * 0.25 - offsets[i]; // start at 12 o'clock, go clockwise
            return (
              <circle
                key={d.label}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={d.color}
                strokeWidth={thickness}
                strokeDasharray={dashArray}
                strokeDashoffset={dashOffset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${cx} ${cy})`}
              >
                <title>{`${d.label}: ${valueFormatter(d.value)} (${(frac * 100).toFixed(1)}%)`}</title>
              </circle>
            );
          })}
        {centerLabel && (
          <>
            <text x={cx} y={cy - 6} textAnchor="middle" fontSize={13} fontWeight={700} fill="var(--oms-text)">
              {centerLabel.value}
            </text>
            <text x={cx} y={cy + 12} textAnchor="middle" fontSize={9} fill="var(--oms-text-muted)">
              {centerLabel.title}
            </text>
          </>
        )}
      </svg>
      <div className="flex-1 space-y-1.5 text-[11px]">
        {data.map((d) => (
          <div key={d.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-1.5 text-[var(--oms-text-muted)]">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color }} />
              {d.label}
            </span>
            <span className="whitespace-nowrap font-semibold text-[var(--oms-text)]">
              {(total > 0 ? (d.value / total) * 100 : 0).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export type LinePoint = { x: string; value: number };
export type LineSeriesDef = { name: string; color: string; points: LinePoint[] };

// Change-over-time (P&L by Month trend) — thin 2px lines on one shared INR
// axis, dot markers with native <title> tooltips, a zero baseline so
// negative months (net loss) read clearly.
export function LineChart({
  series,
  height = 200,
  width = 720,
  valueFormatter = (v: number) => v.toLocaleString("en-IN"),
}: {
  series: LineSeriesDef[];
  height?: number;
  width?: number;
  valueFormatter?: (v: number) => string;
}) {
  const n = series[0]?.points.length ?? 0;
  if (n === 0) {
    return <p className="text-xs text-[var(--oms-text-muted)]">No data yet.</p>;
  }
  const allValues = series.flatMap((s) => s.points.map((p) => p.value));
  const max = Math.max(0, ...allValues);
  const min = Math.min(0, ...allValues);
  const range = max - min || 1;
  const padL = 10;
  const padR = 10;
  const padT = 12;
  const padB = 22;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const xAt = (i: number) => padL + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yAt = (v: number) => padT + plotH - ((v - min) / range) * plotH;
  const zeroY = yAt(0);
  const tickEvery = Math.max(1, Math.ceil(n / 8));

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        style={{ minWidth: Math.max(360, n * 34) }}
        role="img"
        aria-label="Trend over time"
      >
        <line x1={padL} y1={zeroY} x2={width - padR} y2={zeroY} stroke="var(--oms-surface-border)" strokeWidth={1} />
        {series.map((s) => {
          const d = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i)},${yAt(p.value)}`).join(" ");
          return (
            <g key={s.name}>
              <path d={d} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              {s.points.map((p, i) => (
                <circle key={p.x + i} cx={xAt(i)} cy={yAt(p.value)} r={3} fill={s.color}>
                  <title>{`${s.name} · ${p.x}: ${valueFormatter(p.value)}`}</title>
                </circle>
              ))}
            </g>
          );
        })}
        {series[0]?.points.map(
          (p, i) =>
            i % tickEvery === 0 && (
              <text key={p.x} x={xAt(i)} y={height - 6} fontSize={9} textAnchor="middle" fill="var(--oms-text-muted)">
                {p.x}
              </text>
            ),
        )}
      </svg>
      <div className="mt-2 flex flex-wrap gap-3 text-[11px]">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full" style={{ background: s.color }} />
            <span className="text-[var(--oms-text-muted)]">{s.name}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
