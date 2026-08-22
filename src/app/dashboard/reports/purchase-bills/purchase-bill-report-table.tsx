"use client";

import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";
import { useColumnVisibility } from "@/lib/export/use-column-visibility";

// Purchase Bill report — one of the 3 new report pages (2026-08-22),
// following the Orders report's exact pattern (see
// reports/orders-report-table.tsx's header comment): searchParams filters
// on the server page + this client table (columns + <ExportBar />, now
// with the generic column picker).
export type PurchaseBillRow = {
  id: string;
  vendor_invoice_no: string;
  vendor_name: string;
  company_name: string;
  vendor_invoice_date: string | null;
  work_description: string | null;
  qty: number;
  sq_feet: number;
  qty_unit: string;
  unit_rate: number;
  total_amount: number;
  gst_amt: number;
  round_off_amt: number;
  g_total_plus_gst: number;
  payment_status: string;
  balance_due: number | null;
};

const COLUMNS: ExportColumn<PurchaseBillRow>[] = [
  { key: "vendor_invoice_no", label: "Bill No.", value: (r) => r.vendor_invoice_no },
  { key: "vendor_name", label: "Vendor", value: (r) => r.vendor_name },
  { key: "company_name", label: "Company", value: (r) => r.company_name },
  { key: "vendor_invoice_date", label: "Bill Date", value: (r) => r.vendor_invoice_date },
  { key: "work_description", label: "Work", value: (r) => r.work_description },
  { key: "qty", label: "Qty", value: (r) => r.qty },
  { key: "sq_feet", label: "Sq Feet/Unit", value: (r) => r.sq_feet },
  { key: "qty_unit", label: "Unit", value: (r) => r.qty_unit },
  { key: "unit_rate", label: "Rate", value: (r) => r.unit_rate },
  { key: "total_amount", label: "Amount (pre-GST)", value: (r) => r.total_amount },
  { key: "gst_amt", label: "GST", value: (r) => r.gst_amt },
  { key: "round_off_amt", label: "Round Off", value: (r) => r.round_off_amt },
  { key: "g_total_plus_gst", label: "Grand Total", value: (r) => r.g_total_plus_gst },
  { key: "payment_status", label: "Payment Status", value: (r) => r.payment_status },
  { key: "balance_due", label: "Balance Due", value: (r) => r.balance_due },
];

export function PurchaseBillReportTable({
  rows,
  companies,
  vendors,
  filters,
}: {
  rows: PurchaseBillRow[];
  companies: { id: string; name: string }[];
  vendors: { id: string; name: string }[];
  filters: { companyId: string; vendorId: string; fromDate: string; toDate: string };
}) {
  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  const { visibleColumns, hiddenKeys, toggleColumn } = useColumnVisibility(COLUMNS);

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #purchase-bill-report-print-area, #purchase-bill-report-print-area * { visibility: visible; }
          #purchase-bill-report-print-area { position: fixed; inset: 0; width: 100%; }
        }
      `}</style>
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
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="vendor">Vendor Party</label>
          <select id="vendor" name="vendor" defaultValue={filters.vendorId} className={inputClass}>
            <option value="">All</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600">
          Filter
        </button>
        <a href="/dashboard/reports/purchase-bills" className="text-xs text-slate-400 underline">Clear</a>
      </form>

      <div className="flex items-center justify-between print:hidden">
        <p className="text-sm text-slate-500">
          {rows.length} purchase bills {rows.length === 1000 && "(showing up to 1000 — narrow the date range for full data)"}
        </p>
        <ExportBar
          title="Purchase Bill Report"
          filenameBase="purchase-bill-report"
          columns={visibleColumns}
          rows={rows}
          printAreaId="purchase-bill-report-print-area"
          allColumns={COLUMNS}
          hiddenKeys={hiddenKeys}
          onToggleColumn={toggleColumn}
        />
      </div>

      <div id="purchase-bill-report-print-area" className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
                <td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-slate-400">No purchase bills found for this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
