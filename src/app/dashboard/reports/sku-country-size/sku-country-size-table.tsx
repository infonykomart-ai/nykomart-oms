"use client";

import Link from "next/link";
import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";

type AggRow = { label: string; orders: number; qty: number; valueInr: number; valueUsd: number };
type ComboRow = { sku: string; country: string; size: string; orders: number; qty: number; valueInr: number; valueUsd: number };

const STATUSES = ["Pending", "Confirmed", "In Production", "Dispatched", "Delivered", "Cancelled", "Returned"];

function aggColumns(labelHeader: string): ExportColumn<AggRow>[] {
  return [
    { key: "label", label: labelHeader, value: (r) => r.label },
    { key: "orders", label: "Orders", value: (r) => r.orders },
    { key: "qty", label: "Qty", value: (r) => r.qty },
    { key: "valueInr", label: "Value (INR)", value: (r) => Number(r.valueInr.toFixed(2)) },
    { key: "valueUsd", label: "Value (USD)", value: (r) => Number(r.valueUsd.toFixed(2)) },
  ];
}

const COMBO_COLUMNS: ExportColumn<ComboRow>[] = [
  { key: "sku", label: "SKU", value: (r) => r.sku },
  { key: "country", label: "Country", value: (r) => r.country },
  { key: "size", label: "Size", value: (r) => r.size },
  { key: "orders", label: "Orders", value: (r) => r.orders },
  { key: "qty", label: "Qty", value: (r) => r.qty },
  { key: "valueInr", label: "Value (INR)", value: (r) => Number(r.valueInr.toFixed(2)) },
  { key: "valueUsd", label: "Value (USD)", value: (r) => Number(r.valueUsd.toFixed(2)) },
];

function AggTable({ title, labelHeader, rows, printId }: { title: string; labelHeader: string; rows: AggRow[]; printId: string }) {
  const columns = aggColumns(labelHeader);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between print:hidden">
        <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
        <ExportBar title={title} filenameBase={printId} columns={columns} rows={rows} printAreaId={printId} />
      </div>
      <div id={printId} className="max-h-96 overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              {columns.map((c) => (
                <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.label} className="hover:bg-slate-50">
                <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">{r.label}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.orders}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.qty}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">₹{r.valueInr.toFixed(2)}</td>
                <td className="whitespace-nowrap px-3 py-2 text-slate-700">${r.valueUsd.toFixed(2)}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-3 py-6 text-center text-slate-400">No data for this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SkuCountrySizeTable({
  companies,
  filters,
  totalOrders,
  limited,
  bySku,
  bySize,
  byCountry,
  combined,
}: {
  companies: { id: string; name: string }[];
  filters: { companyId: string; status: string; fromDate: string; toDate: string };
  totalOrders: number;
  limited: boolean;
  bySku: AggRow[];
  bySize: AggRow[];
  byCountry: AggRow[];
  combined: ComboRow[];
}) {
  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-slate-900">📊 SKU × Country × Size Report</h1>
          <Link href="/dashboard/reports" className="text-sm text-slate-500 hover:underline">← Orders Report</Link>
        </div>
        <p className="mt-1 text-sm text-slate-500">
          Konsa SKU jyada sale ho raha, konsa size jyada bik raha, kis country mein order jyada hai — Value (INR) hamesha order_value_inr se hai (Cancelled orders excluded).
        </p>
      </div>

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
            <option value="">All (except Cancelled)</option>
            {STATUSES.filter((s) => s !== "Cancelled").map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600">
          Filter
        </button>
        <a href="/dashboard/reports/sku-country-size" className="text-xs text-slate-400 underline">Clear</a>
      </form>

      <p className="text-xs text-slate-500 print:hidden">
        {totalOrders} orders {limited && "(showing up to 5000 — narrow the date range for full data)"}
      </p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <AggTable title="Top SKUs" labelHeader="SKU" rows={bySku} printId="sku-report-area" />
        <AggTable title="Top Sizes" labelHeader="Size" rows={bySize} printId="size-report-area" />
        <AggTable title="Top Countries" labelHeader="Country" rows={byCountry} printId="country-report-area" />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between print:hidden">
          <h2 className="text-sm font-semibold text-slate-800">SKU × Country × Size (detailed)</h2>
          <ExportBar title="SKU x Country x Size" filenameBase="sku-country-size-report" columns={COMBO_COLUMNS} rows={combined} printAreaId="combo-report-area" />
        </div>
        <div id="combo-report-area" className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                {COMBO_COLUMNS.map((c) => (
                  <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {combined.map((r, i) => (
                <tr key={`${r.sku}-${r.country}-${r.size}-${i}`} className="hover:bg-slate-50">
                  <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-900">{r.sku}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.country}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.size}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.orders}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">{r.qty}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">₹{r.valueInr.toFixed(2)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-700">${r.valueUsd.toFixed(2)}</td>
                </tr>
              ))}
              {combined.length === 0 && (
                <tr>
                  <td colSpan={COMBO_COLUMNS.length} className="px-3 py-8 text-center text-slate-400">No orders found for this filter.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
