"use client";

import { useState } from "react";
import Link from "next/link";
import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";
import { PrintArea } from "@/components/print-view";
import { verifyStatus, verifyText } from "./ad-spend-stats";
// 2026-11-21 — the report's money columns and totals are USD only ("Data in
// USD only (No INR Conversion)"); the earlier ₹ companion columns were the
// opposite of that ask and are gone. The only rate left is the Amazon
// country section's own conversion strip (pre-existing, src/lib/fx/rates.ts).
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
  /** Ad-platform attributed orders; null = not recorded for that day. */
  adOrders: number | null;
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
  /** Ad-platform attributed orders; null = not recorded for that row. */
  adOrders: number | null;
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
  adOrders: number | null;
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

// 2026-11-20 — ROAS and Budget Utilisation are derived, never stored:
//   ROAS            = SALES (USD) ÷ Spend (USD)      → "16.6x"
//   Budget Used %   = Spend (USD) ÷ Budget (USD)     → "72.4%"
// Both print an em dash when the denominator is 0 (no spend / no budget), so
// a row can never claim an infinite return.
const roasText = (usd: number, spend: number) => (spend > 0 ? `${(usd / spend).toFixed(1)}x` : "—");
const budgetUsedText = (spend: number, budget: number) =>
  budget > 0 ? `${((spend / budget) * 100).toFixed(1)}%` : "—";
const spendPctText = (spend: number, usd: number) =>
  usd > 0 ? `${((spend / usd) * 100).toFixed(1)}%` : "—";
// Ad orders are only known when the ad platform's own count was entered;
// organic is then the rest of the row's orders (floored at 0 so a mistyped
// ad count cannot produce negative organic orders).
const organicOrders = (qty: number, adOrders: number | null) =>
  adOrders === null ? null : Math.max(0, qty - adOrders);

/**
 * Sort/search helper — a cell is compared as a number when it looks like one
 * ("12.34", "16.6x", "72.4%", "₹1,245.00") and as text otherwise (dates,
 * "✅ 3/3 verified", "—"), so clicking SALES sorts by money rather than by
 * the first digit of a formatted string.
 */
