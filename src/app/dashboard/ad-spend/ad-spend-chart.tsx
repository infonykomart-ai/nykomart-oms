"use client";

// 2026-11-21 — "ACHA SA CHART BHI BAN JAYE": the Daily Entry tab's chart for
// the marketplace numbers typed for the selected store. One small bar row per
// metric (each scaled to its own maximum, so 20 clicks and 20,000 impressions
// are both readable in the same card), plus the derived CTR% row for
// Amazon/eBay and the Etsy monthly spend % tile.
//
// Reads the same channel-metrics.ts helpers the save action uses, so the
// chart can never disagree with what was saved. Historical rows come from
// page.tsx (last 14 days for the login's stores); this component only picks
// the selected store out of them.

import {
  channelPointsFor,
  compact,
  monthSpendFor,
  monthlySpendPct,
  type ChannelMetricRow,
  type StoreChannel,
} from "./channel-metrics";

type Series = {
  key: "clicks" | "impressions" | "visits" | "etsyVisitsDaily" | "etsyVisitsMonthly" | "etsyRevenueUsd" | "etsyAdClicks";
  label: string;
  bar: string;
  money?: boolean;
  percent?: boolean;
};

function seriesFor(channel: StoreChannel): Series[] {
  if (channel === "etsy") {
    return [
      { key: "etsyVisitsDaily", label: "Visits (daily)", bar: "bg-sky-500" },
      { key: "etsyAdClicks", label: "Ads clicks", bar: "bg-amber-500" },
      { key: "etsyVisitsMonthly", label: "Visits (monthly)", bar: "bg-violet-500" },
      { key: "etsyRevenueUsd", label: "Revenue (USD, monthly)", bar: "bg-emerald-500", money: true },
    ];
  }
  if (channel === "ebay") {
    return [
      { key: "clicks", label: "Clicks", bar: "bg-amber-500" },
      { key: "impressions", label: "Impressions", bar: "bg-sky-500" },
      { key: "visits", label: "Visits", bar: "bg-emerald-500" },
    ];
  }
  if (channel === "amazon") {
    return [
      { key: "clicks", label: "Clicks", bar: "bg-amber-500" },
      { key: "impressions", label: "Impressions / Views", bar: "bg-sky-500" },
      { key: "visits", label: "Visiting", bar: "bg-emerald-500" },
    ];
  }
  return [];
}

function formatValue(value: number, series: Series): string {
  if (series.money) return `$${value.toFixed(2)}`;
  if (series.percent) return `${value.toFixed(2)}%`;
  return compact(value);
}

export function ChannelChart({
  storeId,
  storeName,
  channel,
  month,
  rows,
}: {
  storeId: string;
  storeName: string;
  channel: StoreChannel;
  /** YYYY-MM of the entry form's month (Etsy monthly spend %). */
  month: string;
  rows: ChannelMetricRow[];
}) {
  const points = channelPointsFor(rows, storeId);
  const series = seriesFor(channel);
  const monthSpend = monthSpendFor(rows, storeId, month);
  const latestRevenue = points.length ? points[points.length - 1].etsyRevenueUsd : 0;
  const spendPct = monthlySpendPct(monthSpend, latestRevenue);

  if (!points.length || series.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 print:hidden">
        <h2 className="text-sm font-semibold text-slate-700">📊 Channel trend — {storeName}</h2>
        <p className="mt-2 text-xs text-slate-400">
          {series.length === 0
            ? "This store is not an Amazon / Etsy / eBay store, so it has no marketplace channel metrics."
            : "No channel numbers recorded for this store yet. Save a day above and the last 14 days will chart here."}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 print:hidden">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">📊 Channel trend — {storeName}</h2>
        <p className="text-[11px] text-slate-400">Last {points.length} day(s) with an entry</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {series.map((s) => {
          const values = points.map((p) => Number(p[s.key] ?? 0));
          const max = Math.max(1, ...values);
          const total = values.reduce((a, b) => a + b, 0);
          return (
            <div key={s.key} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{s.label}</span>
                <span className="text-xs font-bold text-slate-800">{formatValue(total, s)}</span>
              </div>
              <div className="mt-2 flex h-16 items-end gap-0.5">
                {points.map((p) => {
                  const value = Number(p[s.key] ?? 0);
                  const height = Math.max(value > 0 ? 6 : 2, Math.round((value / max) * 100));
                  return (
                    <div
                      key={p.date}
                      title={`${p.date} — ${s.label}: ${formatValue(value, s)}`}
                      className={`min-w-[3px] flex-1 rounded-sm ${value > 0 ? s.bar : "bg-slate-200"}`}
                      style={{ height: `${height}%` }}
                    />
                  );
                })}
              </div>
              <div className="mt-1 flex justify-between text-[9px] text-slate-400">
                <span>{points[0].date.slice(5)}</span>
                <span>{points[points.length - 1].date.slice(5)}</span>
              </div>
            </div>
          );
        })}

        {channel !== "etsy" && (
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">CTR %</span>
              <span className="text-xs font-bold text-slate-800">
                {points[points.length - 1].ctr.toFixed(2)}%
              </span>
            </div>
            <p className="mt-2 text-[10px] leading-snug text-slate-400">
              Clicks ÷ Impressions × 100, per day. 0 when there were no impressions — never blank, never
              divided by zero.
            </p>
            <div className="mt-1 flex flex-wrap gap-1">
              {points.slice(-5).map((p) => (
                <span key={p.date} className="rounded bg-white px-1.5 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-200">
                  {p.date.slice(5)} · {p.ctr.toFixed(1)}%
                </span>
              ))}
            </div>
          </div>
        )}

        {channel === "etsy" && (
          <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Monthly spend % of revenue
              </span>
              <span className="text-xs font-bold text-slate-800">{spendPct === null ? "—" : `${spendPct.toFixed(1)}%`}</span>
            </div>
            <p className="mt-2 text-[10px] leading-snug text-slate-400">
              This month&apos;s spend (${monthSpend.toFixed(2)}) ÷ the revenue entered for the month. A dash
              means no revenue was recorded.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
