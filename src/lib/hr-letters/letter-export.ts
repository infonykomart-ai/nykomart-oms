// Word / Email / WhatsApp for a single generated HR letter or the Policy
// Handbook — same "give the user the actual file, not just a print
// dialog" idea as the Universal Reports Export/Send system
// (src/lib/export/export-table.ts), but for one free-text document
// instead of a rows/columns table, since a letter's body doesn't fit the
// tabular CSV/Excel/Word-table shape that system builds. PDF stays
// window.print() via the shared PrintArea/PrintButton pair
// (src/components/print-view.tsx) — no separate PDF function needed here,
// same reasoning export-table.ts gives for skipping its own PDF function.
//
// 2026-08-25 — direct answer to "file ko print, save in PDF, WORD email
// whatsapp ka option kyu nahi aara": Print/PDF already existed (it's just
// window.print(), and every browser's print dialog offers "Save as PDF"
// as a destination) but Word/Email/WhatsApp did not.

function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

export type LetterDocInput = {
  companyName: string;
  refNo: string;
  dateIssued: string;
  /** "To,\n<name>\n<address>" block, or "TO WHOMSOEVER IT MAY CONCERN" — omit for a document with no addressee block (e.g. the Policy Handbook). */
  toLine?: string;
  subjectLine?: string;
  bodyText: string;
  signatoryName?: string;
  signatoryDesignation?: string;
};

function buildLetterHtml(input: LetterDocInput): string {
  const bodyHtml = escapeHtml(input.bodyText).replace(/\n/g, "<br>");
  const signatureHtml =
    input.signatoryName || input.signatoryDesignation
      ? `<div style="margin-top:40px;">` +
        `<div style="font-weight:bold;">${escapeHtml(input.signatoryName || " ")}</div>` +
        (input.signatoryDesignation ? `<div style="font-size:11px;color:#555;">(${escapeHtml(input.signatoryDesignation)})</div>` : "") +
        `</div>`
      : "";
  return (
    `<html><head><meta charset="utf-8"><title>${escapeHtml(input.companyName)}</title></head>` +
    `<body style="font-family:Georgia,'Times New Roman',serif;font-size:13px;color:#111;">` +
    `<div style="margin-bottom:16px;"><strong style="font-size:16px;">${escapeHtml(input.companyName)}</strong></div>` +
    (input.refNo || input.dateIssued
      ? `<div style="display:flex;justify-content:space-between;font-size:12px;font-weight:bold;margin-bottom:12px;">` +
        `<span>Ref No.: ${escapeHtml(input.refNo || "—")}</span><span>Date: ${escapeHtml(input.dateIssued)}</span></div>`
      : "") +
    (input.toLine ? `<div style="margin-bottom:12px;white-space:pre-line;">${escapeHtml(input.toLine)}</div>` : "") +
    (input.subjectLine ? `<div style="margin-bottom:12px;font-weight:bold;">${escapeHtml(input.subjectLine)}</div>` : "") +
    `<div style="line-height:1.6;white-space:pre-wrap;">${bodyHtml}</div>` +
    signatureHtml +
    `</body></html>`
  );
}

// A ".doc" that is really HTML + application/msword MIME — same technique
// as downloadDoc() in export-table.ts. Word/LibreOffice/Google Docs all
// open it correctly; no docx-generation dependency needed for a letter.
export function downloadLetterDoc(filenameBase: string, input: LetterDocInput) {
  const html = buildLetterHtml(input);
  triggerDownload(new Blob([html], { type: "application/msword" }), `${filenameBase}.doc`);
}

export function mailtoLetterLink(subject: string, input: LetterDocInput): string {
  const lines = [
    input.companyName,
    input.refNo || input.dateIssued ? `Ref No.: ${input.refNo || "—"}    Date: ${input.dateIssued}` : "",
    "",
    ...(input.toLine ? [input.toLine, ""] : []),
    ...(input.subjectLine ? [input.subjectLine, ""] : []),
    input.bodyText,
    "",
    input.signatoryName ?? "",
    input.signatoryDesignation ? `(${input.signatoryDesignation})` : "",
  ].filter((l, i, arr) => !(l === "" && arr[i - 1] === ""));
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(lines.join("\n"))}`;
}

// Same Web-Share-first / wa.me-fallback pattern as shareOnWhatsApp() in
// export-table.ts — attaches the generated .doc where the browser
// supports sharing files (most mobile browsers), else falls back to a
// text-only wa.me link with the letter's opening lines.
export async function shareLetterOnWhatsApp(filenameBase: string, subject: string, input: LetterDocInput, phone?: string | null) {
  const html = buildLetterHtml(input);
  const summary = [subject, "", input.bodyText.slice(0, 500) + (input.bodyText.length > 500 ? "..." : "")].join("\n");

  if (typeof navigator !== "undefined" && "share" in navigator) {
    try {
      const file = new File([html], `${filenameBase}.doc`, { type: "application/msword" });
      const shareData = { files: [file], text: summary, title: subject };
      if ("canShare" in navigator && navigator.canShare(shareData)) {
        await navigator.share(shareData);
        return;
      }
    } catch {
      // Fall through to the wa.me link below (user cancelled, unsupported, etc.)
    }
  }

  const digits = (phone ?? "").replace(/\D/g, "");
  const phoneDigits = digits ? (digits.length === 10 ? `91${digits}` : digits) : "";
  const url = phoneDigits
    ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(summary)}`
    : `https://wa.me/?text=${encodeURIComponent(summary)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}
