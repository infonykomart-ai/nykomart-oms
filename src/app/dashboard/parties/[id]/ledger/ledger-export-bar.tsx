"use client";

import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";

// 2026-08-19 — "export ka option bhi karo jisme chose karne par option
// mange ki file ko kisme export karni hai pdf ya xls or... print ka
// option bhi karo": reuses the app's existing Universal Export system
// (src/components/export-bar.tsx — already gives CSV/Excel/Word/
// PDF-via-Print/Email/WhatsApp for free from just {columns, rows}, built
// 2026-08-06 for exactly this "let the user pick the format" ask, already
// used on the Orders Report/Ad Spend Report) instead of building a
// separate PDF/XLS picker from scratch. ExportBar is a Client Component,
// so it's split into this tiny wrapper — the ledger page itself stays a
// Server Component (it needs `await requireCapability`/Supabase calls),
// and Next.js only allows passing serializable data (not functions like
// an ExportColumn's `value()`) across that server->client boundary, so
// the column definitions (which ARE functions) have to live in a "use
// client" file like this one, same pattern as
// src/app/dashboard/reports/orders-report-table.tsx.
export type LedgerExportRow = {
  date: string;
  particulars: string;
  debit: number;
  credit: number;
  balance: number;
};

const COLUMNS: ExportColumn<LedgerExportRow>[] = [
  { key: "date", label: "Date", value: (r) => r.date },
  { key: "particulars", label: "Particulars", value: (r) => r.particulars },
  { key: "debit", label: "Debit", value: (r) => (r.debit > 0 ? r.debit : "") },
  { key: "credit", label: "Credit", value: (r) => (r.credit > 0 ? r.credit : "") },
  { key: "balance", label: "Balance", value: (r) => r.balance },
];

export function LedgerExportBar({
  partyName,
  rows,
  printAreaId,
}: {
  partyName: string;
  rows: LedgerExportRow[];
  printAreaId: string;
}) {
  const filenameBase = `ledger-${partyName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <ExportBar
      title={`Party Ledger — ${partyName}`}
      filenameBase={filenameBase}
      columns={COLUMNS}
      rows={rows}
      printAreaId={printAreaId}
    />
  );
}
