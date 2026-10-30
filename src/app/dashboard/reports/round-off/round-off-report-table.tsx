"use client";

import { ExportBar } from "@/components/export-bar";
import { PrintArea } from "@/components/print-view";
import type { ExportColumn } from "@/lib/export/export-table";
import { sumNumericColumn } from "@/lib/export/export-table";
import { useColumnVisibility } from "@/lib/export/use-column-visibility";

// Round Off report (2026-10-31) — see page.tsx's header comment for the grain
// (one row per document) and the per-document sign conventions. Same
// columns + <ExportBar /> + column-picker pattern as every other report on
// this hub, so CSV/Excel/Print/WhatsApp work with no extra code.
export type RoundOffRow = {
  id: string;
  doc_type: string;
  doc_no: string;
  doc_date: string | null;
  /** Payable BEFORE the rounding (GST inclusive where the document has GST). */
  gross: number;
  round_off: number;
  /** Payable AFTER the rounding — always gross + round_off. */
  net: number;
};

const COLUMNS: ExportColumn<RoundOffRow>[] = [
  { key: "doc_date", label: "Date", value: (r) => r.doc_date },
  { key: "doc_type", label: "Document Type", value: (r) => r.doc_type },
  { key: "doc_no", label: "Document No.", value: (r) => r.doc_no },
  { key: "gross", label: "Gross Amount", value: (r) => r.gross },
  { key: "round_off", label: "Round Off", value: (r) => r.round_off },
  { key: "net", label: "Net Amount", value: (r) => r.net },
];

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function RoundOffReportTable({
  rows,
  companies,
  filters,
}: {
  rows: RoundOffRow[];
  companies: { id: string; name: string }[];
  filters: { companyId: string; fromDate: string; toDate: string };
}) {
  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  const { visibleColumns, hiddenKeys, toggleColumn } = useColumnVisibility(COLUMNS);

  // Grand total for the period — summed from the same rows the table shows,
  // so the footer can never disagree with the visible list.
  const totalGross = rows.reduce((s, r) => s + r.gross, 0);
  const totalRoundOff = rows.reduce((s, r) => s + r.round_off, 0);
  const totalNet = rows.reduce((s, r) => s + r.net, 0);
  const added = totalRoundOff > 0;
  const docTypeCount = new Set(rows.map((r) => r.doc_type)).size;

  return (
    <div className="space-y-4">
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
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600">
          Filter
        </button>
        <a href="/dashboard/reports/round-off" className="text-xs text-slate-400 underline">Clear</a>
        <p className="ml-auto text-[11px] text-slate-400">
          Company filter applies to Purchase / Washing / Debit / Credit / Internal / JV. Freight &amp; Duty bills carry no
          company (one courier invoice can span several), so they always show.
        </p>
      </form>

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">Documents</p>
          <p className="text-lg font-semibold text-slate-900">{rows.length}</p>
          <p className="text-[11px] text-slate-400">{docTypeCount} document type(s)</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">Gross (before rounding)</p>
          <p className="text-lg font-semibold text-slate-900 tabular-nums">₹{money(totalGross)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs text-slate-500">Round off total</p>
          <p className={`text-lg font-semibold tabular-nums ${totalRoundOff === 0 ? "text-slate-900" : added ? "text-emerald-700" : "text-rose-700"}`}>
            {totalRoundOff === 0 ? "₹0.00" : `${added ? "+" : "−"}₹${money(Math.abs(totalRoundOff))}`}
          </p>
          <p className="text-[11px] text-slate-400">{added ? "added to payables" : "deducted from payables"}</p>
        </div>
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs text-amber-800">Net payable (period total)</p>
          <p className="text-lg font-semibold text-amber-900 tabular-nums">₹{money(totalNet)}</p>
        </div>
      </div>

      <div className="flex items-center justify-between print:hidden">
        <p className="text-sm text-slate-500">
          {rows.length} document{rows.length === 1 ? "" : "s"} with a round off{rows.length === 2000 * 8 && " (limit reached — narrow the date range)"}
        </p>
        <ExportBar
          title="Round Off Report"
          filenameBase="round-off-report"
          columns={visibleColumns}
          rows={rows}
          printAreaId="round-off-report-print-area"
          allColumns={COLUMNS}
          hiddenKeys={hiddenKeys}
          onToggleColumn={toggleColumn}
        />
      </div>

      <PrintArea id="round-off-report-print-area"><div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              {visibleColumns.map((c) => (
                <th key={c.key} className={`whitespace-nowrap px-3 py-2 text-xs font-semibold text-slate-500 ${c.key === "gross" || c.key === "round_off" || c.key === "net" ? "text-right" : "text-left"}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                {visibleColumns.map((c) => {
                  const v = c.value(r);
                  const isMoney = c.key === "gross" || c.key === "round_off" || c.key === "net";
                  return (
                    <td
                      key={c.key}
                      className={`whitespace-nowrap px-3 py-2 ${isMoney ? "text-right tabular-nums text-slate-800" : "text-slate-700"} ${
                        c.key === "round_off" && typeof v === "number" && v > 0 ? "text-emerald-700" : ""
                      } ${c.key === "round_off" && typeof v === "number" && v < 0 ? "text-rose-700" : ""}`}
                    >
                      {isMoney && typeof v === "number"
                        ? c.key === "round_off"
                          ? `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`
                          : v.toFixed(2)
                        : (v ?? "")}
                    </td>
                  );
                })}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-slate-400">
                  No round-off entries found for this period.
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
              <tr>
                {visibleColumns.map((c, i) => {
                  const sum = sumNumericColumn(rows, c);
                  const isMoney = c.key === "gross" || c.key === "round_off" || c.key === "net";
                  return (
                    <td key={c.key} className={`whitespace-nowrap px-3 py-2 text-slate-800 ${isMoney ? "text-right tabular-nums" : ""}`}>
                      {i === 0 ? `GRAND TOTAL (${rows.length})` : sum !== null ? money(sum) : ""}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
      </div></PrintArea>
    </div>
  );
}
