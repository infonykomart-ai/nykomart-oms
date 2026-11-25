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
//
// 2026-11-21 (round 2) — the user asked for a MONTH selector ("AMAZO HO YA
// ETSY UNKO MONTH SELECT KARNE KA") and a corner TOTAL of everything ("SABHI
// KA TOTAL BHI AAJAYE TOTAL ORDER TOTAL ADD VAGERA"). Both are here, plus the
// follow-ups that make the sheet trustworthy: ROAS / ACoS, missing-entry
// alerts, budget pacing, data-quality flags, company roll-up, CSV export and
// a print view. The sheet's own columns stay exactly the user's format.
import { Fragment, useActionState, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { saveAdSpendTargetsAction, type AdSpendFormState } from "./actions";
import { amazonCountryLabel } from "./amazon-countries";
import {
  buildDailyAdReport,
  buildStoreTotals,
  monthLabel,
  type DailyAdOrderRow,
  type DailyAdReportStore,
  type DailyAdSpendRow,
  type DailyAdStoreTotal,
  type DailyAdTarget,
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

function roasText(value: number): string {
  const v = Number(value ?? 0);
  return v > 0 ? `${v.toFixed(2)}x` : "—";
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

function SheetHead() {
  return (
    <>
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
    </>
  );
}

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
        <div className="mb-2 flex flex-wrap gap-1.5 print:hidden">
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

      <div className="max-h-[32rem] overflow-auto rounded-lg border border-slate-200 print:max-h-none print:overflow-visible">
        <table className="min-w-full border-collapse text-[11px]">
          <SheetHead />
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.date} className={r.hasData ? "hover:bg-amber-50/40" : "text-slate-400"}>
                <td className="whitespace-nowrap px-2 py-1 text-left text-[11px] font-medium text-slate-700">{fmtDate(r.date)}</td>
                <TotalCells t={r} />
              </tr>
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

      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-slate-500 print:hidden">
        <span className="rounded bg-slate-50 px-2 py-1 ring-1 ring-slate-200">ROAS <b className="text-slate-800">{roasText(store.totals.roas)}</b></span>
        <span className="rounded bg-slate-50 px-2 py-1 ring-1 ring-slate-200">ACoS <b className="text-slate-800">{store.totals.revenueUsd > 0 ? pct(store.totals.acos) : "—"}</b></span>
        {store.target.roasTarget !== null && (
          <span
            className={`rounded px-2 py-1 ring-1 ${
              store.totals.roas >= store.target.roasTarget
                ? "bg-emerald-50 text-emerald-800 ring-emerald-200"
                : "bg-red-50 text-red-700 ring-red-200"
            }`}
          >
            target {store.target.roasTarget.toFixed(2)}x
          </span>
        )}
      </div>
    </>
  );
}

/** All stores, grouped by company (MD sees a subtotal per company) with the
 *  grand total at the bottom. */
