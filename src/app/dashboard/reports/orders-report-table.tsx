"use client";

import { ExportBar } from "@/components/export-bar";
import { PrintArea } from "@/components/print-view";
import type { ExportColumn } from "@/lib/export/export-table";
import { useColumnVisibility } from "@/lib/export/use-column-visibility";

type OrderRow = {
  id: string;
  ref_no: string;
  order_date: string;
  status: string;
  buyer_name_address: string | null;
  contact_no: string | null;
  size_label: string | null;
  qty: number;
  order_value_original: number;
  order_currency: string;
  order_value_usd: number | null;
  order_value_inr: number | null;
  dispatch_date: string | null;
  company_name: string;
  item_category_name: string;
};

const STATUSES = ["Pending", "Confirmed", "In Production", "Dispatched", "Delivered", "Cancelled", "Returned"];

const COLUMNS: ExportColumn<OrderRow>[] = [
  { key: "ref_no", label: "Ref No.", value: (r) => r.ref_no },
  { key: "order_date", label: "Order Date", value: (r) => r.order_date },
  { key: "company_name", label: "Company", value: (r) => r.company_name },
  { key: "status", label: "Status", value: (r) => r.status },
  { key: "buyer_name_address", label: "Buyer", value: (r) => r.buyer_name_address },
  { key: "contact_no", label: "Contact No.", value: (r) => r.contact_no },
  { key: "item_category_name", label: "Item", value: (r) => r.item_category_name },
  { key: "size_label", label: "Size", value: (r) => r.size_label },
  { key: "qty", label: "Qty", value: (r) => r.qty },
  { key: "order_value_original", label: "Value", value: (r) => r.order_value_original },
  { key: "order_currency", label: "Currency", value: (r) => r.order_currency },
  { key: "order_value_usd", label: "Value (USD)", value: (r) => r.order_value_usd },
  { key: "order_value_inr", label: "Value (INR)", value: (r) => r.order_value_inr },
  { key: "dispatch_date", label: "Dispatch Date", value: (r) => r.dispatch_date },
];

export function OrdersReportTable({
  rows,
  companies,
  filters,
}: {
  rows: OrderRow[];
  companies: { id: string; name: string }[];
  filters: { companyId: string; status: string; fromDate: string; toDate: string };
}) {
  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  // 2026-08-22 — first consumer of the generic column picker (see
  // src/lib/export/use-column-visibility.ts). visibleColumns drives BOTH
  // the <table> below and what <ExportBar /> exports, so hide/show and
  // every export format agree.
  const { visibleColumns, hiddenKeys, toggleColumn } = useColumnVisibility(COLUMNS);

  return (
    <div className="space-y-4">
      {/* 2026-08-08 (pending item 5) — printAreaId wasn't wired here before,
          so the PDF/Print button never actually appeared (ExportBar hides
          it without one). */}
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 print:hidden">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={filters.fromDate} className={inputClass} />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={filters.toDate} className={inputClass} />
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
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={filters.status} className={inputClass}>
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600">
          Filter
        </button>
        <a href="/dashboard/reports" className="text-xs text-slate-400 underline">Clear</a>
      </form>

      <div className="flex items-center justify-between print:hidden">
        <p className="text-sm text-slate-500">{rows.length} orders {rows.length === 1000 && "(showing up to 1000 — narrow the date range for full data)"}</p>
        <ExportBar
          title="Orders Report"
          filenameBase="orders-report"
          columns={visibleColumns}
          rows={rows}
          printAreaId="orders-report-print-area"
          allColumns={COLUMNS}
          hiddenKeys={hiddenKeys}
          onToggleColumn={toggleColumn}
        />
      </div>

      <PrintArea id="orders-report-print-area"><div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
                <td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-slate-400">No orders found for this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div></PrintArea>
    </div>
  );
}
