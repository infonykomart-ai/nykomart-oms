"use client";

// 2026-11-21 — the advertisement sheet from the user's screenshots, generated
// from OUR data for every store (and every Amazon marketplace country):
// organic sales on the left, ad-platform numbers on the right. The numbers
// come from daily-ad-report.ts (pure), which page.tsx feeds with the scope's
// spend rows + orders — so this component never fetches and never guesses.
//
// 2026-11-21 (part 2) — it is now its own tab (right of the Daily Order
// Sheet) instead of living under the Daily Entry form, and a login approved
// for the complete report (ad_spend_report_all — MD/Admin/Finance) also gets
// an "All stores" view: one total line per store plus the grand total.
// Everyone else only ever receives their own stores from page.tsx
// (storesForAdSpend), so nothing outside their Store Access can appear here.
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  buildDailyAdReport,
  buildStoreTotals,
  type DailyAdOrderRow,
  type DailyAdReportRow,
  type DailyAdReportStore,
  type DailyAdSpendRow,
  type DailyAdStoreTotal,
  type DailyAdTotals,
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

/** The value cells shared by the daily rows, the store total row and the
 *  grand total — same order as the sheet columns, so no figure can drift. */
function TotalCells({ t }: { t: DailyAdTotals }) {
  return (
    <>
      <td className={`${td} font-semibold text-slate-900`}>{n(t.totalOrders)}</td>
      <td className={`${td} font-semibold text-slate-900`}>{money(t.totalSpendUsd)}</td>
      <td className={`${td} font-semibold text-slate-900`}>{n(t.visits)}</td>
      <td className={`${td} font-semibold text-slate-900`}>{n(t.orders)}</td>
      <td className={`${td} font-semibold text-slate-900`}>{money(t.orderAmountUsd)}</td>
      <td className={`${td} font-semibold text-slate-900`}>{n(t.views)}</td>
      <td className={`${td} font-semibold text-slate-900`}>{n(t.clicks)}</td>
      <td className={`${td} font-semibold text-slate-900`}>{pct(t.ctr)}</td>
      <td className={`${td} font-semibold text-slate-900`}>{money(t.budgetUsd)}</td>
      <td className={`${td} font-semibold text-slate-900`}>{money(t.spendUsd)}</td>
      <td className={`${td} font-semibold text-slate-900`}>{money(t.revenueUsd)}</td>
      <td className={`${td} font-semibold text-slate-900`}>{n(t.adOrders)}</td>
    </>
  );
}

function Row({ r }: { r: DailyAdReportRow }) {
  return (
    <tr className={r.hasData ? "hover:bg-amber-50/40" : "text-slate-400"}>
      <td className="whitespace-nowrap px-2 py-1 text-left text-[11px] font-medium text-slate-700">{fmtDate(r.date)}</td>
      <TotalCells t={r} />
    </tr>
  );
}

