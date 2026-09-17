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

// 2026-09-17 (evening) — "jitni bhi report hai un sabhi me total aana
// chahiye ... kitne order hai unki value kitni hai vahi par sahi se total
// hokar aaye": every ExportColumn-driven report table (Orders, Purchase
// Bills, Freight/Duty, SKU×Country×Size, ...) used to show only a row
// COUNT, never a summed ₹/qty total — no way to see "does this table's
// total tie out" without exporting and summing by hand. Shared so each
// report's <tfoot> total row (or summary line) uses the exact same
// sum-only-if-numeric logic instead of re-deriving it per page.
export function sumNumericColumn<T>(rows: T[], col: ExportColumn<T>): number | null {
  let sum = 0;
  let sawNumber = false;
  for (const r of rows) {
    const v = col.value(r);
    if (typeof v === "number") {
      sum += v;
      sawNumber = true;
    }
  }
  return sawNumber ? sum : null;
}
export function fmtColumnTotal(n: number): string {
  return n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

// 2026-08-08 (pending item 7 — "har bulk-upload form ke liye ek downloadable
// CSV template ho, taaki upload error na de"). Generic: any bulk-upload
// feature (Bulk Order Entry, Bulk Tracking Update, ...) defines its own
// column list ONCE (label + example value + required) and gets both the
// downloadable template AND — since the parser on the server should read
// the exact same label list — a guarantee the two can't drift apart.
export type TemplateColumn = { label: string; example: string; required?: boolean };

export function downloadCSVTemplate(filenameBase: string, columns: TemplateColumn[]) {
  const header = columns.map((c) => (c.required ? `${c.label} *` : c.label));
  const example = columns.map((c) => c.example);
  const csv = [header, example]
    .map((line) => line.map((v) => escapeDelimited(String(v ?? ""), ",")).join(","))
    .join("\r\n");
  // Leading BOM so Excel opens UTF-8 correctly, same as downloadCSV().
  triggerDownload(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" }), `${filenameBase}-template.csv`);
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
  XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(sheetName));
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  triggerDownload(
    new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${filenameBase}.xlsx`
  );
}

// 2026-09-15 — "mene ladger me jakr excel download karne ka kiya to vo nahi
// hui to me chahta hu pura system dubara check karo" — audit of every
// export path found TWO latent Excel bugs, both fixed here and in
// ExportBar: (1) sheet names silently carried Excel's ILLEGAL characters —
// [ ] : * ? / \ — so a report titled e.g. "Freight/Duty" produced a
// workbook Excel refuses to open (or SheetJS throws on); (2) the first
// Excel click in a fresh session depended on a runtime dynamic-chunk fetch
// of the xlsx library with NO error handling, so a failed chunk fetch
// made the click do NOTHING — no download, no message. sanitizeSheetName
// fixes (1); preloadExportLibs (called on ExportBar mount) fixes (2).
function sanitizeSheetName(raw: string): string {
  const cleaned = raw.replace(/[[\]:*?/\\]/g, " ").trim().slice(0, 31);
  return cleaned.length > 0 ? cleaned : "Sheet1";
}

// Warms the lazy-loaded xlsx chunk as soon as an ExportBar mounts, so the
// first Excel click never waits on (or fails from) a network fetch. Safe
// to call anywhere; failures are intentionally swallowed — the click
// handler retries the import and now REPORTS an error if it still fails.
export function preloadExportLibs() {
  void import("xlsx").catch(() => {});
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

// 2026-09-15 (evening) — "agar whatsaap email par update bhej rahe hai to
// pdf file bhi jani chahiye na" — the SHARED plumbing behind every
// PDF-carrying share: fetch the file from the caller's access-checked
// endpoint, then try the Web Share API with the real file attached (the
// only path that actually ATTACHES a file — the WhatsApp/Telegram app
// both appear in the mobile share sheet), else download the PDF locally
// and open the text deep-link (wa.me / t.me / mailto) so the message is
// still pre-filled and the PDF sits in Downloads to drag in. Returns
// "linked" when only the text link could carry the message.
export async function fetchEndpointPdf(endpoint: string, payload?: unknown): Promise<Blob | null> {
  try {
    const res = payload
      ? await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
      : await fetch(endpoint);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

function downloadBlob(blob: Blob, filename: string) {
  triggerDownload(blob, filename);
}

export type PdfShareTarget = "whatsapp" | "telegram" | "email" | "download";

/**
 * Shares `summary` text WITH the real PDF from `pdfEndpoint`:
 *  - whatsapp → wa.me/`phone` deep link (Web-Share sheet first on mobile)
 *  - telegram → t.me/share/url deep link
 *  - email    → mailto: with subject+body (PDF downloads alongside;
 *               mailto cannot attach files by spec)
 *  - download → just the file, no share sheet
 */
export async function sharePdfWithText({
  target,
  pdfEndpoint,
  pdfPayload,
  filename,
  summary,
  subject,
  phone,
}: {
  target: PdfShareTarget;
  pdfEndpoint: string;
  pdfPayload?: unknown;
  filename: string;
  summary: string;
  subject?: string;
  phone?: string | null;
}): Promise<"shared" | "linked" | "failed"> {
  const blob = await fetchEndpointPdf(pdfEndpoint, pdfPayload);
  if (!blob) return "failed";

  if (target === "download") {
    downloadBlob(blob, filename);
    return "shared";
  }

  if (target !== "email" && typeof navigator !== "undefined" && "share" in navigator && "canShare" in navigator) {
    try {
      const file = new File([blob], filename, { type: "application/pdf" });
      const shareData = { files: [file], text: summary, title: subject ?? filename };
      if (navigator.canShare(shareData)) {
        await navigator.share(shareData);
        return "shared";
      }
    } catch {
      // user cancelled or share failed — fall through to the link path
    }
  }

  // Desktop fallback: file can't be pushed into WhatsApp Web / Telegram
  // Web / mailto programmatically — download it and pre-fill the text.
  downloadBlob(blob, filename);
  const text = encodeURIComponent(summary);
  if (target === "email") {
    // Only use `phone` as the recipient when it actually looks like an
    // email address (callers pass contact_no for WhatsApp here — a phone
    // number in mailto: would silently break the draft).
    const to = phone && phone.includes("@") ? phone : "";
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(subject ?? filename)}&body=${text}`;
  } else if (target === "whatsapp") {
    const digits = waPhoneFromRaw(phone);
    window.open(digits ? `https://wa.me/${digits}?text=${text}` : `https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer");
  } else {
    window.open(`https://t.me/share/url?url=${encodeURIComponent(subject ?? filename)}&text=${text}`, "_blank", "noopener,noreferrer");
  }
  return "linked";
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

// 2026-09-15 — "sabhi jagh telegram ka option bhi kar dena jaha par
// whatsaap ka option hai": the Telegram twin of shareOnWhatsApp. Web
// Share first (the mobile sheet lists the Telegram app and it's the only
// path that can carry a real file attachment), then the
// t.me/share/url deep link with the summary text pre-filled.
export async function shareOnTelegram<T>(
  title: string,
  columns: ExportColumn<T>[],
  rows: T[]
) {
  const summary = buildSummaryText(title, columns, rows);
  const csv = toDelimitedString(columns, rows, ",");

  if (typeof navigator !== "undefined" && "share" in navigator) {
    try {
      const file = new File(["\ufeff" + csv], `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`, { type: "text/csv" });
      const shareData = { files: [file], text: summary, title };
      if ("canShare" in navigator && navigator.canShare(shareData)) {
        await navigator.share(shareData);
        return;
      }
    } catch {
      // Fall through to the t.me link below (user cancelled, unsupported).
    }
  }

  const url = `https://t.me/share/url?url=${encodeURIComponent(title)}&text=${encodeURIComponent(summary)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