function cellNumber(value: string | number | null | undefined): number | null {
  const text = String(value ?? "")
    .replace(/[₹$,%\s]/g, "")
    .replace(/x$/i, "");
  if (!text || text === "—") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

const rowKey = (r: { storeId: string; countryCode: string; date?: string }) =>
  `${r.storeId}|${r.countryCode}|${r.date ?? ""}`;

/** The optional AD ORD / ORGANIC ORD pair, insertable into any of the three
 *  column lists. A row without a recorded ad count prints “—” rather than
 *  being counted as organic. */
function AD_ORDER_COLUMNS<T extends { qty: number; adOrders: number | null }>(): ExportColumn<T>[] {
  return [
    { key: "adOrders", label: "AD ORD", value: (r) => (r.adOrders === null ? "—" : r.adOrders) },
    { key: "organicOrders", label: "ORGANIC ORD", value: (r) => organicOrders(r.qty, r.adOrders) ?? "—" },
  ];
}

/** 2026-10-15 — "OR LINK HO JAYE": the statement cell of every row is a link
 *  into that store's own statement detail for the same month (Store Expense
 *  Report, filtered to the store + month — it lists the matched statement
 *  lines order by order, which is what "verified" above is claiming). The
 *  two import screens are linked once, under the tables, rather than in
 *  every row. */
function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
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
// 2026-11-20 — added on top, all display-side: ROAS + Budget Used %, the
// ad-vs-organic order split (from store_ad_spend.ad_orders), and click-to-sort
// headers plus a search box on every table. 2026-11-21 — a store filter now
// scopes the whole tab (rows AND totals), and all ₹ companions were removed
// so money stays USD only. Nothing here writes a number.
export function AdSpendReportTable({
  companies,
  stores,
  filters,
  dailyRows,
  monthlyRows,
  amazonCountryRows,
  hasAmazonStore,
  hasAdOrderData,
  fx,
}: {
  companies: { id: string; name: string }[];
  /** Stores this login may see (same scoping as the server filters). */
  stores: { id: string; name: string; company_id: string }[];
  filters: { month: string; companyId: string; storeId: string };
  dailyRows: AdSpendDailyRow[];
  monthlyRows: AdSpendMonthlyRow[];
  amazonCountryRows: AdSpendAmazonCountryRow[];
  hasAmazonStore: boolean;
  /** true when at least one spend entry recorded ad-platform attributed
   *  orders; false hides the ad/organic columns instead of faking zeros. */
  hasAdOrderData: boolean;
  /** Live rate snapshot (null before the first successful fetch). */
  fx?: FxSnapshot | null;
}) {
  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  const [y, m] = filters.month.split("-").map(Number);
  const monthFrom = `${filters.month}-01`;
  const monthTo = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);

  // Sort + search are per table, so sorting the Monthly roll-up never
  // re-orders the Daily master.
  const [sortBy, setSortBy] = useState<Record<string, { key: string; dir: "asc" | "desc" }>>({});
  const [searchBy, setSearchBy] = useState<Record<string, string>>({});

  const monthlyTotals = monthlyRows.reduce(
    (acc, r) => ({
      qty: acc.qty + r.qty,
      adOrders: acc.adOrders + (r.adOrders ?? 0),
      adOrdersKnown: acc.adOrdersKnown + (r.adOrders !== null ? 1 : 0),
      usd: acc.usd + r.usd,
      budget: acc.budget + r.budget,
      spend: acc.spend + r.spend,
    }),
    { qty: 0, adOrders: 0, adOrdersKnown: 0, usd: 0, budget: 0, spend: 0 }
  );
  const amazonTotals = amazonCountryRows.reduce(
    (acc, r) => ({
      qty: acc.qty + r.qty,
      adOrders: acc.adOrders + (r.adOrders ?? 0),
      adOrdersKnown: acc.adOrdersKnown + (r.adOrders !== null ? 1 : 0),
      usd: acc.usd + r.usd,
      budget: acc.budget + r.budget,
      spend: acc.spend + r.spend,
    }),
    { qty: 0, adOrders: 0, adOrdersKnown: 0, usd: 0, budget: 0, spend: 0 }
  );

  // The Amazon Country table's columns are built INSIDE the component (not at
  // module level) because its ₹ columns depend on the live rate; the Monthly
  // and Daily sets are built here for the same reason plus the optional
  // ad/organic split.
  const monthlyColumns: ExportColumn<AdSpendMonthlyRow>[] = [
    { key: "companyName", label: "Company", value: (r) => r.companyName },
    { key: "storeName", label: "Store", value: (r) => r.storeName },
    { key: "country", label: COUNTRY_LABEL, value: countryCell },
    { key: "qty", label: "QTY ORD", value: (r) => r.qty },
    ...(hasAdOrderData ? AD_ORDER_COLUMNS<AdSpendMonthlyRow>() : []),
    { key: "usd", label: "SALES (USD)", value: (r) => r.usd.toFixed(2) },
    { key: "avg", label: "AVG Order (USD)", value: (r) => r.avg.toFixed(2) },
    { key: "budget", label: "Budget (USD)", value: (r) => r.budget.toFixed(2) },
    { key: "budgetUsed", label: "Budget Used %", value: (r) => budgetUsedText(r.spend, r.budget) },
    { key: "spend", label: "Spend (USD)", value: (r) => r.spend.toFixed(2) },
    { key: "roas", label: "ROAS", value: (r) => roasText(r.usd, r.spend) },
    { key: "spendPct", label: "Spend % of Sales", value: (r) => spendPctText(r.spend, r.usd) },
    { key: "verify", label: "Statement", value: (r) => verifyText(r.verify) },
  ];

  const dailyColumns: ExportColumn<AdSpendDailyRow>[] = [
    { key: "date", label: "Date", value: (r) => r.date },
    { key: "companyName", label: "Company", value: (r) => r.companyName },
    { key: "storeName", label: "Store", value: (r) => r.storeName },
    { key: "country", label: COUNTRY_LABEL, value: countryCell },
    { key: "qty", label: "QTY ORD", value: (r) => r.qty },
    ...(hasAdOrderData ? AD_ORDER_COLUMNS<AdSpendDailyRow>() : []),
    { key: "usd", label: "SALES (USD)", value: (r) => r.usd.toFixed(2) },
    { key: "budget", label: "BGDT", value: (r) => r.budget.toFixed(2) },
    { key: "spend", label: "SPND", value: (r) => r.spend.toFixed(2) },
    { key: "roas", label: "ROAS", value: (r) => roasText(r.usd, r.spend) },
    { key: "verify", label: "Statement", value: (r) => verifyText(r.verify) },
  ];

  const amazonColumns: ExportColumn<AdSpendAmazonCountryRow>[] = [
    { key: "companyName", label: "Company", value: (r) => r.companyName },
    { key: "storeName", label: "Store", value: (r) => r.storeName },
    { key: "country", label: COUNTRY_LABEL, value: countryCell },
    { key: "qty", label: "QTY ORD", value: (r) => r.qty },
    ...(hasAdOrderData ? AD_ORDER_COLUMNS<AdSpendAmazonCountryRow>() : []),
    { key: "usd", label: "SALES (USD)", value: (r) => r.usd.toFixed(2) },
    { key: "avg", label: "AVG Order (USD)", value: (r) => r.avg.toFixed(2) },
    { key: "budget", label: "Budget (USD)", value: (r) => r.budget.toFixed(2) },
    { key: "budgetUsed", label: "Budget Used %", value: (r) => budgetUsedText(r.spend, r.budget) },
    { key: "spend", label: "Spend (USD)", value: (r) => r.spend.toFixed(2) },
    { key: "roas", label: "ROAS", value: (r) => roasText(r.usd, r.spend) },
    { key: "spendPct", label: "Spend % of Sales", value: (r) => spendPctText(r.spend, r.usd) },
    { key: "verify", label: "Statement", value: (r) => verifyText(r.verify) },
  ];

  const rateFetchedText = fx?.fetchedAt
    ? new Date(fx.fetchedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
    : null;
  const marketUpdatedText = fx?.marketUpdatedAt
    ? new Date(fx.marketUpdatedAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })
    : null;
  const monthlyBudgetUsed = budgetUsedText(monthlyTotals.spend, monthlyTotals.budget);
  const monthlyRoas = roasText(monthlyTotals.usd, monthlyTotals.spend);
  const monthlyOrganic =
    monthlyTotals.adOrdersKnown > 0 ? Math.max(0, monthlyTotals.qty - monthlyTotals.adOrders) : null;
  // Some stores may have recorded ad orders and others not; the split then
  // covers only the rows that did, and the tile says so instead of implying
  // the whole month is accounted for.
  const monthlyAdPartial = hasAdOrderData && monthlyRows.some((r) => r.qty > 0 && r.adOrders === null);

  function toggleSort(tableId: string, key: string) {
    setSortBy((prev) => {
      const current = prev[tableId];
      if (current?.key === key) return { ...prev, [tableId]: { key, dir: current.dir === "asc" ? "desc" : "asc" } };
      return { ...prev, [tableId]: { key, dir: "desc" } };
    });
  }

  function renderTable<T extends { storeId: string; countryCode: string; verify: AdSpendStatementVerify; date?: string }>({
    tableId,
    columns,
    rows,
    emptyText,
    totals,
    maxHeight,
    label,
    searchPlaceholder,
  }: {
    tableId: string;
    columns: ExportColumn<T>[];
    rows: T[];
    emptyText: string;
    totals?: { qty: number; adOrders: number; adOrdersKnown: number; usd: number; budget: number; spend: number };
    maxHeight?: string;
    label: string;
    searchPlaceholder: string;
  }) {
    // The totals footer mirrors the column list rather than a fixed string:
    // every derived column is computed from the same summed inputs its rows
    // use, everything else renders blank (Statement included — a sum of
    // "✅ 3/3" cells would be meaningless).
    const organicOrdersKnown = totals ? totals.adOrdersKnown > 0 : false;
    const totalFor = (key: string): string => {
      if (!totals) return "";
      if (key === "qty") return String(totals.qty);
      if (key === "adOrders") return organicOrdersKnown ? String(totals.adOrders) : "—";
      if (key === "organicOrders") return organicOrdersKnown ? String(Math.max(0, totals.qty - totals.adOrders)) : "—";
      if (key === "usd") return totals.usd.toFixed(2);
      if (key === "avg") return totals.qty > 0 ? (totals.usd / totals.qty).toFixed(2) : "—";
      if (key === "budget") return totals.budget.toFixed(2);
      if (key === "budgetUsed") return budgetUsedText(totals.spend, totals.budget);
      if (key === "spend") return totals.spend.toFixed(2);
      if (key === "roas") return roasText(totals.usd, totals.spend);
      if (key === "spendPct") return spendPctText(totals.spend, totals.usd);
      return "";
    };
    const moneyKeys = new Set([
      "qty",
      "adOrders",
      "organicOrders",
      "usd",
      "avg",
      "budget",
      "budgetUsed",
      "spend",
      "roas",
      "spendPct",
    ]);

    const search = searchBy[tableId] ?? "";
    const query = search.trim().toLowerCase();
    const visible = query
      ? rows.filter((row) => columns.some((c) => String(c.value(row) ?? "").toLowerCase().includes(query)))
      : rows;
    const sort = sortBy[tableId];
    const sorted = sort
      ? [...visible].sort((a, b) => {
          const col = columns.find((c) => c.key === sort.key);
          if (!col) return 0;
          const av = col.value(a);
          const bv = col.value(b);
          const an = cellNumber(av);
          const bn = cellNumber(bv);
          let result: number;
          if (an !== null && bn !== null) result = an - bn;
          else if (an !== null) result = -1;
          else if (bn !== null) result = 1;
          else result = String(av ?? "").localeCompare(String(bv ?? ""));
          return sort.dir === "asc" ? result : -result;
        })
      : visible;

    return (
      <div className={`${maxHeight ?? ""} overflow-auto rounded-xl border border-slate-200 bg-white`}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-3 py-2 print:hidden">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearchBy((prev) => ({ ...prev, [tableId]: e.target.value }))}
            placeholder={searchPlaceholder}
            aria-label={`Search ${label} table`}
            className="w-64 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500"
          />
          <span className="text-[11px] text-slate-400">
            {query ? `${sorted.length} of ${rows.length} row(s)` : `${rows.length} row(s)`}
            {sort ? " · sorted" : " · click a header to sort"}
          </span>
        </div>
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className={`bg-slate-50 ${maxHeight ? "sticky top-0" : ""}`}>
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                    className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(tableId, c.key)}
                      className={`inline-flex items-center gap-1 transition hover:text-slate-800 ${active ? "text-slate-800" : ""}`}
                      title={`Sort by ${c.label}`}
                    >
                      {c.label}
                      <span className="text-[9px] text-slate-400">{active ? (sort.dir === "asc" ? "▲" : "▼") : "⇅"}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {sorted.map((r) => (
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
            {sorted.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-400">
                  {query ? `No row matches “${search.trim()}”.` : emptyText}
                </td>
              </tr>
            )}
          </tbody>
          {totals && sorted.length > 0 && (
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
        {/* 2026-11-21 — "store wise filter karne ka option nahi hai total
            filter ke according update ho": the store filter is applied on the
            server, so every table, footer total and summary tile below is
            built from only the selected store's rows. */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="store">Store</label>
          <select id="store" name="store" defaultValue={filters.storeId} className={inputClass}>
            <option value="">All</option>
            {stores
              .filter((s) => !filters.companyId || s.company_id === filters.companyId)
              .map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
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
          store's imported marketplace statement.
          2026-11-20 — the money rule (USD primary, ₹ companion) and the
          ad/organic source are stated once here too. */}
      <div className="-mt-3 space-y-1 text-[11px] text-slate-400">
        <p>
          The <b>store filter</b> scopes the whole tab: both tables, the Amazon country section, every footer total and every summary
          tile are recalculated from the filtered rows only.
        </p>
        <p>
          Orders are counted in the month their <b>PO date</b> falls in — orders without a PO date fall back to their order (entry) date.
        </p>
        <p>
          <b>All money is USD</b> — no INR conversion in these tables or totals. The only rate shown is the Amazon section&apos;s
          own conversion strip below.
        </p>
        <p>
          <b>ROAS</b> = SALES ÷ Spend (a dash when nothing was spent). <b>Budget Used %</b> = Spend ÷ Budget. <b>Spend % of Sales</b> is the
          same ACOS figure as before.
        </p>
        <p>
          {hasAdOrderData ? (
            <>
              <b>AD ORD</b> is the order count the ad platform attributed to that spend (typed on the Daily Entry tab); <b>ORGANIC ORD</b> is
              the rest of QTY ORD. A row with no recorded ad orders shows “—” rather than being counted as organic, and such rows are
              excluded from the ad/organic totals (the QTY ORD tile marks that as partial).
            </>
          ) : (
            <>
              <b>Ad vs organic orders</b> is not shown yet: no entry has a recorded ad-platform order count. Type it in the optional
              “Ad orders” field on the Daily Entry tab (needs db/2026-11-20e-store-ad-spend-attributed-orders.sql in Supabase) and the split
              appears here.
            </>
          )}
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
            <ExportBar title="Ad Spend — Monthly" filenameBase="ad-spend-monthly" columns={monthlyColumns} rows={monthlyRows} printAreaId="ad-spend-print-area" />
          </div>

          {/* 2026-11-20 — the month's headline numbers, USD first with the ₹
              companion underneath, plus the two metrics that were missing:
              ROAS and Budget Utilisation. */}
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <StatTile label="Total Sales (USD)" value={monthlyTotals.usd.toFixed(2)} />
            <StatTile label="Total Spend (USD)" value={monthlyTotals.spend.toFixed(2)} />
            <StatTile label="Total Budget (USD)" value={monthlyTotals.budget.toFixed(2)} />
            <StatTile label="Budget Used" value={monthlyBudgetUsed} />
            <StatTile label="ROAS" value={monthlyRoas} sub="Sales ÷ Spend" />
            <StatTile
              label="QTY ORD"
              value={String(monthlyTotals.qty)}
              sub={
                monthlyOrganic !== null
                  ? `${monthlyTotals.adOrders} ad · ${monthlyOrganic} organic${monthlyAdPartial ? " (partial — some rows lack an ad count)" : ""}`
                  : "Ad/organic split not recorded"
              }
            />
          </div>

          {renderTable({
            tableId: "monthly",
            columns: monthlyColumns,
            rows: monthlyRows,
            emptyText: "No data for this month.",
            totals: monthlyTotals,
            label: "Monthly",
            searchPlaceholder: "Search store, company, country…",
          })}
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between print:hidden">
            <h2 className="text-sm font-semibold text-slate-700">Daily Master — {filters.month}</h2>
            <ExportBar title="Ad Spend — Daily" filenameBase="ad-spend-daily" columns={dailyColumns} rows={dailyRows} />
          </div>
          {renderTable({
            tableId: "daily",
            columns: dailyColumns,
            rows: dailyRows,
            emptyText: "No data for this month.",
            maxHeight: "max-h-[32rem]",
            label: "Daily",
            searchPlaceholder: "Search date, store, country…",
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

            {/* 2026-10-15b — one summary strip plus the live-rate line it was
                converted at; 2026-11-20 — ROAS/Budget Used added and the ₹
                copy now covers SALES as well as Spend. */}
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6 print:hidden">
              <StatTile label="Total Budget (USD)" value={amazonTotals.budget.toFixed(2)} />
              <StatTile label="Total Spend (USD)" value={amazonTotals.spend.toFixed(2)} />
              <StatTile label="Total Sales (USD)" value={amazonTotals.usd.toFixed(2)} sub={`${amazonTotals.qty} order(s)`} />
              <StatTile label="Budget Used" value={budgetUsedText(amazonTotals.spend, amazonTotals.budget)} />
              <StatTile label="ROAS" value={roasText(amazonTotals.usd, amazonTotals.spend)} sub="Sales ÷ Spend" />
              <StatTile label="Spend % of Sales" value={spendPctText(amazonTotals.spend, amazonTotals.usd)} />
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
              tableId: "amazon",
              columns: amazonColumns,
              rows: amazonCountryRows,
              emptyText: "No Amazon country data for this month yet — enter Budget/Spend per country on the Daily Entry tab, or pick another month.",
              totals: amazonTotals,
              label: "Amazon",
              searchPlaceholder: "Search store, country…",
            })}
          </section>
        )}
      </div></PrintArea>
    </div>
  );
}
