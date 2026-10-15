"use client";

import Link from "next/link";
import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";
import { PrintArea } from "@/components/print-view";
import { verifyStatus, verifyText } from "./ad-spend-stats";
// 2026-10-15b — "TOTAL BUDGET KITNA HUA ... SPEND KITNA HUA ... ACTUAL
// CONVERSION KE HISAB SE": the Amazon Country section's totals are shown in
// USD *and* converted to INR at the live rate (src/lib/fx/rates.ts keeps the
// cached snapshot at most 12 hours old by itself; this button is the manual
// refresh).
import { formatUsdToInr, type FxSnapshot } from "@/lib/fx/rates";
import { refreshFxRatesAction } from "./actions";

/** Statement verification for one (store, country) row of the month — see
 *  ad-spend-stats.ts's buildAdSpendReport for how `matched` is derived
 *  (orders whose marketplace order no. was actually found in that store's
 *  imported statement). */
export type AdSpendStatementVerify = { matched: number; total: number };

export type AdSpendDailyRow = {
  storeId: string;
  storeName: string;
  companyName: string;
  /** '' for every non-Amazon store; the Amazon marketplace code otherwise. */
  countryCode: string;
  countryLabel: string;
  date: string;
  qty: number;
  usd: number;
  budget: number;
  spend: number;
  verify: AdSpendStatementVerify;
};

export type AdSpendMonthlyRow = {
  storeId: string;
  storeName: string;
  companyName: string;
  countryCode: string;
  countryLabel: string;
  qty: number;
  usd: number;
  avg: number;
  budget: number;
  spend: number;
  verify: AdSpendStatementVerify;
};

/** One row of the Amazon-only Country section. */
export type AdSpendAmazonCountryRow = {
  storeId: string;
  storeName: string;
  companyName: string;
  countryCode: string;
  countryLabel: string;
  qty: number;
  usd: number;
  avg: number;
  budget: number;
  spend: number;
  verify: AdSpendStatementVerify;
};

const COUNTRY_LABEL = "Country";
/** Non-Amazon rows print an em dash here — the Country column is
 *  Amazon-only by design ("JO SIRF AMAZON PAR WORK KARE"), never hidden, so
 *  the two kinds of row stay visually comparable in one table. */
const countryCell = (r: { countryCode: string; countryLabel: string }) =>
  r.countryCode || r.countryLabel ? r.countryLabel || r.countryCode : "—";

const DAILY_COLUMNS: ExportColumn<AdSpendDailyRow>[] = [
  { key: "date", label: "Date", value: (r) => r.date },
  { key: "companyName", label: "Company", value: (r) => r.companyName },
  { key: "storeName", label: "Store", value: (r) => r.storeName },
  { key: "country", label: COUNTRY_LABEL, value: countryCell },
  { key: "qty", label: "QTY ORD", value: (r) => r.qty },
  { key: "usd", label: "USD", value: (r) => r.usd.toFixed(2) },
  { key: "budget", label: "BGDT", value: (r) => r.budget.toFixed(2) },
  { key: "spend", label: "SPND", value: (r) => r.spend.toFixed(2) },
  { key: "verify", label: "Statement", value: (r) => verifyText(r.verify) },
];

const MONTHLY_COLUMNS: ExportColumn<AdSpendMonthlyRow>[] = [
  { key: "companyName", label: "Company", value: (r) => r.companyName },
  { key: "storeName", label: "Store", value: (r) => r.storeName },
  { key: "country", label: COUNTRY_LABEL, value: countryCell },
  { key: "qty", label: "QTY ORD", value: (r) => r.qty },
  { key: "usd", label: "SALES (USD)", value: (r) => r.usd.toFixed(2) },
  { key: "avg", label: "AVG Order (USD)", value: (r) => r.avg.toFixed(2) },
  { key: "budget", label: "Budget (USD)", value: (r) => r.budget.toFixed(2) },
  { key: "spend", label: "Spend (USD)", value: (r) => r.spend.toFixed(2) },
  { key: "spendPct", label: "Spend % of Sales", value: (r) => (r.usd > 0 ? `${((r.spend / r.usd) * 100).toFixed(1)}%` : "—") },
  { key: "verify", label: "Statement", value: (r) => verifyText(r.verify) },
];

// The Amazon Country table's columns are built INSIDE the component instead
// of here (2026-10-15b) — its Spend column has an extra ₹ copy that needs the
// live exchange rate, which only the component has.

const rowKey = (r: { storeId: string; countryCode: string }) => `${r.storeId}|${r.countryCode}`;

