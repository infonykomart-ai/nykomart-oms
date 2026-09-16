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
  shareOnTelegram,
  sharePdfWithText,
} from "@/lib/export/export-table";

// Reusable export/send toolbar — item 6 (Universal Reports/Export/Send
// system). Drop this under ANY report/list once you have { columns, rows }
// and it gets CSV, Excel, Word, PDF, Email, WhatsApp and Telegram for free
// — no per-page re-implementation. PDF reuses the page's own print-area
// convention (see printAreaId), so this component doesn't generate PDFs
// itself, it just triggers window.print().
//
// 2026-09-15 — "agar whatsaap email par update bhej rahe hai to pdf file
// bhi jani chahiye na" + "agar ladger bhi pdf bhejni ho to pdf to whatsaap
// or email par a4 ke page par portrait me sabhi fixes ke sath jaye company
// logo ke sath": pass `pdfEndpoint` (+ optional `pdfPayload`,
// `pdfFilename`) and the 📱 WhatsApp / ✉️ Email / ☁️ Telegram buttons
// become PDF-CARRYING — they fetch the real PDF file from the caller's
// access-checked endpoint (e.g. /api/ledger-pdf — A4 portrait, company
// logo) and attach it via the Web Share sheet where the browser supports
// it, else download the PDF + pre-fill the message link. A separate 📥
// Save PDF button downloads the file with no share sheet. Callers without
// pdfEndpoint keep the old text-only behaviour.
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
  pdfEndpoint,
  pdfPayload,
  pdfFilename,
}: {
  title: string;
  filenameBase: string;
  columns: ExportColumn<T>[];
  rows: T[];
  /** If provided, the PDF button wraps window.print() around this element's id (see the @media print convention used across Certificates/HR Letters). Omit to hide the PDF button. */
  printAreaId?: string;
  /** Optional phone number to pre-fill the wa.me fallback (e.g. a buyer's contact_no when the report is buyer-specific). Also the mailto: recipient when pdfEndpoint is set. */
  whatsappPhone?: string | null;
  /** Full column list (unfiltered) — pass alongside hiddenKeys/onToggleColumn to show the "Columns" picker. Omit to hide the picker entirely. */
  allColumns?: ExportColumn<T>[];
  /** Set of column `key`s currently hidden — from useColumnVisibility(). */
  hiddenKeys?: Set<string>;
  /** Called with a column's key when its checkbox is toggled — from useColumnVisibility(). */
  onToggleColumn?: (key: string) => void;
  /** Access-checked endpoint returning the report's real PDF file (GET, or POST when pdfPayload is set). When set, WhatsApp/Email/Telegram attach this file. */
  pdfEndpoint?: string;
  /** Optional JSON body for a POST to pdfEndpoint (e.g. the ledger's exact on-screen rows). */
  pdfPayload?: unknown;
  /** Download name for the attached/saved PDF. */
  pdfFilename?: string;
}) {
  const [isSharing, startShare] = useTransition();
  const [notice, setNotice] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  function flash(msg: string) {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  }

  // PDF-carrying share — one handler for all three channels (see
  // sharePdfWithText in export-table.ts for the Web-Share/link mechanics).
  function sharePdf(target: "whatsapp" | "telegram" | "email" | "download") {
    if (!pdfEndpoint) return;
    startShare(async () => {
      const summary = buildSummaryText(title, columns, rows);
      const result = await sharePdfWithText({
        target,
        pdfEndpoint,
        pdfPayload,
        filename: pdfFilename ?? `${filenameBase}.pdf`,
        summary,
        subject: title,
        phone: whatsappPhone ?? undefined,
      });
      if (result === "failed") {
        flash("Could not generate the PDF — try again.");
      } else if (target !== "download" && result === "linked") {
        flash("PDF saved to your Downloads — attach it in the chat/draft that just opened.");
      }
    });
  }

  const btnClass =
    "rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40";

  const pdfButtons = pdfEndpoint ? (
    <>
      <button type="button" className={btnClass} disabled={!rows.length || isSharing} onClick={() => sharePdf("whatsapp")}>
        📱 WhatsApp + PDF
      </button>
      <button type="button" className={btnClass} disabled={!rows.length || isSharing} onClick={() => sharePdf("telegram")}>
        ☁️ Telegram + PDF
      </button>
      <button type="button" className={btnClass} disabled={!rows.length || isSharing} onClick={() => sharePdf("email")}>
        ✉️ Email + PDF
      </button>
      <button type="button" className={btnClass} disabled={!rows.length || isSharing} onClick={() => sharePdf("download")}>
        📥 Save PDF
      </button>
    </>
  ) : (
    <>
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
      {/* 2026-09-15 — "sabhi jagh telegram ka option bhi kar dena jaha par
          whatsaap ka option hai" — the same summary text through Telegram's
          t.me/share/url deep link (Web-Share sheet still offers the
          Telegram app where available; this link covers desktop browsers
          and phones without the Web Share file support). */}
      <button
        type="button"
        className={btnClass}
        disabled={!rows.length || isSharing}
        onClick={() =>
          startShare(async () => {
            await shareOnTelegram(title, columns, rows);
          })
        }
      >
        ☁️ Telegram
      </button>
    </>
  );

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
      {pdfButtons}
      {notice && <span className="text-xs text-slate-400">{notice}</span>}
    </div>
  );
}
