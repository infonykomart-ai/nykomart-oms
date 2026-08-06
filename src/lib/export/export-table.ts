// Universal Reports/Export/Send system (2026-08-06, pending-feature item 6).
// ONE reusable set of export functions, meant to be driven by any report's
// { columns, rows } shape via <ExportBar /> (see
// src/components/export-bar.tsx) — CSV/XLSX/Word/PDF/Email/WhatsApp should
// never be re-implemented per-page. Add a new report by defining columns +
// fetching rows; export/send behaviour comes for free.
//
// Formats and why each is done the way it is:
//  - CSV/TSV: plain string building, no dependency — trivial and universal.
//  - XLSX: via the `xlsx` (SheetJS) npm package, already a dependency.
//  - DOC: NOT a real .docx — a `.doc` file is just HTML with an
//    `application/msword` MIME type; Word opens it fine and this needs no
//    extra dependency. Good enough for "give me a Word file of this list".
//  - PDF: no PDF-generation library — reuses the exact same
//    `window.print()` + `@media print` convention already established for
//    Certificates/HR Letters/Policy Handbook. Caller wraps the printable
//    area in `id="...-print-area"` and calls window.print() directly;
//    export-table.ts doesn't need a PDF function for that reason.
//  - Email: `mailto:` link. Browsers cannot attach a file to a mailto link
//    (a real limitation, not a shortcut) — so the email includes a plain
//    text summary in the body and the user attaches the downloaded
//    CSV/Excel file themselves if they want the full data.
//  - WhatsApp: same pattern as order-whatsapp-button.tsx — Web Share API
//    with the exported file attached where the browser supports sharing
//    files, else a wa.me link with a text summary.

export type ExportColumn<T> = {
  key: string;
  label: string;
  value: (row: T) => string | number | null | undefined;
};

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function rowsToAoA<T>(columns: ExportColumn<T>[], rows: T[]): string[][] {
  const header = columns.map((c) => c.label);
  const body = rows.map((r) => columns.map((c) => cell(c.value(r))));
  return [header, ...body];
}

function escapeDelimited(v: string, delimiter: string): string {
  if (v.includes(delimiter) || v.includes('"') || v.includes("\n") || v.includes("\r")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function toDelimitedString<T>(columns: ExportColumn<T>[], rows: T[], delimiter: string): string {
  const aoa = rowsToAoA(columns, rows);
  return aoa.map((line) => line.map((v) => escapeDelimited(v, delimiter)).join(delimiter)).join("\r\n");
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the click a tick to start before revoking, then release memory.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCSV<T>(filenameBase: string, columns: ExportColumn<T>[], rows: T[]) {
  const csv = toDelimitedString(columns, rows, ",");
  // Leading BOM so Excel opens UTF-8 (rupee symbols, etc.) correctly.
  triggerDownload(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }), `${filenameBase}.csv`);
}

export function downloadTSV<T>(filenameBase: string, columns: ExportColumn<T>[], rows: T[]) {
  const tsv = toDelimitedString(columns, rows, "\t");
  triggerDownload(new Blob(["﻿" + tsv], { type: "text/tab-separated-values;charset=utf-8;" }), `${filenameBase}.tsv`);
}

export async function downloadXLSX<T>(
  filenameBase: string,
  sheetName: string,
  columns: ExportColumn<T>[],
  rows: T[]
) {
  const XLSX = await import("xlsx");
  const aoa = rowsToAoA(columns, rows);
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Reasonable column widths so the sheet isn't unreadable on open.
  ws["!cols"] = columns.map((c) => ({ wch: Math.max(c.label.length + 2, 12) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31)); // Excel sheet-name length limit
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  triggerDownload(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${filenameBase}.xlsx`
  );
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function buildHtmlTable<T>(title: string, columns: ExportColumn<T>[], rows: T[]): string {
  const headerRow = columns.map((c) => `<th style="border:1px solid #999;padding:4px 8px;background:#eee;">${escapeHtml(c.label)}</th>`).join("");
  const bodyRows = rows
    .map((r) => `<tr>${columns.map((c) => `<td style="border:1px solid #ccc;padding:4px 8px;">${escapeHtml(cell(c.value(r)))}</td>`).join("")}</tr>`)
    .join("");
  return `<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>` +
    `<body><h2>${escapeHtml(title)}</h2><table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;">` +
    `<thead><tr>${headerRow}</tr></thead><tbody>${bodyRows}</tbody></table></body></html>`;
}

// A ".doc" that is really HTML + application/msword MIME — Word/LibreOffice
// open it correctly; no docx-generation dependency needed for a plain table.
export function downloadDoc<T>(filenameBase: string, title: string, columns: ExportColumn<T>[], rows: T[]) {
  const html = buildHtmlTable(title, columns, rows);
  triggerDownload(new Blob([html], { type: "application/msword" }), `${filenameBase}.doc`);
}

export function buildSummaryText<T>(title: string, columns: ExportColumn<T>[], rows: T[], maxRows = 15): string {
  const lines = [title, `(${rows.length} rows)`, ""];
  const shown = rows.slice(0, maxRows);
  for (const r of shown) {
    lines.push(columns.map((c) => `${c.label}: ${cell(c.value(r))}`).join(" | "));
  }
  if (rows.length > shown.length) lines.push(`...and ${rows.length - shown.length} more (see attached file)`);
  return lines.join("\n");
}

export function mailtoLink(subject: string, body: string): string {
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function waPhoneFromRaw(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return digits.length === 10 ? `91${digits}` : digits;
}

// Same Web-Share-first / wa.me-fallback pattern as
// order-whatsapp-button.tsx, generalised to any exported file (CSV here —
// small, text-based, and opens fine if someone taps it on WhatsApp).
export async function shareOnWhatsApp<T>(
  title: string,
  columns: ExportColumn<T>[],
  rows: T[],
  filenameBase: string,
  phone?: string | null
) {
  const summary = buildSummaryText(title, columns, rows);
  const csv = toDelimitedString(columns, rows, ",");

  if (typeof navigator !== "undefined" && "share" in navigator) {
    try {
      const file = new File(["﻿" + csv], `${filenameBase}.csv`, { type: "text/csv" });
      const shareData = { files: [file], text: summary, title };
      if ("canShare" in navigator && navigator.canShare(shareData)) {
        await navigator.share(shareData);
        return;
      }
    } catch {
      // Fall through to wa.me link below (user cancelled, unsupported, etc.)
    }
  }

  const phoneDigits = waPhoneFromRaw(phone);
  const url = phoneDigits
    ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(summary)}`
    : `https://wa.me/?text=${encodeURIComponent(summary)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