/** 2026-10-15 — "OR LINK HO JAYE": the statement cell of every row is a link
 *  into that store's own statement detail for the same month (Store Expense
 *  Report, filtered to the store + month — it lists the matched statement
 *  lines order by order, which is what "verified" above is claiming). The
 *  two import screens are linked once, under the tables, rather than in
 *  every row. */
function AmazonStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-sm font-bold text-slate-900">{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

function StatementCell({
  row,
  monthFrom,
  monthTo,
}: {
  row: { storeId: string; verify: AdSpendStatementVerify };
  monthFrom: string;
  monthTo: string;
}) {
  const status = verifyStatus(row.verify);
  const tone =
    status === "ok" ? "text-green-700" : status === "partial" ? "text-amber-700" : "text-slate-400";
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className={tone}>{verifyText(row.verify)}</span>
      <Link
        href={`/dashboard/reports/store-expenses?store=${row.storeId}&from=${monthFrom}&to=${monthTo}`}
        className="rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-50 print:hidden"
        title="Open this store's statement detail for the month"
      >
        🔗 Statement
      </Link>
    </span>
  );
}

// Report tab — "Daily" mirrors the old SUMMERY2026.html master sheet
// (one row per store per day) and "Monthly" mirrors MONTHLY REPORT.html's
// store-wise roll-up (orders + ad spend side by side). QTY ORD/USD come
// from a live join against `orders`; Budget/Spend come from store_ad_spend
// (see ad-spend-stats.ts for the actual aggregation) — this component only
// renders what it's given.
// 2026-10-15 — Amazon rows are further split per marketplace COUNTRY (both
// on the spend side, from the entry form's Country field, and on the sales
// side, from the order's buyer country), and the extra Amazon-only Country
// section below the two tables shows one row per Amazon store × country
// including the 12 marketplace countries that have no activity yet.
export function AdSpendReportTable({
  companies,
  filters,
  dailyRows,
  monthlyRows,
  amazonCountryRows,
  hasAmazonStore,
  fx,
}: {
  companies: { id: string; name: string }[];
  filters: { month: string; companyId: string };
  dailyRows: AdSpendDailyRow[];
  monthlyRows: AdSpendMonthlyRow[];
  amazonCountryRows: AdSpendAmazonCountryRow[];
  hasAmazonStore: boolean;
  /** Live rate snapshot for the Amazon totals (null when there is no Amazon
   *  store in scope, or before the first successful fetch). */
  fx?: FxSnapshot | null;
}) {
  const usdToInr = fx?.usdToInr ?? null;
  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  const [y, m] = filters.month.split("-").map(Number);
  const monthFrom = `${filters.month}-01`;
  const monthTo = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  const monthlyTotals = monthlyRows.reduce(
    (acc, r) => ({ qty: acc.qty + r.qty, usd: acc.usd + r.usd, budget: acc.budget + r.budget, spend: acc.spend + r.spend }),
    { qty: 0, usd: 0, budget: 0, spend: 0 }
  );
  const amazonTotals = amazonCountryRows.reduce(
    (acc, r) => ({ qty: acc.qty + r.qty, usd: acc.usd + r.usd, budget: acc.budget + r.budget, spend: acc.spend + r.spend }),
    { qty: 0, usd: 0, budget: 0, spend: 0 }
  );

  // 2026-10-15b — the Amazon section's own column set, built here (not at
  // module level) because the ₹ column depends on the live rate. Everything
  // below the Spend column is identical to the shared list.
  const inrToText = (usd: number) => (usdToInr ? `₹${(usd * usdToInr).toFixed(2)}` : "—");
  const amazonColumns: ExportColumn<AdSpendAmazonCountryRow>[] = [
    { key: "companyName", label: "Company", value: (r) => r.companyName },
    { key: "storeName", label: "Store", value: (r) => r.storeName },
    { key: "country", label: COUNTRY_LABEL, value: countryCell },
    { key: "qty", label: "QTY ORD", value: (r) => r.qty },
    { key: "usd", label: "SALES (USD)", value: (r) => r.usd.toFixed(2) },
    { key: "avg", label: "AVG Order (USD)", value: (r) => r.avg.toFixed(2) },
    { key: "budget", label: "Budget (USD)", value: (r) => r.budget.toFixed(2) },
    { key: "spend", label: "Spend (USD)", value: (r) => r.spend.toFixed(2) },
    { key: "spendInr", label: "Spend (₹ @ live rate)", value: (r) => inrToText(r.spend) },
    { key: "spendPct", label: "Spend % of Sales", value: (r) => (r.usd > 0 ? `${((r.spend / r.usd) * 100).toFixed(1)}%` : "—") },
    { key: "verify", label: "Statement", value: (r) => verifyText(r.verify) },
  ];

  const rateFetchedText = fx?.fetchedAt
    ? new Date(fx.fetchedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
    : null;
  const marketUpdatedText = fx?.marketUpdatedAt
    ? new Date(fx.marketUpdatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
    : null;
  const budgetUsedPct =
    amazonTotals.budget > 0 ? `${((amazonTotals.spend / amazonTotals.budget) * 100).toFixed(1)}%` : "—";
  const spendPctOfSales =
    amazonTotals.usd > 0 ? `${((amazonTotals.spend / amazonTotals.usd) * 100).toFixed(1)}%` : "—";

  function renderTable<T extends { storeId: string; countryCode: string; verify: AdSpendStatementVerify }>({
    columns,
    rows,
    emptyText,
    totals,
    maxHeight,
    label,
  }: {
    columns: ExportColumn<T>[];
    rows: T[];
    emptyText: string;
    totals?: { qty: number; usd: number; budget: number; spend: number };
    maxHeight?: string;
    label: string;
  }) {
    // The totals footer mirrors the column list rather than a fixed string:
    // the two money/QTY columns are found by their export key, everything
    // else renders blank (Statement included — a sum of "✅ 3/3" cells would
    // be meaningless).
    const totalFor = (key: string): string => {
      if (!totals) return "";
      if (key === "qty") return String(totals.qty);
      if (key === "usd") return totals.usd.toFixed(2);
      if (key === "avg") return totals.qty > 0 ? (totals.usd / totals.qty).toFixed(2) : "—";
      if (key === "budget") return totals.budget.toFixed(2);
      if (key === "spend") return totals.spend.toFixed(2);
      if (key === "spendPct") return totals.usd > 0 ? `${((totals.spend / totals.usd) * 100).toFixed(1)}%` : "—";
      // 2026-10-15b — the Amazon table's extra ₹ column totals at the same
      // live rate its rows do (blank when no rate is available yet).
      if (key === "spendInr") return totals.spend > 0 ? inrToText(totals.spend) : "";
      return "";
    };
    const moneyKeys = new Set(["qty", "usd", "avg", "budget", "spend", "spendInr", "spendPct"]);
    return (
      <div className={`${maxHeight ?? ""} overflow-auto rounded-xl border border-slate-200 bg-white`}>
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className={`bg-slate-50 ${maxHeight ? "sticky top-0" : ""}`}>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={rowKey(r)} className="hover:bg-slate-50">
                {columns.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-3 py-2 text-slate-700">
                    {c.key === "verify" ? (
                      <StatementCell row={r} monthFrom={monthFrom} monthTo={monthTo} />
                    ) : (
                      String(c.value(r) ?? "")
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-400">{emptyText}</td>
              </tr>
            )}
          </tbody>
          {totals && rows.length > 0 && (
            <tfoot className="bg-slate-50 font-semibold text-slate-700">
              <tr>
                {columns.map((c, i) => (
                  <td key={c.key} className="whitespace-nowrap px-3 py-2">
                    {moneyKeys.has(c.key) ? totalFor(c.key) : i === 0 ? `Total (${label})` : ""}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 print:hidden">
        <input type="hidden" name="tab" value="report" />
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="month">Month</label>
          <input id="month" name="month" type="month" defaultValue={filters.month} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="company">Company</label>
          <select id="company" name="company" defaultValue={filters.companyId} className={inputClass}>
            <option value="">All</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600">
          Filter
        </button>
        <a href="/dashboard/ad-spend?tab=report" className="text-xs text-slate-400 underline">Clear</a>
      </form>

      {/* 2026-10-13 — "order date ki bajaye po date se clear ho": both the
          roll-up and the daily master count an order in the month/day its
          PO DATE falls in; a blank PO date falls back to the entry date.
          2026-10-15 — the Statement column is explained here once: a row is
          "verified" only when each of its orders was actually found in that
          store's imported marketplace statement. */}
      <div className="-mt-3 space-y-1 text-[11px] text-slate-400">
        <p>
          Orders are counted in the month their <b>PO date</b> falls in — orders without a PO date fall back to their order (entry) date.
        </p>
        <p>
          <b>Statement</b> = the store&apos;s own monthly statement (Etsy Ledger / eBay Tax Invoice / Amazon Transactions). ✅ all of the
          row&apos;s orders were found in it, ⚠️ only some were, ⏳ none yet (statement not imported for this period). Click 🔗 Statement to
          see the matched lines order by order. Import or type statements under{" "}
          <Link href="/dashboard/statements" className="underline">Statement Entry</Link>{" "}
          and <Link href="/dashboard/csv-upload" className="underline">CSV Upload</Link>.
        </p>
      </div>

      <PrintArea id="ad-spend-print-area"><div className="space-y-8">
        <section>
          <div className="mb-2 flex items-center justify-between print:hidden">
            <h2 className="text-sm font-semibold text-slate-700">Monthly Roll-up — {filters.month}</h2>
            <ExportBar title="Ad Spend — Monthly" filenameBase="ad-spend-monthly" columns={MONTHLY_COLUMNS} rows={monthlyRows} printAreaId="ad-spend-print-area" />
          </div>
          {renderTable({
            columns: MONTHLY_COLUMNS,
            rows: monthlyRows,
            emptyText: "No data for this month.",
            totals: monthlyTotals,
            label: "Monthly",
          })}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between print:hidden">
            <h2 className="text-sm font-semibold text-slate-700">Daily Master — {filters.month}</h2>
            <ExportBar title="Ad Spend — Daily" filenameBase="ad-spend-daily" columns={DAILY_COLUMNS} rows={dailyRows} />
          </div>
          {renderTable({
            columns: DAILY_COLUMNS,
            rows: dailyRows,
            emptyText: "No data for this month.",
            maxHeight: "max-h-[32rem]",
            label: "Daily",
          })}
        </section>

        {/* 2026-10-15 — "COUNTRY SECTION ... JO SIRF AMAZON PAR WORK KARE":
            rendered only for Amazon stores; a company with no Amazon store
            in scope never sees it. */}
        {hasAmazonStore && (
          <section>
            <div className="mb-2 flex items-center justify-between print:hidden">
              <div>
                <h2 className="text-sm font-semibold text-slate-700">🌍 Amazon — Country-wise Budget / Spend</h2>
                <p className="text-[11px] text-slate-400">                  Amazon only — one row per Amazon store × marketplace country (US, UK, DE …). Budget/Spend come from the entry form&apos;s Country field; SALES/QTY are the same Amazon store&apos;s orders whose buyer country maps to that country. Amazon rows entered before the Country field existed (and buyer countries with no Amazon ad account) show up under <b>Other</b> — re-save those days with the right country.
                </p>
              </div>
              <ExportBar title="Ad Spend — Amazon Country" filenameBase="ad-spend-amazon-country" columns={amazonColumns} rows={amazonCountryRows} />
            </div>

            {/* 2026-10-15b — "TOTAL BUDGET KITNA HUA AMAZON KA SPEND KITNA HUA
                PERFECT CALCULATION SE ACTUAL CONVERSION KE HISAB SE": one
                summary strip plus the live-rate line it was converted at. */}
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 print:hidden">
              <AmazonStat label="Total Budget (USD)" value={amazonTotals.budget.toFixed(2)} />
              <AmazonStat label="Total Spend (USD)" value={amazonTotals.spend.toFixed(2)} />
              <AmazonStat
                label="Total Spend (₹)"
                value={usdToInr ? `₹${(amazonTotals.spend * usdToInr).toFixed(2)}` : "—"}
                sub={`@ 1 USD = ${formatUsdToInr(fx)}`}
              />
              <AmazonStat label="Budget Used" value={budgetUsedPct} />
              <AmazonStat label="Total Sales (USD)" value={amazonTotals.usd.toFixed(2)} sub={`${amazonTotals.qty} order(s)`} />
              <AmazonStat label="Spend % of Sales" value={spendPctOfSales} />
            </div>
            <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600">
              <span>
                Actual conversion: <b>1 USD = {formatUsdToInr(fx)}</b> · {fx?.source ?? "live rates"}
              </span>
              {rateFetchedText && <span>Rates fetched: {rateFetchedText} IST</span>}
              {marketUpdatedText && <span>Market update: {marketUpdatedText} IST</span>}
              <span className="text-slate-400">Auto-refreshes every 12 hours</span>
              {fx?.warning && <span className="font-medium text-amber-700">⚠ {fx.warning}</span>}
              {/* A plain <form action> must return void — the action returns
                  {error} for the useActionState paths, so it is awaited here
                  and its result deliberately ignored (a failed refresh just
                  leaves the cached snapshot and its ⚠ warning in place). */}
              <form
                action={async () => {
                  await refreshFxRatesAction();
                }}
                className="print:hidden"
              >
                <button
                  type="submit"
                  className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
                >
                  ↻ Refresh rates
                </button>
              </form>
            </div>
            {renderTable({
              columns: amazonColumns,
              rows: amazonCountryRows,
              emptyText: "No Amazon country data for this month yet — enter Budget/Spend per country on the Daily Entry tab, or pick another month.",
              totals: amazonTotals,
              label: "Amazon",
            })}
          </section>
        )}
      </div></PrintArea>
    </div>
  );
}
