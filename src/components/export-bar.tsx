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
//
// 2026-08-22 — generic column/section picker (Reports hub extension). When
// the caller passes `allColumns` + `hiddenKeys` + `onToggleColumn` (see
// useColumnVisibility, src/lib/export/use-column-visibility.ts), a
// "Columns" button renders here with a checkbox per column. `columns`
// itself is always treated as the CURRENT effective (already-filtered)
// list — every export format below reads only from `columns`, so hiding a
// column here hides it from CSV/Excel/Word/Email/WhatsApp too. The caller
// is responsible for filtering its own on-screen <table> the same way
// (Orders Report does this — see orders-report-table.tsx) so PDF/Print,
// which just captures the DOM, matches automatically.
export function ExportBar<T>({
  title,
  filenameBase,
  columns,
  rows,
  printAreaId,
  whatsappPhone,
  allColumns,
  hiddenKeys,
  onToggleColumn,
}: {
  title: string;
  filenameBase: string;
  columns: ExportColumn<T>[];
  rows: T[];
  /** If provided, the PDF button wraps window.print() around this element's id (see the @media print convention used across Certificates/HR Letters). Omit to hide the PDF button. */
  printAreaId?: string;
  /** Optional phone number to pre-fill the wa.me fallback (e.g. a buyer's contact_no when the report is buyer-specific). */
  whatsappPhone?: string | null;
  /** Full column list (unfiltered) — pass alongside hiddenKeys/onToggleColumn to show the "Columns" picker. Omit to hide the picker entirely. */
  allColumns?: ExportColumn<T>[];
  /** Set of column `key`s currently hidden — from useColumnVisibility(). */
  hiddenKeys?: Set<string>;
  /** Called with a column's key when its checkbox is toggled — from useColumnVisibility(). */
  onToggleColumn?: (key: string) => void;
}) {
  const [isSharing, startShare] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 2500);
  }

  const btnClass =
    "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40";

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {allColumns && hiddenKeys && onToggleColumn && (
        <div className="relative">
          <button type="button" className={btnClass} onClick={() => setPickerOpen((v) => !v)}>
            🧩 Columns ({allColumns.length - hiddenKeys.size}/{allColumns.length})
          </button>
          {pickerOpen && (
            <>
              {/* Click-outside catcher — a plain fixed overlay under the dropdown, same trick used elsewhere in this app for dropdown menus. */}
              <div className="fixed inset-0 z-10" onClick={() => setPickerOpen(false)} />
              <div className="absolute left-0 z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 shadow-lg">
                <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Show columns
                </p>
                {allColumns.map((c) => (
                  <label
                    key={c.key}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={!hiddenKeys.has(c.key)}
                      onChange={() => onToggleColumn(c.key)}
                      className="h-3.5 w-3.5 rounded border-slate-300"
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      )}
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
