"use client";

import { ExportBar } from "@/components/export-bar";
import { PrintArea } from "@/components/print-view";
import type { ExportColumn } from "@/lib/export/export-table";
import { useColumnVisibility } from "@/lib/export/use-column-visibility";

// Freight/Duty Bill report (2026-08-22) — one of the 3 new report pages,
// following the Orders report's exact pattern. Two tables (Freight, Duty)
// for the same reason Returns keeps two — see returns-report-tables.tsx's
// header comment — freight_bills and duty_tax_bills are genuinely
// different bill types with different figures, and one shared table would
// either lose columns or pad both with blanks. Both are per-shipment rows
// (sourced from freight_reconciliation_view / duty_reconciliation_view —
// see page.tsx's header comment for why), which is what makes date-range/
// company/courier filtering meaningful — freight_bills/duty_tax_bills
// themselves have neither a company_id nor a fixed courier, but a bill's
// assigned SHIPMENT does (via its order).

export type FreightReportRow = {
  id: string;
  freight_invoice_no: string;
  invoice_date: string | null;
  vendor_name: string;
  company_name: string;
  po_no: string | null;
  order_date: string | null;
  awb_no: string | null;
  buyer_country: string | null;
  our_shipping_amt: number | null;
  gst_18pct: number | null;
  gross_shipping_amt: number | null;
  bill_weight_kg: number | null;
  dimensional_weight: number | null;
  difference_amt: number | null;
};

const FREIGHT_COLUMNS: ExportColumn<FreightReportRow>[] = [
  { key: "freight_invoice_no", label: "Freight Invoice No.", value: (r) => r.freight_invoice_no },
  { key: "invoice_date", label: "Invoice Date", value: (r) => r.invoice_date },
  { key: "vendor_name", label: "Courier / Vendor", value: (r) => r.vendor_name },
  { key: "company_name", label: "Company", value: (r) => r.company_name },
  { key: "po_no", label: "PO/RF/RG", value: (r) => r.po_no },
  { key: "order_date", label: "Order Date", value: (r) => r.order_date },
  { key: "awb_no", label: "AWB No.", value: (r) => r.awb_no },
  { key: "buyer_country", label: "Buyer Country", value: (r) => r.buyer_country },
  { key: "our_shipping_amt", label: "Our Shipping Amt", value: (r) => r.our_shipping_amt },
  { key: "gst_18pct", label: "GST 18%", value: (r) => r.gst_18pct },
  { key: "gross_shipping_amt", label: "Gross Shipping Amt", value: (r) => r.gross_shipping_amt },
  { key: "bill_weight_kg", label: "Bill Weight (kg)", value: (r) => r.bill_weight_kg },
  { key: "dimensional_weight", label: "Dimensional Weight (kg)", value: (r) => r.dimensional_weight },
  { key: "difference_amt", label: "Difference Amt", value: (r) => r.difference_amt },
];

export function FreightReportTable({ rows }: { rows: FreightReportRow[] }) {
  const { visibleColumns, hiddenKeys, toggleColumn } = useColumnVisibility(FREIGHT_COLUMNS);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">🚚 Freight (Courier) Bills — per shipment</h2>
          <p className="text-xs text-slate-400">{rows.length} shipment(s)</p>
        </div>
        <ExportBar
          title="Freight Bill Report"
          filenameBase="freight-bill-report"
          columns={visibleColumns}
          rows={rows}
          printAreaId="freight-report-print-area"
          allColumns={FREIGHT_COLUMNS}
          hiddenKeys={hiddenKeys}
          onToggleColumn={toggleColumn}
        />
      </div>
      <PrintArea id="freight-report-print-area">
      <div className="overflow-x-auto">
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
                <td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-slate-400">No freight bill shipments found for this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </PrintArea>
    </div>
  );
}

export type DutyReportRow = {
  id: string;
  duty_invoice_no: string;
  invoice_date: string | null;
  vendor_name: string;
  company_name: string;
  po_no: string | null;
  order_date: string | null;
  awb_no: string | null;
  buyer_country: string | null;
  duty_tax_amt_usd: number | null;
  duty_tax_amt_inr: number | null;
  other_charge: number | null;
  gst_18pct: number | null;
  duty_gross_amt: number | null;
  shipping_amt: number | null;
  shipping_and_duty: number | null;
};

const DUTY_COLUMNS: ExportColumn<DutyReportRow>[] = [
  { key: "duty_invoice_no", label: "Duty Invoice No.", value: (r) => r.duty_invoice_no },
  { key: "invoice_date", label: "Invoice Date", value: (r) => r.invoice_date },
  { key: "vendor_name", label: "Courier / Vendor", value: (r) => r.vendor_name },
  { key: "company_name", label: "Company", value: (r) => r.company_name },
  { key: "po_no", label: "PO/RF/RG", value: (r) => r.po_no },
  { key: "order_date", label: "Order Date", value: (r) => r.order_date },
  { key: "awb_no", label: "AWB No.", value: (r) => r.awb_no },
  { key: "buyer_country", label: "Buyer Country", value: (r) => r.buyer_country },
  { key: "duty_tax_amt_usd", label: "Duty/Tax Amt (USD)", value: (r) => r.duty_tax_amt_usd },
  { key: "duty_tax_amt_inr", label: "Duty/Tax Amt (INR)", value: (r) => r.duty_tax_amt_inr },
  { key: "other_charge", label: "Other Charge", value: (r) => r.other_charge },
  { key: "gst_18pct", label: "GST 18%", value: (r) => r.gst_18pct },
  { key: "duty_gross_amt", label: "Duty Gross Amt", value: (r) => r.duty_gross_amt },
  { key: "shipping_amt", label: "Shipping Amt", value: (r) => r.shipping_amt },
  { key: "shipping_and_duty", label: "Shipping + Duty", value: (r) => r.shipping_and_duty },
];

export function DutyReportTable({ rows }: { rows: DutyReportRow[] }) {
  const { visibleColumns, hiddenKeys, toggleColumn } = useColumnVisibility(DUTY_COLUMNS);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">📦 Duty &amp; Tax Bills — per shipment</h2>
          <p className="text-xs text-slate-400">{rows.length} shipment(s)</p>
        </div>
        <ExportBar
          title="Duty & Tax Bill Report"
          filenameBase="duty-tax-bill-report"
          columns={visibleColumns}
          rows={rows}
          printAreaId="duty-report-print-area"
          allColumns={DUTY_COLUMNS}
          hiddenKeys={hiddenKeys}
          onToggleColumn={toggleColumn}
        />
      </div>
      <PrintArea id="duty-report-print-area">
      <div className="overflow-x-auto">
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
                <td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-slate-400">No duty/tax bill shipments found for this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </PrintArea>
    </div>
  );
}
