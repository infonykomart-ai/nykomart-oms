"use client";

// 2026-10-24 — the invoice-number link, shared by Bill Payment and the Party
// Ledger so both open the SAME document for a bill number (see
// src/lib/bill-doc-href.ts for how the path is resolved).
//
//  - A bill that has a real source document opens that document's A4 sheet in
//    the shared PrintDialog (no navigation, prints exactly the sheet).
//  - Everything else (salary / advance / a manually typed row with no
//    matching courier bill) opens the read-only bill statement, which is the
//    only document that exists for those rows.
//  - A row with no document AND no party has nothing to open, so the number
//    is rendered as plain text instead of a dead link.
import { BillStatementDialog } from "./bill-statement-dialog";
import { PrintDialog } from "./print-dialog";
import { docSheetTitle } from "@/lib/bill-doc-href";

export const BILL_DOC_LINK_CLASS =
  "text-left font-medium underline decoration-amber-400 decoration-2 underline-offset-2 hover:text-amber-700";

export function BillDocLink({
  billId,
  docHref,
  label,
  className,
}: {
  /** The bill_pass_register id the statement fallback opens. */
  billId?: string | null;
  /** Document path from resolveBillDocHrefs — null when no document exists. */
  docHref?: string | null;
  label?: string | null;
  className?: string;
}) {
  const text = label ?? "";

  if (docHref) {
    return (
      <PrintDialog
        href={docHref}
        label={text || "📄 Sheet"}
        title={docSheetTitle(docHref)}
        subtitle="A4 preview — prints exactly this document."
        className={className ?? BILL_DOC_LINK_CLASS}
      />
    );
  }

  if (!billId) return <span>{text || "—"}</span>;

  return <BillStatementDialog billId={billId} label={text || undefined} />;
}
