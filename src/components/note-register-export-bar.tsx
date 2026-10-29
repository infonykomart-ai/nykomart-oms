"use client";

import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";

// 2026-10-29j — the download side of the Debit/Credit Note registers.
//
// These registers were print-only: "📉 Debit Note Register" ka data Excel me
// nikalna hi nahi tha (Finance ko CSV chahiye hoti hai). Same Universal Export
// system every other report uses (components/export-bar.tsx), so the register
// now gets CSV / Excel / Word / PDF from the SAME rows + the active FY/search
// filter that the screen shows — never a separate, possibly different, query.
//
// Split into its own "use client" file because the register pages are Server
// Components and ExportColumn holds functions, which cannot cross that
// boundary (same pattern as ledger-export-bar.tsx).
export type NoteRegisterExportRow = {
  party: string;
  note_no: string;
  kind: string;
  date: string;
  invoice: string;
  orders: string;
  remark: string;
  amount: number;
};

const COLUMNS: ExportColumn<NoteRegisterExportRow>[] = [
  { key: "party", label: "Party", value: (r) => r.party },
  { key: "note_no", label: "Note No.", value: (r) => r.note_no },
  { key: "kind", label: "Kind", value: (r) => r.kind },
  { key: "date", label: "Date", value: (r) => r.date },
  { key: "invoice", label: "Against Invoice", value: (r) => r.invoice },
  { key: "orders", label: "PO / Orders", value: (r) => r.orders },
  { key: "remark", label: "Remark", value: (r) => r.remark },
  { key: "amount", label: "Amount", value: (r) => r.amount },
];

export function NoteRegisterExportBar({
  title,
  filenameBase,
  rows,
  printAreaId,
}: {
  title: string;
  filenameBase: string;
  rows: NoteRegisterExportRow[];
  printAreaId: string;
}) {
  // An empty register must not offer a download of nothing.
  if (rows.length === 0) return null;
  return (
    <ExportBar
      title={title}
      filenameBase={filenameBase}
      columns={COLUMNS}
      rows={rows}
      printAreaId={printAreaId}
    />
  );
}
