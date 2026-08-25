"use client";

import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";
import { PrintArea } from "@/components/print-view";

export type AdSpendDailyRow = {
  storeId: string;
  storeName: string;
  companyName: string;
  date: string;
  qty: number;
  usd: number;
  budget: number;
  spend: number;
};

export type AdSpendMonthlyRow = {
  storeId: string;
  storeName: string;
  companyName: string;
  qty: number;
  usd: number;
  avg: number;
  budget: number;
  spend: number;
};

const DAILY_COLUMNS: ExportColumn<AdSpendDailyRow>[] = [
  { key: "date", label: "Date", value: (r) => r.date },
  { key: "companyName", label: "Company", value: (r) => r.companyName },
  { key: "storeName", label: "Store", value: (r) => r.storeName },
  { key: "qty", label: "QTY ORD", value: (r) => r.qty },
  { key: "usd", label: "USD", value: (r) => r.usd.toFixed(2) },
  { key: "budget", label: "BGDT", value: (r) => r.budget.toFixed(2) },
  { key: "spend", label: "SPND", value: (r) => r.spend.toFixed(2) },
];

const MONTHLY_COLUMNS: ExportColumn<AdSpendMonthlyRow>[] = [
  { key: "companyName", label: "Company", value: (r) => r.companyName },
  { key: "storeName", label: "Store", value: (r) => r.storeName },
  { key: "qty", label: "QTY ORD", value: (r) => r.qty },
  { key: "usd", label: "SALES (USD)", value: (r) => r.usd.toFixed(2) },
  { key: "avg", label: "AVG Order (USD)", value: (r) => r.avg.toFixed(2) },
  { key: "budget", label: "Budget (USD)", value: (r) => r.budget.toFixed(2) },
  { key: "spend", label: "Spend (USD)", value: (r) => r.spend.toFixed(2) },
  { key: "spendPct", label: "Spend % of Sales", value: (r) => (r.usd > 0 ? `${((r.spend / r.usd) * 100).toFixed(1)}%` : "—") },
];

// Report tab — "Daily" mirrors the old SUMMERY2026.html master sheet
// (one row per store per day) and "Monthly" mirrors MONTHLY REPORT.html's
// store-wise roll-up (orders + ad spend side by side). QTY ORD/USD come
// from a live join against `orders`; Budget/Spend come from store_ad_spend
// (see page.tsx for the actual aggregation) — this component only renders
// what it's given.
export function AdSpendReportTable({
  companies,
  filters,
  dailyRows,
  monthlyRows,
}: {
  companies: { id: string; name: string }[];
  filters: { month: string; companyId: string };
  dailyRows: AdSpendDailyRow[];
  monthlyRows: AdSpendMonthlyRow[];
}) {
  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  const monthlyTotals = monthlyRows.reduce(
    (acc, r) => ({ qty: acc.qty + r.qty, usd: acc.usd + r.usd, budget: acc.budget + r.budget, spend: acc.spend + r.spend }),
    { qty: 0, usd: 0, budget: 0, spend: 0 }
  );

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

      <PrintArea id="ad-spend-print-area"><div className="space-y-8">
        <section>
          <div className="mb-2 flex items-center justify-between print:hidden">
            <h2 className="text-sm font-semibold text-slate-700">Monthly Roll-up — {filters.month}</h2>
            <ExportBar title="Ad Spend — Monthly" filenameBase="ad-spend-monthly" columns={MONTHLY_COLUMNS} rows={monthlyRows} printAreaId="ad-spend-print-area" />
          </div>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50">
                <tr>
                  {MONTHLY_COLUMNS.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {monthlyRows.map((r) => (
                  <tr key={r.storeId} className="hover:bg-slate-50">
                    {MONTHLY_COLUMNS.map((c) => (
                      <td key={c.key} className="whitespace-nowrap px-3 py-2 text-slate-700">{String(c.value(r) ?? "")}</td>
                    ))}
                  </tr>
                ))}
                {monthlyRows.length === 0 && (
                  <tr>
                    <td colSpan={MONTHLY_COLUMNS.length} className="px-3 py-8 text-center text-slate-400">No data for this month.</td>
                  </tr>
                )}
              </tbody>
              {monthlyRows.length > 0 && (
                <tfoot className="bg-slate-50 font-semibold text-slate-700">
                  <tr>
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2">{monthlyTotals.qty}</td>
                    <td className="px-3 py-2">{monthlyTotals.usd.toFixed(2)}</td>
                    <td className="px-3 py-2">{monthlyTotals.qty > 0 ? (monthlyTotals.usd / monthlyTotals.qty).toFixed(2) : "—"}</td>
                    <td className="px-3 py-2">{monthlyTotals.budget.toFixed(2)}</td>
                    <td className="px-3 py-2">{monthlyTotals.spend.toFixed(2)}</td>
                    <td className="px-3 py-2">{monthlyTotals.usd > 0 ? `${((monthlyTotals.spend / monthlyTotals.usd) * 100).toFixed(1)}%` : "—"}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center justify-between print:hidden">
            <h2 className="text-sm font-semibold text-slate-700">Daily Master — {filters.month}</h2>
            <ExportBar title="Ad Spend — Daily" filenameBase="ad-spend-daily" columns={DAILY_COLUMNS} rows={dailyRows} />
          </div>
          <div className="max-h-[32rem] overflow-auto rounded-xl border border-slate-200 bg-white">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="sticky top-0 bg-slate-50">
                <tr>
                  {DAILY_COLUMNS.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {dailyRows.map((r) => (
                  <tr key={`${r.storeId}__${r.date}`} className="hover:bg-slate-50">
                    {DAILY_COLUMNS.map((c) => (
                      <td key={c.key} className="whitespace-nowrap px-3 py-2 text-slate-700">{String(c.value(r) ?? "")}</td>
                    ))}
                  </tr>
                ))}
                {dailyRows.length === 0 && (
                  <tr>
                    <td colSpan={DAILY_COLUMNS.length} className="px-3 py-8 text-center text-slate-400">No data for this month.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div></PrintArea>
    </div>
  );
}
