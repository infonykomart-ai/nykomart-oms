"use client";

// 2026-11-21 — the advertisement sheet from the user's screenshots, generated
// from OUR data for every store (and every Amazon marketplace country):
// organic sales on the left, ad-platform numbers on the right. The numbers
// come from daily-ad-report.ts (pure), which page.tsx feeds with the scope's
// spend rows + orders — so this component never fetches and never guesses.
import { useMemo, useState } from "react";
import {
  buildDailyAdReport,
  type DailyAdOrderRow,
  type DailyAdReportRow,
  type DailyAdSpendRow,
} from "./daily-ad-report";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${MONTHS[Number(m) - 1] ?? m}-${y}`;
}

function n(value: number): string {
  return Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function money(value: number): string {
  return `$${Number(value ?? 0).toFixed(2)}`;
}

function pct(value: number): string {
  return `${Number(value ?? 0).toFixed(2)}%`;
}

const th = "whitespace-nowrap px-2 py-1.5 text-right text-[11px] font-semibold";
const td = "whitespace-nowrap px-2 py-1 text-right text-[11px] text-slate-700";

function Row({ r }: { r: DailyAdReportRow }) {
  return (
    <tr className={r.hasData ? "hover:bg-amber-50/40" : "text-slate-400"}>
      <td className="whitespace-nowrap px-2 py-1 text-left text-[11px] font-medium text-slate-700">{fmtDate(r.date)}</td>
      <td className={`${td} font-semibold text-slate-900`}>{n(r.totalOrders)}</td>
      <td className={`${td} font-semibold text-slate-900`}>{money(r.totalSpendUsd)}</td>
      <td className={td}>{n(r.visits)}</td>
      <td className={td}>{n(r.orders)}</td>
      <td className={td}>{money(r.orderAmountUsd)}</td>
      <td className={td}>{n(r.views)}</td>
      <td className={td}>{n(r.clicks)}</td>
      <td className={td}>{pct(r.ctr)}</td>
      <td className={td}>{money(r.budgetUsd)}</td>
      <td className={td}>{money(r.spendUsd)}</td>
      <td className={td}>{money(r.revenueUsd)}</td>
      <td className={td}>{n(r.adOrders)}</td>
    </tr>
  );
}

export function DailyAdReport({
  stores,
  spendRows,
  orderRows,
  today,
}: {
  stores: { id: string; name: string }[];
  spendRows: DailyAdSpendRow[];
  orderRows: DailyAdOrderRow[];
  /** Today in IST (YYYY-MM-DD), computed server-side. */
  today: string;
}) {
  const report = useMemo(
    () => buildDailyAdReport({ stores, spendRows, orderRows, today, days: 30 }),
    [stores, spendRows, orderRows, today]
  );
  const withData = report.filter((s) => s.groups.length > 0);
  const [storeId, setStoreId] = useState("");
  const [country, setCountry] = useState("");
  const active = withData.find((s) => s.storeId === storeId) ?? withData[0] ?? null;

  if (!active) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 print:hidden">
        <h2 className="text-sm font-semibold text-slate-700">📋 Daily advertisement report</h2>
        <p className="mt-2 text-xs text-slate-400">
          No ad entry and no order in the last 30 days for your store(s) yet. Save a day above (or enter an order) and
          the store-wise sheet will build itself here.
        </p>
      </div>
    );
  }

  const group = active.groups.find((g) => g.countryCode === country) ?? active.groups[0];
  const rows = [...group.rows].reverse();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 print:hidden">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">📋 Daily advertisement report — {active.storeName}</h2>
          <p className="text-[11px] text-slate-400">
            Last 30 days · organic sales from our orders (base PO = one order, PO-date day) + the ad numbers saved in the
            entry form. CTR is calculated, never typed.
          </p>
        </div>
        <p className="text-[11px] text-slate-400">{group.label}</p>
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {withData.map((s) => {
          const on = s.storeId === active.storeId;
          return (
            <button
              key={s.storeId}
              type="button"
              onClick={() => {
                setStoreId(s.storeId);
                setCountry("");
              }}
              className={`rounded-full border px-2.5 py-0.5 text-xs font-medium transition ${
                on
                  ? "border-amber-500 bg-amber-500 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:border-amber-300 hover:bg-amber-50"
              }`}
            >
              {s.storeName}
            </button>
          );
        })}
      </div>

      {active.isAmazon && active.groups.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {active.groups.map((g) => {
            const on = g.countryCode === group.countryCode;
            return (
              <button
                key={g.countryCode || "all"}
                type="button"
                onClick={() => setCountry(g.countryCode)}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] transition ${
                  on
                    ? "border-emerald-600 bg-emerald-600 text-white"
                    : "border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
                }`}
              >
                {g.label} · {n(g.totals.totalOrders)} ord
              </button>
            );
          })}
        </div>
      )}

      <div className="max-h-[32rem] overflow-auto rounded-lg border border-slate-200">
        <table className="min-w-full border-collapse text-[11px]">
          <thead className="sticky top-0 z-10">
            <tr>
              <th rowSpan={2} className={`${th} bg-sky-100 text-left text-slate-600`}>DATE</th>
              <th rowSpan={2} className={`${th} bg-sky-100 text-slate-600`}>TOTAL ORD</th>
              <th rowSpan={2} className={`${th} bg-sky-100 text-slate-600`}>TOTAL SPEND ($)</th>
              <th colSpan={3} className={`${th} border-l border-white bg-sky-200 text-center text-sky-900`}>
                ORGANIC REPORT
              </th>
              <th colSpan={7} className={`${th} border-l border-white bg-emerald-200 text-center text-emerald-900`}>
                ADVERTISEMENT REPORT
              </th>
            </tr>
            <tr>
              <th className={`${th} border-l border-white bg-sky-100 text-sky-900`}>VISIT</th>
              <th className={`${th} bg-sky-100 text-sky-900`}>ORDER</th>
              <th className={`${th} bg-sky-100 text-sky-900`}>ORD AMT</th>
              <th className={`${th} border-l border-white bg-emerald-100 text-emerald-900`}>VIEWS</th>
              <th className={`${th} bg-emerald-100 text-emerald-900`}>CLICKS</th>
              <th className={`${th} bg-emerald-100 text-emerald-900`}>CTR</th>
              <th className={`${th} bg-emerald-100 text-emerald-900`}>BUDGET</th>
              <th className={`${th} bg-emerald-100 text-emerald-900`}>SPEND ($)</th>
              <th className={`${th} bg-emerald-100 text-emerald-900`}>REVENUE</th>
              <th className={`${th} bg-emerald-100 text-emerald-900`}>AD ORDER</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <Row key={r.date} r={r} />
            ))}
          </tbody>
          <tfoot className="sticky bottom-0 bg-slate-50 font-semibold">
            <tr>
              <td className="whitespace-nowrap px-2 py-1.5 text-left text-[11px] text-slate-600">TOTAL</td>
              <td className={`${td} font-semibold text-slate-900`}>{n(group.totals.totalOrders)}</td>
              <td className={`${td} font-semibold text-slate-900`}>{money(group.totals.totalSpendUsd)}</td>
              <td className={`${td} font-semibold text-slate-900`}>{n(group.totals.visits)}</td>
              <td className={`${td} font-semibold text-slate-900`}>{n(group.totals.orders)}</td>
              <td className={`${td} font-semibold text-slate-900`}>{money(group.totals.orderAmountUsd)}</td>
              <td className={`${td} font-semibold text-slate-900`}>{n(group.totals.views)}</td>
              <td className={`${td} font-semibold text-slate-900`}>{n(group.totals.clicks)}</td>
              <td className={`${td} font-semibold text-slate-900`}>{pct(group.totals.ctr)}</td>
              <td className={`${td} font-semibold text-slate-900`}>{money(group.totals.budgetUsd)}</td>
              <td className={`${td} font-semibold text-slate-900`}>{money(group.totals.spendUsd)}</td>
              <td className={`${td} font-semibold text-slate-900`}>{money(group.totals.revenueUsd)}</td>
              <td className={`${td} font-semibold text-slate-900`}>{n(group.totals.adOrders)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="mt-2 text-[10px] text-slate-400">
        <b>TOTAL ORD</b> = organic orders + ad-platform attributed orders. <b>TOTAL SPEND</b> = the day&apos;s ad spend.
        Etsy revenue is the monthly figure from the entry form (latest saved), so it is shown, never summed.
      </p>
    </div>
  );
}
