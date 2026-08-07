"use client";

import { useState, useTransition } from "react";
import {
  type ExportColumn,
  downloadCSV,
  downloadXLSX,
  downloadDoc,
  mailtoLink,
  buildSummaryText,
  shareOnWhatsApp,
} from "@/lib/export/export-table";

// Reusable export/send toolbar — item 6 (Universal Reports/Export/Send
// system). Drop this under ANY report/list once you have { columns, rows }
// and it gets CSV, Excel, Word, PDF, Email and WhatsApp for free — no
// per-page re-implementation. PDF reuses the page's own print-area
// convention (see printAreaId), so this component doesn't generate PDFs
// itself, it just triggers window.print().
export function ExportBar<T>({
  title,
  filenameBase,
  columns,
  rows,
  printAreaId,
  whatsappPhone,
}: {
  title: string;
  filenameBase: string;
  columns: ExportColumn<T>[];
  rows: T[];
  /** If provided, the PDF button wraps window.print() around this element's id (see the @media print convention used across Certificates/HR Letters). Omit to hide the PDF button. */
  printAreaId?: string;
  /** Optional phone number to pre-fill the wa.me fallback (e.g. a buyer's contact_no when the report is buyer-specific). */
  whatsappPhone?: string | null;
}) {
  const [isSharing, startShare] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 2500);
  }

  const btnClass =
    "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40";

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <button type="button" className={btnClass} disabled={!rows.length} onClick={() => downloadCSV(filenameBase, columns, rows)}>
        ⬇️ CSV
      </button>
      <button
        type="button"
        className={btnClass}
        disabled={!rows.length}
        onClick={() => downloadXLSX(filenameBase, title, columns, rows)}
      >
        ⬇️ Excel
      </button>
      <button type="button" className={btnClass} disabled={!rows.length} onClick={() => downloadDoc(filenameBase, title, columns, rows)}>
        ⬇️ Word
      </button>
      {printAreaId && (
        <button type="button" className={btnClass} onClick={() => window.print()}>
          🖨️ PDF / Print
        </button>
      )}
      <a
        className={btnClass}
        href={mailtoLink(title, buildSummaryText(title, columns, rows))}
        onClick={() => flash("Email draft opened — attach the CSV/Excel file yourself if you need to send it.")}
      >
        ✉️ Email
      </a>
      <button
        type="button"
        className={btnClass}
        disabled={!rows.length || isSharing}
        onClick={() =>
          startShare(async () => {
            await shareOnWhatsApp(title, columns, rows, filenameBase, whatsappPhone);
          })
        }
      >
        📱 WhatsApp
      </button>
      {notice && <span className="text-xs text-slate-400">{notice}</span>}
    </div>
  );
}
