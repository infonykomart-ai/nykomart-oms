"use client";

import { ExportBar } from "@/components/export-bar";
import { PrintArea } from "@/components/print-view";
import type { ExportColumn } from "@/lib/export/export-table";
import { useColumnVisibility } from "@/lib/export/use-column-visibility";

// Party Ledger / Bill Payment Outstanding report (2026-08-22) — one of the
// 3 new report pages. See page.tsx's header comment for the grain choice
// (one row per open bill, not one row per party) and how this differs
// from the per-party Party Ledger page.
export type OutstandingBillRow = {
  id: string;
  company_name: string;
  party_name: string;
  invoice_type: string | null;
  invoice_no: string | null;
  vendor_invoice_no: string | null;
  invoice_date: string | null;
  invoice_recv_date: string | null;
  due_date: string | null;
  overdue: boolean;
  total_amt: number;
  credit_note_amt: number;
  to_be_pay: number;
  total_paid: number;
  balance_due: number;
  approval_status: string;
};

const COLUMNS: ExportColumn<OutstandingBillRow>[] = [
  { key: "company_name", label: "Company", value: (r) => r.company_name },
  { key: "party_name", label: "Party", value: (r) => r.party_name },
  { key: "invoice_type", label: "Invoice Type", value: (r) => r.invoice_type },
  { key: "invoice_no", label: "Invoice No.", value: (r) => r.invoice_no },
  { key: "vendor_invoice_no", label: "Vendor Invoice No.", value: (r) => r.vendor_invoice_no },
  { key: "invoice_date", label: "Invoice Date", value: (r) => r.invoice_date },
  { key: "invoice_recv_date", label: "Invoice Recv. Date", value: (r) => r.invoice_recv_date },
  { key: "due_date", label: "Due Date", value: (r) => r.due_date },
  { key: "overdue", label: "Overdue?", value: (r) => (r.overdue ? "Yes" : "No") },
  { key: "total_amt", label: "Total Amt", value: (r) => r.total_amt },
  { key: "credit_note_amt", label: "Credit Note Amt", value: (r) => r.credit_note_amt },
  { key: "to_be_pay", label: "To Be Paid", value: (r) => r.to_be_pay },
  { key: "total_paid", label: "Total Paid", value: (r) => r.total_paid },
  { key: "balance_due", label: "Balance Due", value: (r) => r.balance_due },
  { key: "approval_status", label: "Approval Status", value: (r) => r.approval_status },
];

export function OutstandingReportTable({
  rows,
  companies,
  parties,
  filters,
}: {
  rows: OutstandingBillRow[];
  companies: { id: string; name: string }[];
  parties: { id: string; name: string }[];
  filters: { companyId: string; partyId: string; overdue: string };
}) {
  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  const { visibleColumns, hiddenKeys, toggleColumn } = useColumnVisibility(COLUMNS);

  const totalOutstanding = rows.reduce((sum, r) => sum + r.balance_due, 0);

  return (
    <div className="space-y-4">
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
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="party">Party</label>
          <select id="party" name="party" defaultValue={filters.partyId} className={inputClass}>
            <option value="">All</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="overdue">Overdue Status</label>
          <select id="overdue" name="overdue" defaultValue={filters.overdue} className={inputClass}>
            <option value="">All</option>
            <option value="overdue">Overdue only</option>
            <option value="not_due">Not yet due</option>
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600">
          Filter
        </button>
        <a href="/dashboard/reports/outstanding" className="text-xs text-slate-400 underline">Clear</a>
      </form>

      <div className="flex items-center justify-between print:hidden">
        <p className="text-sm text-slate-500">
          {rows.length} open bill(s) · Total outstanding:{" "}
          <span className="font-semibold text-slate-800">₹{totalOutstanding.toFixed(2)}</span>
        </p>
        <ExportBar
          title="Party Ledger / Bill Payment Outstanding Report"
          filenameBase="outstanding-balances-report"
          columns={visibleColumns}
          rows={rows}
          printAreaId="outstanding-report-print-area"
          allColumns={COLUMNS}
          hiddenKeys={hiddenKeys}
          onToggleColumn={toggleColumn}
        />
      </div>

      <PrintArea id="outstanding-report-print-area"><div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
              <tr key={r.id} className={r.overdue ? "bg-red-50/50 hover:bg-red-50" : "hover:bg-slate-50"}>
                {visibleColumns.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-3 py-2 text-slate-700">{String(c.value(r) ?? "")}</td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-slate-400">No outstanding bills found for this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div></PrintArea>
    </div>
  );
}
