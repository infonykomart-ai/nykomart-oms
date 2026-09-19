"use client";

// 2026-09-19 — action bar for the Doc Statement dialog (Credit Note / CSB
// Filing / Refund / Order Refund), mirroring bill-statement-actions.tsx's
// Print / WhatsApp+PDF / Telegram+PDF / Email+PDF / Save PDF / Copy set —
// but built on the SHARED low-level mechanics in src/lib/share-pdf.ts so
// this doesn't re-implement the Web-Share-then-fallback logic a second
// time. Per-kind summary text is built here (each kind's fields differ),
// the sharing mechanics themselves are not duplicated.
import { useState } from "react";
import type { DocStatementData } from "@/lib/doc-statement";
import { downloadBlob, tryShareFile } from "@/lib/share-pdf";

async function fetchStatementPdf(type: string, id: string): Promise<Blob | null> {
  try {
    const res = await fetch(`/api/doc-statement/${type}/${id}?format=pdf`);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

const money = (n: number | null | undefined, ccy = "") =>
  n == null ? "-" : `${ccy ? ccy + " " : ""}${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function buildSummary(data: DocStatementData): string {
  const lines: string[] = [`*${data.companyName} — ${data.docTitle}*`, `Doc No.: ${data.invoiceRef}`];
  switch (data.kind) {
    case "credit_note":
      lines.push(`Party/Buyer: ${data.party?.name ?? data.buyerName ?? "—"}`);
      if (data.creditNoteDate) lines.push(`Date: ${data.creditNoteDate}`);
      if (data.invoiceNo) lines.push(`Against Invoice: ${data.invoiceNo}`);
      lines.push(`Amount: ${money(data.refundAmount)}`);
      break;
    case "csb_filing":
      if (data.filingDate) lines.push(`Filing Date: ${data.filingDate}`);
      if (data.hawbNumber) lines.push(`HAWB: ${data.hawbNumber}`);
      if (data.invoiceNo) lines.push(`Invoice No.: ${data.invoiceNo}`);
      lines.push(`Total Taxable Value: ${money(data.totalTaxableValue, data.taxableValueCurrency ?? "")}`);
      break;
    case "refund":
      lines.push(`Buyer: ${data.buyerName ?? "—"}`);
      if (data.marketplaceOrderNo) lines.push(`Order No.: ${data.marketplaceOrderNo}`);
      if (data.refundDate) lines.push(`Date: ${data.refundDate}`);
      lines.push(`Refund: ${money(data.refundAmtUsd, "USD")}`);
      break;
    case "order_refund":
      lines.push(`Buyer: ${data.buyerName ?? "—"}`);
      if (data.refundDate) lines.push(`Date: ${data.refundDate}`);
      lines.push(`Refund: ${money(data.refundAmount, data.refundCurrency)}`);
      break;
  }
  lines.push("", "Statement PDF attached.");
  return lines.join("\n");
}

export function DocStatementActions({ data }: { data: DocStatementData }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const summary = buildSummary(data);
  const plain = summary.replace(/\*/g, "");
  const pdfName = `${data.kind}-${data.invoiceRef.replace(/[^a-zA-Z0-9._-]+/g, "_")}.pdf`;

  async function sharePdf(prefer: "whatsapp" | "telegram" | "download") {
    setBusy(prefer);
    setNotice(null);
    const blob = await fetchStatementPdf(data.kind, data.id);
    if (!blob) {
      setBusy(null);
      setNotice("Could not generate the PDF — try again.");
      return;
    }
    if (prefer === "download") {
      downloadBlob(blob, pdfName);
      setBusy(null);
      return;
    }
    const shared = await tryShareFile(blob, pdfName, plain, `${data.companyName} — ${data.docTitle} ${data.invoiceRef}`);
    if (shared) {
      setBusy(null);
      return;
    }
    downloadBlob(blob, pdfName);
    const text = encodeURIComponent(plain);
    window.open(
      prefer === "whatsapp"
        ? `https://wa.me/${data.waPhone}?text=${text}`
        : `https://t.me/share/url?url=${encodeURIComponent(`${data.docTitle} ${data.invoiceRef}`)}&text=${text}`,
      "_blank",
      "noopener,noreferrer"
    );
    setNotice(
      prefer === "whatsapp"
        ? "PDF saved to your Downloads — attach it in the WhatsApp chat that just opened."
        : "PDF saved to your Downloads — attach it in the Telegram chat that just opened."
    );
    setBusy(null);
  }

  async function shareEmail() {
    setBusy("email");
    setNotice(null);
    const blob = await fetchStatementPdf(data.kind, data.id);
    if (blob) downloadBlob(blob, pdfName);
    const subject = `${data.companyName} — ${data.docTitle} — ${data.invoiceRef}`;
    const mailto = data.party?.email
      ? `mailto:${data.party.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(plain)}`
      : `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(plain)}`;
    window.location.href = mailto;
    setNotice("PDF saved to your Downloads — attach it to the email draft that just opened.");
    setBusy(null);
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable — non-critical.
    }
  }

  const btn = "rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60";
  const canWhatsapp = !!data.waPhone;

  return (
    <div className="space-y-2 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => window.print()} className={`${btn} bg-slate-800 text-white hover:bg-slate-700`}>
          🖨 Print / PDF
        </button>
        <button
          type="button"
          disabled={busy !== null || !canWhatsapp}
          title={canWhatsapp ? undefined : "No phone number on file for this document"}
          onClick={() => sharePdf("whatsapp")}
          className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}
        >
          {busy === "whatsapp" ? "Preparing…" : "📱 WhatsApp + PDF"}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => sharePdf("telegram")} className={`${btn} bg-sky-500 text-white hover:bg-sky-400`}>
          {busy === "telegram" ? "Preparing…" : "☁️ Telegram + PDF"}
        </button>
        <button type="button" disabled={busy !== null} onClick={shareEmail} className={`${btn} bg-indigo-600 text-white hover:bg-indigo-500`}>
          {busy === "email" ? "Preparing…" : "✉️ Email + PDF"}
        </button>
        <button type="button" disabled={busy !== null} onClick={() => sharePdf("download")} className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
          {busy === "download" ? "Saving…" : "📥 Save PDF"}
        </button>
        <button type="button" onClick={copySummary} className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
          {copied ? "✓ Copied" : "📋 Copy summary"}
        </button>
      </div>
      {notice && <p className="rounded-lg bg-sky-50 px-3 py-1.5 text-[11px] text-sky-800">{notice}</p>}
    </div>
  );
}
