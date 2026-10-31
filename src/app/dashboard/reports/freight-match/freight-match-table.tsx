"use client";

import { ExportBar } from "@/components/export-bar";
import { PrintArea } from "@/components/print-view";
import type { ExportColumn } from "@/lib/export/export-table";
import { sumNumericColumn as sumColumn, fmtColumnTotal as fmtTotal } from "@/lib/export/export-table";
import { useColumnVisibility } from "@/lib/export/use-column-visibility";

// 2026-11-03 — Courier 3-way match + disputed-AWB ageing table. Client
// component for the same reason every ExportColumn-driven report is one:
// `value` FUNCTIONS cannot cross the server/client boundary (see
// freight-duty-report-tables.tsx).
//
// "Variance" columns are signed from OUR side: positive = we were charged more
// than the rate card / more than we booked. The match chip deliberately bands
// small paise (₹50 or 2%, whichever is larger) as "OK", because a courier bill
// rounded by a rupee is not a rate-card failure and must not bury the real
// outliers.

export type FreightMatchKind = "Freight" | "Duty";

export type FreightMatchRow = {
  id: string;
  kind: FreightMatchKind;
  invoice_no: string;
  invoice_date: string | null;
  company_name: string;
  vendor_name: string;
  awb_no: string | null;
  ref_no: string;
  courier_name: string | null;
  zone_label: string | null;
  weight_kg: number | null;
  rate_card_expected_inr: number | null;
  booked_amt: number | null;
  booked_currency: string | null;
  booked_variance_inr: number | null;
  billed_pretax_inr: number;
  billed_gst_inr: number;
  billed_gross_inr: number;
  cn_allocated_inr: number;
  net_cost_inr: number;
  rate_card_variance_inr: number | null;
  rate_card_variance_pct: number | null;
  dispute_status: "none" | "under_dispute" | "resolved";
  dispute_amount_inr: number;
  dispute_reason: string | null;
  dispute_raised_on: string | null;
  dispute_days_open: number | null;
};

const COLUMNS: ExportColumn<FreightMatchRow>[] = [
  { key: "kind", label: "Bill Type", value: (r) => r.kind },
  { key: "invoice_no", label: "Invoice No.", value: (r) => r.invoice_no },
  { key: "invoice_date", label: "Invoice Date", value: (r) => r.invoice_date },
  { key: "company_name", label: "Company", value: (r) => r.company_name },
  { key: "vendor_name", label: "Courier / Vendor", value: (r) => r.vendor_name },
  { key: "awb_no", label: "AWB No.", value: (r) => r.awb_no },
  { key: "ref_no", label: "PO/RF/RG", value: (r) => r.ref_no },
  { key: "courier_name", label: "Courier (shipment)", value: (r) => r.courier_name },
  { key: "zone_label", label: "Zone / Country", value: (r) => r.zone_label },
  { key: "weight_kg", label: "Bill Weight (kg)", value: (r) => r.weight_kg },
  { key: "rate_card_expected_inr", label: "Rate Card (₹)", value: (r) => r.rate_card_expected_inr },
  { key: "booked_amt", label: "Booked", value: (r) => (r.booked_amt == null ? null : `${r.booked_currency ?? "INR"} ${r.booked_amt.toFixed(2)}`) },
  { key: "booked_variance_inr", label: "Booked − Rate Card (₹)", value: (r) => r.booked_variance_inr },
  { key: "billed_pretax_inr", label: "Billed Pre-Tax (₹)", value: (r) => r.billed_pretax_inr },
  { key: "billed_gst_inr", label: "GST (₹)", value: (r) => r.billed_gst_inr },
  { key: "billed_gross_inr", label: "Billed Gross (₹)", value: (r) => r.billed_gross_inr },
  { key: "cn_allocated_inr", label: "CN / DN Allocated (₹)", value: (r) => r.cn_allocated_inr },
  { key: "net_cost_inr", label: "Net Cost (₹)", value: (r) => r.net_cost_inr },
  { key: "rate_card_variance_inr", label: "Net − Rate Card (₹)", value: (r) => r.rate_card_variance_inr },
  { key: "rate_card_variance_pct", label: "Net vs Rate Card %", value: (r) => (r.rate_card_variance_pct == null ? null : `${r.rate_card_variance_pct.toFixed(1)}%`) },
  { key: "dispute_status", label: "Dispute", value: (r) => (r.dispute_status === "under_dispute" ? "UNDER DISPUTE" : r.dispute_status === "resolved" ? "Resolved" : "") },
  { key: "dispute_days_open", label: "Days Open", value: (r) => r.dispute_days_open },
  { key: "dispute_amount_inr", label: "Held (₹)", value: (r) => r.dispute_amount_inr },
  { key: "dispute_reason", label: "Dispute Reason", value: (r) => r.dispute_reason },
  { key: "dispute_raised_on", label: "Dispute Raised On", value: (r) => r.dispute_raised_on },
];