/** Day-by-day sheet for one store (one country at a time for Amazon). */
function StoreSheet({ store }: { store: DailyAdReportStore }) {
  const [country, setCountry] = useState("");
  const group = store.groups.find((g) => g.countryCode === country) ?? store.groups[0];
  const rows = [...group.rows].reverse();

  return (
    <>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">{store.storeName}</h3>
        <p className="text-[11px] text-slate-400">{group.label}</p>
      </div>

      {store.isAmazon && store.groups.length > 1 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {store.groups.map((g) => {
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
              <TotalCells t={group.totals} />
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  );
}

/** All stores the login may see, one total line each, plus the grand total. */
function AllStoresTotals({ perStore, grand }: { perStore: DailyAdStoreTotal[]; grand: DailyAdTotals }) {
  return (
    <div className="max-h-[32rem] overflow-auto rounded-lg border border-slate-200">
      <table className="min-w-full border-collapse text-[11px]">
        <thead className="sticky top-0 z-10">
          <tr>
            <th rowSpan={2} className={`${th} bg-sky-100 text-left text-slate-600`}>STORE</th>
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
          {perStore.map((s) => (
            <tr key={s.storeId} className="hover:bg-amber-50/40">
              <td className="whitespace-nowrap px-2 py-1 text-left text-[11px] font-medium text-slate-900">{s.storeName}</td>
              <TotalCells t={s.totals} />
            </tr>
          ))}
        </tbody>
        <tfoot className="sticky bottom-0 bg-amber-50 font-semibold">
          <tr>
            <td className="whitespace-nowrap px-2 py-1.5 text-left text-[11px] text-amber-900">TOTAL — all stores</td>
            <TotalCells t={grand} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

const TOTAL = "__total__";

export function DailyAdReport({
  stores,
  spendRows,
  orderRows,
  today,
  canSeeAllStores = false,
  storeAccessHref = null,
}: {
  /** Already scoped server-side (storesForAdSpend): never another login's store. */
  stores: { id: string; name: string }[];
  spendRows: DailyAdSpendRow[];
  orderRows: DailyAdOrderRow[];
  /** Today in IST (YYYY-MM-DD), computed server-side. */
  today: string;
  /** MD/Admin/Finance (ad_spend_report_all) — unlocks the all-stores total. */
  canSeeAllStores?: boolean;
  /** Employees → Store Access link, only for logins allowed to open it. */
  storeAccessHref?: string | null;
}) {
  const report = useMemo(
    () => buildDailyAdReport({ stores, spendRows, orderRows, today, days: 30 }),
    [stores, spendRows, orderRows, today]
  );
  const withData = report.filter((s) => s.groups.length > 0);
  const totals = useMemo(() => buildStoreTotals(report), [report]);
  const totalView = canSeeAllStores && totals.perStore.length > 1;
  const [selected, setSelected] = useState<string>(totalView ? TOTAL : "");
  const active = withData.find((s) => s.storeId === selected) ?? null;
  const showTotal = totalView && (selected === TOTAL || !active);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-700">📋 Daily advertisement report</h2>
          <p className="text-[11px] text-slate-400">
            Last 30 days · organic sales from our orders (base PO = one order, PO-date day) + the ad numbers saved in the
            Daily Entry form. CTR is calculated, never typed.
          </p>
        </div>
        <p className="text-[11px] text-slate-400">
          {canSeeAllStores ? "All stores of your companies (complete report access)." : "Only the store(s) assigned to you."}
        </p>
      </div>

      {withData.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">
          No ad entry and no order in the last 30 days for your store(s) yet. Save a day in Daily Entry (or enter an order)
          and this sheet builds itself here.{" "}
          {storeAccessHref ? (
            <Link href={storeAccessHref} className="font-semibold text-amber-700 underline hover:text-amber-900">
              Store access assign karein (Employees → Store Access)
            </Link>
          ) : (
            "Agar aapke login par koi store nahi hai to Admin se Employees → Store Access me tick karwayein."
          )}
        </p>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {totalView && (
              <button
                type="button"
                onClick={() => setSelected(TOTAL)}
                className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold transition ${
                  showTotal
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-700 hover:border-slate-500 hover:bg-slate-50"
                }`}
              >
                🏢 All stores · TOTAL
              </button>
            )}
            {withData.map((s) => {
              const on = !showTotal && s.storeId === active?.storeId;
              return (
                <button
                  key={s.storeId}
                  type="button"
                  onClick={() => setSelected(s.storeId)}
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

          {showTotal ? (
            <AllStoresTotals perStore={totals.perStore} grand={totals.grand} />
          ) : active ? (
            <StoreSheet store={active} />
          ) : null}
        </>
      )}

      <p className="mt-2 text-[10px] text-slate-400">
        <b>TOTAL ORD</b> = organic orders + ad-platform attributed orders. <b>TOTAL SPEND</b> = the day&apos;s ad spend.
        Etsy revenue is the monthly figure from the entry form (latest saved), so it is shown, never summed.
      </p>
    </div>
  );
}
