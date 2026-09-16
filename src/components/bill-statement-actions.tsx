"use client";

// 2026-09-15 — the action bar for the read-only bill statement (dialog +
// full ledger page): 🖨 Print/PDF, 📱 WhatsApp, ☁️ Telegram, ✉️ Email,
// 📥 Save PDF, 📋 Copy — "sabhi jagh telegram ka option bhi kar dena jaha
// par whatsaap ka option hai".
//
// 2026-09-15 (evening) — "agar whatsaap email par update bhej rahe hai to
// pdf file bhi jani chahiye na": WhatsApp/Email/Telegram now FETCH the
// statement's real A4-portrait PDF FILE from
// /api/bill-statement/[billId]?format=pdf (access-checked, company logo,
// see src/lib/bill-statement-pdf.tsx) and share it WITH the payment
// message — not just text. Mechanics per channel:
//   • 📥 Save PDF       — plain download, no share sheet.
//   • 📱 WhatsApp       — Web Share with {files:[pdf]} + text when the
//                         browser can (mobile Chrome/Android, Safari),
//                         else downloads the PDF and opens wa.me with the
//                         text pre-filled (desktop WhatsApp Web can't take
//                         programmatic files — the PDF lands in Downloads
//                         to drag into the chat; message text is ready).
//   • ☁️ Telegram       — same: t.me/shareUrl can't carry files either;
//                         Web Share (which offers the Telegram app on
//                         mobile) first, download + open Telegram fallback.
//   • ✉️ Email          — mailto: carries the message; the PDF is
//                         downloaded simultaneously to attach (mailto
//                         cannot attach files by spec).
// PDFs download through the SAME access-checked API route — a user who
// can't see the bill can't fetch its PDF either.
//
// All numbers come from the already-loaded BillStatementData — the
// message can never disagree with the statement or the ledger.

import { useState } from "react";
import type { BillStatementData } from "@/lib/bill-statement";

async function fetchStatementPdf(billId: string): Promise<Blob | null> {
  try {
    const res = await fetch(`/api/bill-statement/${billId}?format=pdf`);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null;
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function BillStatementActions({ data }: { data: BillStatementData }) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const inr = (n: number) =>
    `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const num = (n: number) =>
    n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pdfName = `bill-statement-${data.invoiceRef.replace(/[^a-zA-Z0-9._-]+/g, "_")}.pdf`;

  const lastPayment = data.payments.length ? data.payments[data.payments.length - 1] : null;
  const paymentMode = lastPayment?.payment_mode ?? (data.walletPaid > 0 ? "Courier Wallet" : "");
  const lastPaymentDate = lastPayment?.payment_date ?? "";
  const lastUtr = lastPayment?.reference_no ?? "";

  const paymentLines =
    data.settledTotal > 0
      ? `\nPayment: ${inr(data.settledTotal)}${paymentMode ? ` via ${paymentMode}` : ""}${
          lastPaymentDate ? ` on ${lastPaymentDate}` : ""
        }${lastUtr ? `\nUTR/Ref: ${lastUtr}` : ""}`
      : "";
  const summary =
    `*${data.companyName} — Payment Update*\n\n` +
    `${data.docTitle}\n` +
    `Vendor: ${data.party.name}\n` +
    `Invoice No.: ${data.invoiceRef}\n` +
    `Bill Amount: ${inr(data.bill.total_amt)}` +
    (data.bill.credit_note_amt + data.bill.adj_amt > 0
      ? `\nCredit Note/Adj: − ${inr(data.bill.credit_note_amt + data.bill.adj_amt)}`
      : "") +
    paymentLines +
    `\nBalance: ${data.fullyPaid ? "NIL — fully paid ✅" : inr(data.outstanding)}` +
    `\n\nKindly acknowledge. Statement PDF attached.`;
  const plain = summary.replace(/\*/g, "");

  async function sharePdf(prefer: "whatsapp" | "telegram" | "download") {
    setBusy(prefer);
    setNotice(null);
    const blob = await fetchStatementPdf(data.bill.id);
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
    // Web Share with the real file — the only path that actually ATTACHES
    // the PDF (WhatsApp/Telegram app both appear in the mobile share
    // sheet). Falls back to download + wa.me/t.me text link on desktop.
    if (typeof navigator !== "undefined" && "share" in navigator && "canShare" in navigator) {
      const file = new File([blob], pdfName, { type: "application/pdf" });
      const shareData = { files: [file], text: plain, title: `${data.companyName} — Invoice ${data.invoiceRef}` };
      if (navigator.canShare(shareData)) {
        try {
          await navigator.share(shareData);
          setBusy(null);
          return;
        } catch {
          // user cancelled or share failed — fall through to link path
        }
      }
    }
    downloadBlob(blob, pdfName);
    const text = encodeURIComponent(`${plain}`);
    window.open(
      prefer === "whatsapp"
        ? `https://wa.me/${data.waPhone}?text=${text}`
        : `https://t.me/share/url?url=${encodeURIComponent(`Invoice ${data.invoiceRef}`)}&text=${text}`,
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
    // mailto can't attach files, so the PDF downloads alongside — the user
    // attaches it in the compose window that opens.
    const blob = await fetchStatementPdf(data.bill.id);
    if (blob) downloadBlob(blob, pdfName);
    const subject = `${data.companyName} — Payment update — Invoice ${data.invoiceRef}`;
    const mailto = data.party.email
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

  return (
    <div className="space-y-2 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
            data.fullyPaid ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"
          }`}
        >
          {data.fullyPaid ? "PAID IN FULL" : `BALANCE ₹${num(data.outstanding)}`}
        </span>
        <button type="button" onClick={() => window.print()} className={`${btn} bg-slate-800 text-white hover:bg-slate-700`}>
          🖨 Print / PDF
        </button>
        <button type="button" disabled={busy !== null} onClick={() => sharePdf("whatsapp")} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}>
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
