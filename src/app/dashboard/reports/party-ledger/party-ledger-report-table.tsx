"use client";

import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";
import { useColumnVisibility } from "@/lib/export/use-column-visibility";

// Party/Vendor Ledger report (2026-08-22) — one of the 3 new report pages
// requested after "Reports hub — remaining scope". Generalizes the
// per-party debit/credit/running-balance ledger already at
// parties/[id]/ledger/page.tsx into a company-wide, all-parties (or
// filtered to one), exportable report on the standard Reports-hub
// ExportBar/useColumnVisibility pattern — see page.tsx's header comment
// for the exact query + running-balance logic and how it differs from the
// single-party page.
export type PartyLedgerRow = {
  id: string;
  company_name: string;
  party_name: string;
  date: string;
  particulars: string;
  type: "Debit" | "Credit";
  debit: number;
  credit: number;
  balance: number;
};

const COLUMNS: ExportColumn<PartyLedgerRow>[] = [
  { key: "company_name", label: "Company", value: (r) => r.company_name },
  { key: "party_name", label: "Party", value: (r) => r.party_name },
  { key: "date", label: "Date", value: (r) => r.date },
  { key: "particulars", label: "Particulars", value: (r) => r.particulars },
  { key: "type", label: "Type", value: (r) => r.type },
  { key: "debit", label: "Debit", value: (r) => (r.debit > 0 ? r.debit : "") },
  { key: "credit", label: "Credit", value: (r) => (r.credit > 0 ? r.credit : "") },
  { key: "balance", label: "Balance (per party)", value: (r) => r.balance },
];

export function PartyLedgerReportTable({
  rows,
  companies,
  parties,
  filters,
}: {
  rows: PartyLedgerRow[];
  companies: { id: string; name: string }[];
  parties: { id: string; name: string }[];
  filters: { companyId: string; partyId: string; from: string; to: string; type: string };
}) {
  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  const { visibleColumns, hiddenKeys, toggleColumn } = useColumnVisibility(COLUMNS);

  const totalDebit = rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit, 0);

  return (
    <div className="space-y-4">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #party-ledger-report-print-area, #party-ledger-report-print-area * { visibility: visible; }
          #party-ledger-report-print-area { position: fixed; inset: 0; width: 100%; }
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
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="party">Party</label>
          <select id="party" name="party" defaultValue={filters.partyId} className={inputClass}>
            <option value="">All parties</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
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
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="type">Type</label>
          <select id="type" name="type" defaultValue={filters.type} className={inputClass}>
            <option value="">All (Debit + Credit)</option>
            <option value="debit">Debit only (payments/credit notes)</option>
            <option value="credit">Credit only (bills)</option>
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-amber-600">
          Filter
        </button>
        <a href="/dashboard/reports/party-ledger" className="text-xs text-slate-400 underline">Clear</a>
      </form>

      <div className="flex items-center justify-between print:hidden">
        <p className="text-sm text-slate-500">
          {rows.length} entr{rows.length === 1 ? "y" : "ies"} · Total Debit:{" "}
          <span className="font-semibold text-slate-800">₹{totalDebit.toFixed(2)}</span> · Total Credit:{" "}
          <span className="font-semibold text-slate-800">₹{totalCredit.toFixed(2)}</span>
        </p>
        <ExportBar
          title="Party / Vendor Ledger Report"
          filenameBase="party-vendor-ledger-report"
          columns={visibleColumns}
          rows={rows}
          printAreaId="party-ledger-report-print-area"
          allColumns={COLUMNS}
          hiddenKeys={hiddenKeys}
          onToggleColumn={toggleColumn}
        />
      </div>

      <p className="text-xs text-slate-400 print:hidden">
        Balance shown resets per party (each party&apos;s own running balance, oldest entry first) — a positive
        balance means we owe that party; a negative balance means they&apos;re in credit with us. When multiple
        parties are shown together, rows are grouped by party before sorting by date, so Balance always reflects
        that party&apos;s own history, never a mix across parties.
      </p>

      <div id="party-ledger-report-print-area" className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
                <td colSpan={visibleColumns.length} className="px-3 py-8 text-center text-slate-400">No ledger entries found for this filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
