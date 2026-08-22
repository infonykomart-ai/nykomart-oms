"use client";

import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";
import { useColumnVisibility } from "@/lib/export/use-column-visibility";

// Sale & Profit report (2026-08-22) — one of the 3 new report pages. See
// page.tsx's header comment for the revenue/expense model and the
// deliberate exclusion of company-wide purchase_bills costs from this
// per-order figure (unlike the CRM P&L dashboard's company-level totals).
export type SaleProfitRow = {
  id: string;
  source: "Live Order" | "Historical";
  company_name: string;
  ref_no: string;
  order_date: string | null;
  buyer_name: string | null;
  item_category: string | null;
  qty: number | null;
  order_value_inr: number;
  courier_expense_inr: number;
  duty_expense_inr: number;
  net_total_value: number;
  portal_expenses_25pct: number;
  net_earn: number;
  profit_pct: number | null;
};

const COLUMNS: ExportColumn<SaleProfitRow>[] = [
  { key: "source", label: "Source", value: (r) => r.source },
  { key: "company_name", label: "Company", value: (r) => r.company_name },
  { key: "ref_no", label: "Order / Ref No.", value: (r) => r.ref_no },
  { key: "order_date", label: "Order Date", value: (r) => r.order_date },
  { key: "buyer_name", label: "Buyer", value: (r) => r.buyer_name },
  { key: "item_category", label: "Item Category", value: (r) => r.item_category },
  { key: "qty", label: "Qty", value: (r) => r.qty },
  { key: "order_value_inr", label: "Order Value (INR)", value: (r) => r.order_value_inr },
  { key: "courier_expense_inr", label: "Courier Expense", value: (r) => r.courier_expense_inr },
  { key: "duty_expense_inr", label: "Duty Expense", value: (r) => r.duty_expense_inr },
  { key: "net_total_value", label: "Net Total Value", value: (r) => r.net_total_value },
  { key: "portal_expenses_25pct", label: "Portal Expenses (25%)", value: (r) => r.portal_expenses_25pct },
  { key: "net_earn", label: "Net Earn", value: (r) => r.net_earn },
  { key: "profit_pct", label: "Profit %", value: (r) => (r.profit_pct === null ? "" : `${(r.profit_pct * 100).toFixed(1)}%`) },
];

export function SaleProfitReportTable({
  rows,
  companies,
  filters,
}: {
  rows: SaleProfitRow[];
  companies: { id: string; name: string }[];
  filters: { companyId: string; from: string; to: string };
}) {
  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  const { visibleColumns, hiddenKeys, toggleColumn } = useColumnVisibility(COLUMNS);

  const totalOrderValue = rows.reduce((s, r) => s + r.order_value_inr, 0);
  const totalNetEarn = rows.reduce((s, r) => s + r.net_earn, 0);
  const avgProfitPct = totalOrderValue > 0 ? totalNetEarn / totalOrderValue : null;

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #sale-profit-report-print-area, #sale-profit-report-print-area * { visibility: visible; }
          #sale-profit-report-print-area { position: fixed; inset: 0; width: 100%; }
        }
      `}</style>
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 print:hidden">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="company">Company</label>
          <select id="company" name="company" defaultValue={filters.companyId} className={inputClass}>
            <option value="">All</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={filters.from} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={filters.to} className={inputClass} />
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600">
          Filter
        </button>
        <a href="/dashboard/reports/sale-profit" className="text-xs text-slate-400 underline">Clear</a>
      </form>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 print:hidden">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Total Order Value</div>
          <div className="mt-1 text-xl font-bold text-slate-900">₹{totalOrderValue.toFixed(2)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Total Net Earn</div>
          <div className="mt-1 text-xl font-bold text-slate-900">₹{totalNetEarn.toFixed(2)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs font-medium text-slate-500">Avg. Profit %</div>
          <div className="mt-1 text-xl font-bold text-slate-900">{avgProfitPct === null ? "—" : `${(avgProfitPct * 100).toFixed(1)}%`}</div>
        </div>
      </div>

      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 print:hidden">
        ⚠️ Net Earn/Profit % here excludes company-wide Purchase Bill costs (those are pooled across all orders, not
        attributable to a single order) — it only nets Order Value against that order&apos;s own Courier + Duty
        expense and the standard 25% portal-expense assumption. For a full company-level profit figure including
        pooled purchase costs, see the CRM Overview → P&amp;L Dashboard.
      </div>

      <div className="flex items-center justify-between print:hidden">
        <p className="text-sm text-slate-500">{rows.length} row(s)</p>
        <ExportBar
          title="Sale & Profit Report"
          filenameBase="sale-profit-report"
          columns={visibleColumns}
          rows={rows}
          printAreaId="sale-profit-report-print-area"
          allColumns={COLUMNS}
          hiddenKeys={hiddenKeys}
          onToggleColumn={toggleColumn}
        />
      </div>

      <div id="sale-profit-report-print-area" className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {visibleColumns.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                {visibleColumns.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-3 py-2 text-slate-700">{String(c.value(r) ?? "")}</td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-slate-400">No rows found for this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
