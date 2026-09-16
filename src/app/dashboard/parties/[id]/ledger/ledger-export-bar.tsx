"use client";

import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";
import type { LedgerPdfInput } from "@/lib/ledger-pdf";

// 2026-08-19 — "export ka option bhi karo jisme chose karne par option
// mange ki file ko kisme export karni hai pdf ya xls or... print ka
// option bhi karo": reuses the app's existing Universal Export system
// (src/components/export-bar.tsx) instead of building a separate PDF/XLS
// picker from scratch. ExportBar is a Client Component, so it's split
// into this tiny wrapper — the ledger page itself stays a Server
// Component (it needs `await requireCapability`/Supabase calls), and
// Next.js only allows passing serializable data across that
// server->client boundary, so the ExportColumn functions have to live in
// a "use client" file, same pattern as orders-report-table.tsx.
//
// 2026-09-15 — "agar ladger bhi pdf bhejni ho to pdf to whatsaap or email
// par a4 ke page par portrait me sabhi fixes ke sath jaye company logo ke
// sath": the ledger page passes the EXACT rows/totals it renders (with
// the active filters) as `pdfInput`, plus the party id. ExportBar's
// WhatsApp / Email / Telegram buttons then POST it to /api/ledger-pdf
// (access-checked, company logo re-read server-side) and attach the real
// A4-portrait PDF to the message; 📥 Save PDF downloads the same file
// without any share sheet (all inside ExportBar — see pdfEndpoint prop).
export type LedgerExportRow = {
  date: string;
  // 2026-09-13 — "sath me csv,excel, email, whatsaap pdf par jo ladger ka
  // abhi formate hai vahi export ho jaha tak hai pahle vala fourmula ho
  // raha hai": the export columns below now mirror the on-screen table
  // exactly (Invoice No. / Mode / UTR-Ref No. included, same column
  // order), so every export format shows the same revamped ledger the
  // screen shows instead of the old 5-column layout.
  invoice_no: string;
  particulars: string;
  payment_mode: string;
  reference_no: string;
  debit: number;
  credit: number;
  balance: number;
};

const COLUMNS: ExportColumn<LedgerExportRow>[] = [
  { key: "date", label: "Date", value: (r) => r.date },
  { key: "invoice_no", label: "Invoice No.", value: (r) => r.invoice_no },
  { key: "particulars", label: "Particulars", value: (r) => r.particulars },
  { key: "payment_mode", label: "Mode", value: (r) => r.payment_mode },
  { key: "reference_no", label: "UTR / Ref No.", value: (r) => r.reference_no },
  { key: "debit", label: "Debit", value: (r) => (r.debit > 0 ? r.debit : "") },
  { key: "credit", label: "Credit", value: (r) => (r.credit > 0 ? r.credit : "") },
  { key: "balance", label: "Balance", value: (r) => r.balance },
];

export function LedgerExportBar({
  partyId,
  partyName,
  rows,
  printAreaId,
  pdfInput,
}: {
  partyId: string;
  partyName: string;
  rows: LedgerExportRow[];
  printAreaId: string;
  // The on-screen rows + totals + scope — POSTed to /api/ledger-pdf for
  // the real A4 PDF attached to WhatsApp/Email/Telegram. Omit only if the
  // caller has no rows yet.
  pdfInput?: LedgerPdfInput | null;
}) {
  const filenameBase = `ledger-${partyName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <ExportBar
      title={`Party Ledger — ${partyName}`}
      filenameBase={filenameBase}
      columns={COLUMNS}
      rows={rows}
      printAreaId={printAreaId}
      whatsappPhone={pdfInput?.party.contact_no ?? null}
      pdfEndpoint={pdfInput ? "/api/ledger-pdf" : undefined}
      pdfPayload={pdfInput ? { partyId, input: pdfInput } : undefined}
      pdfFilename={`${filenameBase}.pdf`}
    />
  );
}