function AllStoresTotals({ perStore, grand }: { perStore: DailyAdStoreTotal[]; grand: DailyAdTotals }) {
  const byCompany = new Map<string, DailyAdStoreTotal[]>();
  for (const s of perStore) {
    const key = s.companyName || "—";
    const list = byCompany.get(key) ?? [];
    list.push(s);
    byCompany.set(key, list);
  }
  const companies = [...byCompany.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="max-h-[32rem] overflow-auto rounded-lg border border-slate-200 print:max-h-none print:overflow-visible">
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
          {companies.map(([company, list]) => (
            <Fragment key={company}>
              <tr className="bg-slate-50">
                <td colSpan={13} className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {company}
                </td>
              </tr>
              {list.map((s) => (
                <tr key={s.storeId} className="hover:bg-amber-50/40">
                  <td className="whitespace-nowrap px-2 py-1 text-left text-[11px] font-medium text-slate-900">{s.storeName}</td>
                  <TotalCells t={s.totals} />
                </tr>
              ))}
            </Fragment>
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

/**
 * The corner TOTAL panel.
 *
 * 2026-11-25 — it now follows the selection. It used to be handed
 * `totals.grand` unconditionally with the fixed heading "Total — all stores",
 * so picking a store changed the table below while this panel kept showing
 * every store's combined figures — the exact bug reported against the
 * screenshot. "All stores · TOTAL" still shows the combined figures; any
 * individual store shows that store's own totals, which for an Amazon store
 * already include every one of its marketplace countries.
 */
function CornerTotal({ grand, title, note }: { grand: DailyAdTotals; title: string; note: string }) {
  const cells: { label: string; value: string }[] = [
    { label: "TOTAL ORDER", value: n(grand.totalOrders) },
    { label: "TOTAL SPEND", value: money(grand.totalSpendUsd) },
    { label: "ORD AMT", value: money(grand.orderAmountUsd) },
    { label: "BUDGET", value: money(grand.budgetUsd) },
    { label: "AD SPEND", value: money(grand.spendUsd) },
    { label: "AD REVENUE", value: money(grand.revenueUsd) },
    { label: "AD ORDER", value: n(grand.adOrders) },
    { label: "VIEWS", value: n(grand.views) },
    { label: "CLICKS", value: n(grand.clicks) },
    { label: "CTR", value: pct(grand.ctr) },
    { label: "ROAS", value: roasText(grand.roas) },
    { label: "ACoS", value: grand.revenueUsd > 0 ? pct(grand.acos) : "—" },
  ];
  return (
    <div className="rounded-xl border-2 border-slate-900 bg-slate-900 p-3 text-white print:border-slate-300 print:bg-white print:text-slate-900">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide">{title}</h3>
        <span className="text-[10px] opacity-70">{note} · all figures in USD</span>
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 sm:grid-cols-4">
        {cells.map((c) => (
          <div key={c.label}>
            <div className="text-[9px] uppercase tracking-wide opacity-70">{c.label}</div>
            <div className="text-sm font-bold tabular-nums">{c.value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PacingCard({ stores }: { stores: DailyAdReportStore[] }) {
  const paced = stores.filter((s) => s.pacing !== null);
  if (paced.length === 0) return null;
  const budget = paced.reduce((sum, s) => sum + (s.pacing?.monthBudgetUsd ?? 0), 0);
  const spend = paced.reduce((sum, s) => sum + (s.pacing?.spendUsd ?? 0), 0);
  const expected = paced.reduce((sum, s) => sum + (s.pacing?.expectedToDateUsd ?? 0), 0);
  const projected = paced.reduce((sum, s) => sum + (s.pacing?.projectedUsd ?? 0), 0);
  const over = paced.some((s) => s.pacing?.overBudget);
  const ratio = expected > 0 ? (spend * 100) / expected : 0;
  return (
    <div className={`rounded-xl border p-3 text-xs ${over ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"}`}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h3 className="font-semibold text-slate-800">Budget pacing</h3>
        <span className={`font-semibold ${over ? "text-red-700" : "text-emerald-700"}`}>
          {expected > 0 ? `${ratio.toFixed(0)}% of expected` : "—"}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white ring-1 ring-slate-200">
        <div
          className={`h-full ${over ? "bg-red-500" : "bg-emerald-500"}`}
          style={{ width: `${Math.min(100, Math.max(0, expected > 0 ? (spend * 100) / expected : 0))}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] text-slate-600">
        Budget <b>{money(budget)}</b> · spent <b>{money(spend)}</b> · expected by now <b>{money(expected)}</b> · month-end
        projection <b>{money(projected)}</b>
      </p>
      {over && <p className="mt-1 font-semibold text-red-700">⚠ This pace will exceed the month budget.</p>}
    </div>
  );
}

const initialTargetState: AdSpendFormState = { error: null, success: false };

function TargetsPanel({
  stores,
  targets,
}: {
  stores: { id: string; name: string }[];
  targets: Record<string, DailyAdTarget>;
}) {
  const [state, formAction, pending] = useActionState(saveAdSpendTargetsAction, initialTargetState);
  return (
    <details className="mt-3 rounded-xl border border-slate-200 bg-white p-3 print:hidden">
      <summary className="cursor-pointer text-xs font-semibold text-slate-600">
        🎯 Month budget &amp; ROAS target per store (admin)
      </summary>
      <form action={formAction} className="mt-3 space-y-2">
        {state.error && <p className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{state.error}</p>}
        {state.success && <p className="rounded bg-emerald-50 px-2 py-1 text-xs text-emerald-700">Targets saved.</p>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {stores.map((s) => {
            const t = targets[s.id];
            return (
              <div key={s.id} className="rounded-lg border border-slate-200 p-2">
                <div className="mb-1 truncate text-xs font-medium text-slate-700">{s.name}</div>
                <div className="grid grid-cols-2 gap-1.5">
                  <label className="text-[10px] text-slate-500">
                    Monthly budget ($)
                    <input
                      name={`budget_${s.id}`}
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={t?.monthlyBudgetUsd ?? ""}
                      placeholder="—"
                      className="mt-0.5 w-full rounded border border-slate-300 px-1.5 py-1 text-xs"
                    />
                  </label>
                  <label className="text-[10px] text-slate-500">
                    ROAS target (x)
                    <input
                      name={`roas_${s.id}`}
                      type="number"
                      step="0.01"
                      min="0"
                      defaultValue={t?.roasTarget ?? ""}
                      placeholder="—"
                      className="mt-0.5 w-full rounded border border-slate-300 px-1.5 py-1 text-xs"
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save targets"}
        </button>
        <p className="text-[10px] text-slate-400">Blank clears the target.</p>
      </form>
    </details>
  );
}

const TOTAL = "__total__";

function csvCell(value: string | number): string {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function DailyAdReport({
  stores,
  spendRows,
  orderRows,
  dates,
  month,
  range = null,
  monthOptions,
  targets = {},
  initialStore = "",
  canSeeAllStores = false,
  canEditTargets = false,
  storeAccessHref = null,
}: {
  /** Already scoped server-side (storesForAdSpend): never another login's store. */
  stores: { id: string; name: string; company_id?: string; companyName?: string }[];
  spendRows: DailyAdSpendRow[];
  orderRows: DailyAdOrderRow[];
  /** The selected range's dates (current month stops at today). */
  dates: string[];
  /** YYYY-MM — the month view's month (also the fallback when a range is on). */
  month: string;
  /** 7 / 30 / 90 rolling days; null = calendar month. */
  range?: number | null;
  /** The last 12 months, oldest first. */
  monthOptions: string[];
  /** store_ad_targets, per store. */
  targets?: Record<string, DailyAdTarget>;
  /** Deep link (?store=…) — only a store inside the scope is honoured. */
  initialStore?: string;
  /** MD/Admin/Finance (ad_spend_report_all) — unlocks the all-stores total. */
  canSeeAllStores?: boolean;
  canEditTargets?: boolean;
  /** Employees → Store Access link, only for logins allowed to open it. */
  storeAccessHref?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startNav] = useTransition();

  const report = useMemo(
    () => buildDailyAdReport({ stores, spendRows, orderRows, dates, targets }),
    [stores, spendRows, orderRows, dates, targets]
  );
  const withData = report.filter((s) => s.groups.length > 0);
  const totals = useMemo(() => buildStoreTotals(report), [report]);
  const totalView = canSeeAllStores && totals.perStore.length > 1;
  const [selected, setSelected] = useState<string>(
    initialStore && withData.some((s) => s.storeId === initialStore) ? initialStore : totalView ? TOTAL : ""
  );
  const active = withData.find((s) => s.storeId === selected) ?? null;
  const showTotal = totalView && (selected === TOTAL || !active);

  function navigate(nextMonth: string, nextStore: string, nextRange: number | null = range) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "daily");
    params.set("month", nextMonth);
    // A range and a month are exclusive: picking a month clears the range.
    if (nextRange) params.set("range", String(nextRange));
    else params.delete("range");
    if (nextStore && nextStore !== TOTAL) params.set("store", nextStore);
    else params.delete("store");
    startNav(() => router.replace(`${pathname}?${params.toString()}`, { scroll: false }));
  }

  // What the corner TOTAL panel shows: every store, or the selected store.
  const panelTotals = showTotal || !active ? totals.grand : active.totals;
  const panelTitle = showTotal || !active ? "Total — all stores" : active.storeName;
  const countryCount = active ? active.groups.filter((g) => g.countryCode).length : 0;
  const panelNote =
    showTotal || !active ? "selected range" : countryCount > 1 ? `all ${countryCount} Amazon countries` : "selected range";

  const periodLabel = range
    ? `Last ${range} days · ${dates.length > 0 ? `${fmtDate(dates[0])} – ${fmtDate(dates[dates.length - 1])}` : "—"}`
    : monthLabel(month);

  const anomalies = (showTotal ? report : active ? [active] : []).flatMap((s) =>
    s.anomalies.map((a) => ({ ...a, storeName: s.storeName }))
  );
  const missing = (showTotal ? withData : active ? [active] : []).filter((s) => s.missingEntryDates.length > 0);
  const missingDays = missing.reduce((sum, s) => sum + s.missingEntryDates.length, 0);

  function downloadCsv() {
    const head = [
      "DATE",
      "TOTAL ORD",
      "TOTAL SPEND",
      "VISIT",
      "ORDER",
      "ORD AMT",
      "VIEWS",
      "CLICKS",
      "CTR %",
      "BUDGET",
      "SPEND",
      "REVENUE",
      "AD ORDER",
      "ROAS",
      "ACOS %",
    ];
    const lines: string[] = [];
    if (showTotal) {
      lines.push(["STORE", ...head].map(csvCell).join(","));
      for (const s of totals.perStore) {
        const t = s.totals;
        lines.push(
          [
            s.storeName,
            "TOTAL",
            t.totalOrders,
            t.totalSpendUsd.toFixed(2),
            t.visits,
            t.orders,
            t.orderAmountUsd.toFixed(2),
            t.views,
            t.clicks,
            t.ctr.toFixed(2),
            t.budgetUsd.toFixed(2),
            t.spendUsd.toFixed(2),
            t.revenueUsd.toFixed(2),
            t.adOrders,
            t.roas.toFixed(2),
            t.acos.toFixed(2),
          ].map(csvCell).join(",")
        );
      }
      const g = totals.grand;
      lines.push(
        [
          "ALL STORES",
          "TOTAL",
          g.totalOrders,
          g.totalSpendUsd.toFixed(2),
          g.visits,
          g.orders,
          g.orderAmountUsd.toFixed(2),
          g.views,
          g.clicks,
          g.ctr.toFixed(2),
          g.budgetUsd.toFixed(2),
          g.spendUsd.toFixed(2),
          g.revenueUsd.toFixed(2),
          g.adOrders,
          g.roas.toFixed(2),
          g.acos.toFixed(2),
        ].map(csvCell).join(",")
      );
    } else if (active) {
      // 2026-11-25 — the selected store's CSV used to write `groups[0]` only,
      // so an Amazon store's other marketplace countries silently vanished
      // from the file. Every group is exported now, tagged with its country,
      // followed by that country's subtotal and the store's own total.
      const multiCountry = active.groups.length > 1;
      lines.push([...(multiCountry ? ["COUNTRY"] : []), ...head].map(csvCell).join(","));
      const rowLine = (prefix: string[], r: (typeof active.groups)[number]["rows"][number]) =>
        [
          ...prefix,
          r.date,
          r.totalOrders,
          r.totalSpendUsd.toFixed(2),
          r.visits,
          r.orders,
          r.orderAmountUsd.toFixed(2),
          r.views,
          r.clicks,
          r.ctr.toFixed(2),
          r.budgetUsd.toFixed(2),
          r.spendUsd.toFixed(2),
          r.revenueUsd.toFixed(2),
          r.adOrders,
          r.roas.toFixed(2),
          r.acos.toFixed(2),
        ].map(csvCell).join(",");
      const totalLine = (label: string, prefix: string[], t: DailyAdTotals) =>
        [
          ...prefix,
          label,
          t.totalOrders,
          t.totalSpendUsd.toFixed(2),
          t.visits,
          t.orders,
          t.orderAmountUsd.toFixed(2),
          t.views,
          t.clicks,
          t.ctr.toFixed(2),
          t.budgetUsd.toFixed(2),
          t.spendUsd.toFixed(2),
          t.revenueUsd.toFixed(2),
          t.adOrders,
          t.roas.toFixed(2),
          t.acos.toFixed(2),
        ].map(csvCell).join(",");
      for (const group of active.groups) {
        const prefix = multiCountry
          ? [group.countryCode ? amazonCountryLabel(group.countryCode) || group.countryCode : "—"]
          : [];
        for (const r of group.rows) lines.push(rowLine(prefix, r));
        lines.push(totalLine(multiCountry ? "SUBTOTAL" : "TOTAL", prefix, group.totals));
      }
      if (multiCountry) lines.push(totalLine("TOTAL", ["ALL COUNTRIES"], active.totals));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ad-report-${range ? `last-${range}d` : month}${
      showTotal || !active ? "-all" : `-${active.storeName.replace(/[^a-z0-9]+/gi, "-")}`
    }.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3 print:bg-white">
      {/* 2026-11-25 — the printed / PDF copy: white page, A4 portrait, no
          app chrome (the buttons and chips below are print:hidden), and the
          selected store's own table — the same totals the screen shows. */}
      <style>{`@media print {
        @page { size: A4 portrait; margin: 10mm; }
        html, body { background: #fff !important; }
        .shadow, .shadow-sm, .shadow-md, .shadow-lg { box-shadow: none !important; }
      }`}</style>
      <div className="rounded-xl border border-slate-200 bg-white p-4 print:border-0 print:p-0">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-semibold text-slate-700">📋 Daily advertisement report</h2>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
              {periodLabel}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <label className="text-[11px] font-medium text-slate-500" htmlFor="daily_month">
              Month
            </label>
            <select
              id="daily_month"
              value={range ? "" : month}
              onChange={(e) => navigate(e.target.value, selected, null)}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-800"
            >
              {range && <option value="" disabled>Last {range} days</option>}
              {monthOptions.map((m) => (
                <option key={m} value={m}>
                  {monthLabel(m)}
                </option>
              ))}
            </select>
            {/* 2026-11-21 (round 3) — rolling windows share the same sheet; the
                month dropdown switches back to a calendar month. */}
            <div className="flex overflow-hidden rounded-lg border border-slate-300 bg-white">
              {[7, 30, 90].map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => navigate(month, selected, r)}
                  className={`px-2 py-1 text-xs transition ${
                    range === r ? "bg-amber-500 font-semibold text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                  title={`Last ${r} days`}
                >
                  {r}d
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={downloadCsv}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              ⬇ CSV
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              🖨 Print
            </button>
          </div>
        </div>

        {/* The summary follows the selection; an Amazon store's totals already
            combine every one of its marketplace countries. */}
        <CornerTotal grand={panelTotals} title={panelTitle} note={panelNote} />

        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {/* Pacing is month-budget based, so a rolling window never shows it. */}
          {!range && <PacingCard stores={showTotal ? withData : active ? [active] : []} />}
          {(missing.length > 0 || anomalies.length > 0) && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs">
              {missing.length > 0 && (
                <p className="font-semibold text-amber-800">
                  ⚠ {missingDays} day(s) missing an ad entry — orders exist but no spend was entered (
                  {missing.map((s) => s.storeName).join(", ")}).
                </p>
              )}
              {anomalies.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-[11px] text-amber-900">
                  {anomalies.slice(0, 6).map((a) => (
                    <li key={`${a.storeName}-${a.date}-${a.kind}`}>
                      • <b>{a.storeName}</b> {fmtDate(a.date)} — {a.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>

        {withData.length === 0 ? (
          <p className="mt-3 rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-500">
            No ad entry or order found for {periodLabel}.{" "}
            {storeAccessHref ? (
              <Link href={storeAccessHref} className="font-semibold text-amber-700 underline hover:text-amber-900">
                Assign store access (Employees → Store Access)
              </Link>
            ) : (
              "Ask an Admin to tick your store under Employees → Store Access."
            )}
          </p>
        ) : (
          <>
            <div className="mt-3 flex flex-wrap gap-1.5 print:hidden">
              {totalView && (
                <button
                  type="button"
                  onClick={() => {
                    setSelected(TOTAL);
                    navigate(month, TOTAL, range);
                  }}
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
                    onClick={() => {
                      setSelected(s.storeId);
                      navigate(month, s.storeId, range);
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

            <div className="mt-2">
              {showTotal ? (
                <AllStoresTotals perStore={totals.perStore} grand={totals.grand} />
              ) : active ? (
                <StoreSheet store={active} />
              ) : null}
            </div>
          </>
        )}

        {canEditTargets && <TargetsPanel stores={withData.map((s) => ({ id: s.storeId, name: s.storeName }))} targets={targets} />}

      </div>
    </div>
  );
}
