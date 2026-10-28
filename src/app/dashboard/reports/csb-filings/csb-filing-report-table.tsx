"use client";

import { ExportBar } from "@/components/export-bar";
import { PrintArea } from "@/components/print-view";
import type { ExportColumn } from "@/lib/export/export-table";
import { sumNumericColumn, fmtColumnTotal } from "@/lib/export/export-table";
import { useColumnVisibility } from "@/lib/export/use-column-visibility";

// CSB Filing report (2026-10-28) — same server-page + client-table pattern as
// the other Reports hub pages: the server page owns the filters (filing date
// range, company) and the order join, this table owns the column picker and
// every export format. Column selection lives in useColumnVisibility, so what
// is ticked is exactly what CSV/Excel/Word/PDF/WhatsApp contain — the user
// asked "konkonse column chahiye" and can now pick per report.
export type CsbFilingReportRow = {
  id: string;
  // CSB register (csb_filings)
  csb_number: string;
  filing_date: string | null;
  egm_number: string | null;
  egm_date: string | null;
  hawb_number: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  exchange_rate: number | null;
  total_taxable_value: number | null;
  taxable_value_currency: string | null;
  fob_value_inr: number | null;
  // Order side (joined through HAWB → order_shipments / invoice → dispatch_invoices)
  order_ref_no: string;
  company_name: string;
  store_name: string;
  order_date: string | null;
  po_date: string | null;
  delivery_date: string | null;
  dispatch_date: string | null;
  order_status: string;
  marketplace_order_no: string;
  buyer_name_address: string;
  buyer_country: string;
  buyer_city: string;
  buyer_state: string;
  buyer_postal_code: string;
  contact_no: string;
  email_id: string;
  qty: number | null;
  sku_label: string;
  size_label: string;
  item_category: string;
  courier_name: string;
  awb_no: string;
  forwarding_no: string;
  delivered_status: string;
  delivered_date: string | null;
  booked_freight: string;
  invoice_amt_inr: number | null;
  invoice_amt_usd: number | null;
  hsn_no: string;
  remark: string;
  order_count: number;
};