function matchBand(r: FreightMatchRow): { label: string; className: string } {
  if (r.kind === "Duty") return { label: "—", className: "text-slate-300" };
  if (r.rate_card_expected_inr == null) return { label: "no rate card", className: "bg-slate-100 text-slate-500" };
  const variance = r.rate_card_variance_inr ?? 0;
  const tolerance = Math.max(50, r.rate_card_expected_inr * 0.02);
  if (Math.abs(variance) <= tolerance) return { label: "✓ OK", className: "bg-emerald-100 text-emerald-800" };
  return variance > 0
    ? { label: "⚠ Above rate card", className: "bg-red-100 text-red-800" }
    : { label: "↓ Below rate card", className: "bg-amber-100 text-amber-800" };
}

export function FreightMatchTable({ rows, today }: { rows: FreightMatchRow[]; today: string }) {
  const { visibleColumns, hiddenKeys, toggleColumn } = useColumnVisibility(COLUMNS);
  const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-800">🔍 Courier 3-Way Match — per AWB</h2>
          <p className="text-xs text-slate-400">
            {rows.length} row(s) · as on {today} · rate card → booked → billed, net of that AWB&apos;s credit/debit notes
          </p>
        </div>
        <ExportBar
          title="Courier 3-Way Match & Disputes"
          filenameBase="courier-3way-match"
          columns={visibleColumns}
          rows={rows}
          printAreaId="freight-match-print-area"
          allColumns={COLUMNS}
          hiddenKeys={hiddenKeys}
          onToggleColumn={toggleColumn}
        />
      </div>

      <PrintArea id="freight-match-print-area">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                {visibleColumns.map((c) => (
                  <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-slate-500">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const band = matchBand(r);
                return (
                  <tr key={r.id} className={r.dispute_status === "under_dispute" ? "bg-red-50/60" : "hover:bg-slate-50"}>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{r.kind}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-medium text-slate-800">{r.invoice_no}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{r.invoice_date ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{r.company_name}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{r.vendor_name}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{r.awb_no ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-700">{r.ref_no}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{r.courier_name ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{r.zone_label ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-600">{r.weight_kg ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-700">
                      {r.rate_card_expected_inr == null ? "—" : money(r.rate_card_expected_inr)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-600">
                      {r.booked_amt == null ? "—" : `${r.booked_currency ?? "INR"} ${money(r.booked_amt)}`}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-600">
                      {r.booked_variance_inr == null ? "—" : money(r.booked_variance_inr)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-700">{money(r.billed_pretax_inr)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-600">{money(r.billed_gst_inr)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-700">{money(r.billed_gross_inr)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-purple-700">
                      {r.cn_allocated_inr === 0 ? "—" : money(r.cn_allocated_inr)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right font-semibold text-slate-900">{money(r.net_cost_inr)}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] ${band.className}`}>
                        {r.rate_card_variance_inr == null ? band.label : `${band.label} · ${money(r.rate_card_variance_inr)}`}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-slate-600">
                      {r.rate_card_variance_pct == null ? "—" : `${r.rate_card_variance_pct.toFixed(1)}%`}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5">
                      {r.dispute_status === "under_dispute" ? (
                        <span className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-800">⚑ Under dispute</span>
                      ) : r.dispute_status === "resolved" ? (
                        <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[11px] text-emerald-800">✓ Resolved</span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-red-700">
                      {r.dispute_days_open == null ? "—" : `${r.dispute_days_open}d`}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-right text-red-700">
                      {r.dispute_amount_inr === 0 ? "—" : money(r.dispute_amount_inr)}
                    </td>
                    <td className="max-w-[16rem] truncate px-3 py-1.5 text-slate-600" title={r.dispute_reason ?? ""}>
                      {r.dispute_reason ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-600">{r.dispute_raised_on ?? "—"}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-slate-400">
                    No courier/duty bill AWBs found for this filter.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                <tr>
                  {visibleColumns.map((c, i) => {
                    const sum = sumColumn(rows, c);
                    return (
                      <td key={c.key} className="whitespace-nowrap px-3 py-2 text-slate-800">
                        {i === 0 ? `Total (${rows.length})` : sum !== null ? fmtTotal(sum) : ""}
                      </td>
                    );
                  })}
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PrintArea>

      <p className="mt-2 text-[11px] text-slate-400">
        Rate card = courier_rate_cards (base + per-kg × bill weight + fuel % + other) matched on company + courier + zone
        (order&apos;s destination country) + weight slab. ✓ OK = within ₹50 or 2% of the card. Net = billed gross − that
        AWB&apos;s CN/DN share. Disputed AWBs keep their ledger payable; only the payment is held.
      </p>
    </div>
  );
}