const COLUMNS: ExportColumn<CsbFilingReportRow>[] = [
  // --- CSB filing register ---
  { key: "csb_number", label: "CSB Number", value: (r) => r.csb_number },
  { key: "filing_date", label: "Filing Date", value: (r) => r.filing_date },
  { key: "egm_number", label: "EGM No.", value: (r) => r.egm_number },
  { key: "egm_date", label: "EGM Date", value: (r) => r.egm_date },
  { key: "hawb_number", label: "HAWB / AWB No.", value: (r) => r.hawb_number },
  { key: "invoice_no", label: "Invoice No.", value: (r) => r.invoice_no },
  { key: "invoice_date", label: "Invoice Date", value: (r) => r.invoice_date },
  { key: "exchange_rate", label: "Exchange Rate", value: (r) => r.exchange_rate },
  { key: "total_taxable_value", label: "Total Taxable Value", value: (r) => r.total_taxable_value },
  { key: "taxable_value_currency", label: "Taxable Value Currency", value: (r) => r.taxable_value_currency },
  { key: "fob_value_inr", label: "FOB Value (INR)", value: (r) => r.fob_value_inr },

  // --- Order side ---
  { key: "order_ref_no", label: "PO / RF / RG No.", value: (r) => r.order_ref_no },
  { key: "company_name", label: "Company", value: (r) => r.company_name },
  { key: "store_name", label: "Store", value: (r) => r.store_name },
  { key: "order_date", label: "Order Date", value: (r) => r.order_date },
  { key: "po_date", label: "PO Date", value: (r) => r.po_date },
  { key: "delivery_date", label: "Delivery Date", value: (r) => r.delivery_date },
  { key: "dispatch_date", label: "Dispatch Date", value: (r) => r.dispatch_date },
  { key: "order_status", label: "Order Status", value: (r) => r.order_status },
  { key: "marketplace_order_no", label: "Marketplace Order No.", value: (r) => r.marketplace_order_no },
  { key: "buyer_name_address", label: "Buyer Name & Address", value: (r) => r.buyer_name_address },
  { key: "buyer_country", label: "Buyer Country", value: (r) => r.buyer_country },
  { key: "buyer_city", label: "Buyer City", value: (r) => r.buyer_city },
  { key: "buyer_state", label: "Buyer State", value: (r) => r.buyer_state },
  { key: "buyer_postal_code", label: "Buyer Postcode", value: (r) => r.buyer_postal_code },
  { key: "contact_no", label: "Contact No.", value: (r) => r.contact_no },
  { key: "email_id", label: "Email", value: (r) => r.email_id },
  { key: "qty", label: "Qty", value: (r) => r.qty },
  { key: "sku_label", label: "SKU", value: (r) => r.sku_label },
  { key: "size_label", label: "Size", value: (r) => r.size_label },
  { key: "item_category", label: "Item Category", value: (r) => r.item_category },
  { key: "hsn_no", label: "HSN", value: (r) => r.hsn_no },
  { key: "courier_name", label: "Courier", value: (r) => r.courier_name },
  { key: "awb_no", label: "AWB No.", value: (r) => r.awb_no },
  { key: "forwarding_no", label: "Forwarding No.", value: (r) => r.forwarding_no },
  { key: "delivered_status", label: "Delivered Status", value: (r) => r.delivered_status },
  { key: "delivered_date", label: "Delivered Date", value: (r) => r.delivered_date },
  { key: "booked_freight", label: "Booked Freight", value: (r) => r.booked_freight },
  { key: "invoice_amt_inr", label: "Invoice Value (INR)", value: (r) => r.invoice_amt_inr },
  { key: "invoice_amt_usd", label: "Invoice Value (USD)", value: (r) => r.invoice_amt_usd },
  { key: "order_count", label: "Orders Matched", value: (r) => r.order_count },
  { key: "remark", label: "Order Remark", value: (r) => r.remark },
];

export function CsbFilingReportTable({
  rows,
  companies,
  filters,
}: {
  rows: CsbFilingReportRow[];
  companies: { id: string; name: string }[];
  filters: { fromDate: string; toDate: string; companyId: string };
}) {
  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  const { visibleColumns, hiddenKeys, toggleColumn } = useColumnVisibility(COLUMNS);
  const unmatched = rows.filter((r) => r.order_count === 0).length;

  return (
    <div className="space-y-4">
      <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 print:hidden">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="from">Filing date — from</label>
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
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600">
          Filter
        </button>
        <a href="/dashboard/reports/csb-filings" className="text-xs text-slate-400 underline">Clear</a>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
        <p className="text-sm text-slate-500">
          {rows.length} CSB filings {rows.length === 1000 && "(showing up to 1000 — narrow the date range for full data)"}
          {unmatched > 0 && (
            <span className="ml-2 text-amber-700">
              · {unmatched} ka koi order match nahi hua (HAWB/Invoice no order me nahi mila — sirf CSB columns bhare hain)
            </span>
          )}
        </p>
        <ExportBar
          title="CSB Filing Report"
          filenameBase="csb-filing-report"
          columns={visibleColumns}
          rows={rows}
          printAreaId="csb-filing-report-print-area"
          allColumns={COLUMNS}
          hiddenKeys={hiddenKeys}
          onToggleColumn={toggleColumn}
        />
      </div>

      <PrintArea id="csb-filing-report-print-area">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
                  <td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-slate-400">
                    No CSB filings found for this filing-date range.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                <tr>
                  {visibleColumns.map((c, i) => {
                    const sum = sumNumericColumn(rows, c);
                    return (
                      <td key={c.key} className="whitespace-nowrap px-3 py-2 text-slate-800">
                        {i === 0 ? `Total (${rows.length})` : sum !== null ? fmtColumnTotal(sum) : ""}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PrintArea>
    </div>
  );
}
