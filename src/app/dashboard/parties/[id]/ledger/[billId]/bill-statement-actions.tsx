"use client";

// 2026-09-15 — the action bar on the read-only bill statement page
// (../[billId]/page.tsx): 🖨 Print/PDF, 📱 WhatsApp payment intimation to
// the vendor, ✉️ Email, and a copyable plain-text summary. The WhatsApp/
// email bodies are pre-filled from the bill's REAL payment rows — date,
// mode, UTR, amount paid, balance — so the vendor gets a genuine payment
// notification, not a blank template. No WhatsApp Business API: wa.me deep
// link (same pattern as shareOnWhatsApp in src/lib/export/export-table.ts)
// plus a mailto: fallback; the statement itself is shared by printing the
// page to PDF and attaching it in the same chat.

import { useState } from "react";

export function BillStatementActions({
  docTitle,
  vendorName,
  invoiceRef,
  companyName,
  totalAmt,
  creditNoteAmt,
  paidAmt,
  outstandingAmt,
  fullyPaid,
  paymentMode,
  lastPaymentDate,
  lastUtr,
  waPhone,
  partyEmail,
}: {
  docTitle: string;
  vendorName: string;
  invoiceRef: string;
  companyName: string;
  totalAmt: number;
  creditNoteAmt: number;
  paidAmt: number;
  outstandingAmt: number;
  fullyPaid: boolean;
  paymentMode: string;
  lastPaymentDate: string;
  lastUtr: string;
  waPhone: string;
  partyEmail: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const inr = (n: number) => `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Payment intimation — mirrors the ledger's own math (total − CN/adj −
  // paid = balance) so the message can never disagree with the statement.
  const paymentLines =
    paidAmt > 0
      ? `\nPayment: ${inr(paidAmt)}${paymentMode ? ` via ${paymentMode}` : ""}${lastPaymentDate ? ` on ${lastPaymentDate}` : ""}${lastUtr ? `\nUTR/Ref: ${lastUtr}` : ""}`
      : "";
  const summary =
    `*${companyName} — Payment Update*\n\n` +
    `${docTitle}\n` +
    `Vendor: ${vendorName}\n` +
    `Invoice No.: ${invoiceRef}\n` +
    `Bill Amount: ${inr(totalAmt)}` +
    (creditNoteAmt > 0 ? `\nCredit Note/Adj: − ${inr(creditNoteAmt)}` : "") +
    paymentLines +
    `\nBalance: ${fullyPaid ? "NIL — fully paid ✅" : inr(outstandingAmt)}` +
    `\n\nKindly acknowledge. Statement attached (PDF).`;

  function shareWhatsApp() {
    const url = waPhone
      ? `https://wa.me/${waPhone}?text=${encodeURIComponent(summary)}`
      : `https://wa.me/?text=${encodeURIComponent(summary)}`;
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function shareEmail() {
    const subject = `${companyName} — Payment update — Invoice ${invoiceRef}`;
    const mailto = partyEmail
      ? `mailto:${partyEmail}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(summary.replace(/\*/g, ""))}`
      : `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(summary.replace(/\*/g, ""))}`;
    window.location.href = mailto;
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(summary.replace(/\*/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (http context) — silently ignore; the
      // WhatsApp/email buttons still carry the same text.
    }
  }

  const btn =
    "rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60";
  const num = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <span
        className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
          fullyPaid ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-amber-300 bg-amber-50 text-amber-700"
        }`}
      >
        {fullyPaid ? "PAID IN FULL" : `BALANCE ₹${num(outstandingAmt)}`}
      </span>
      <button type="button" onClick={() => window.print()} className={`${btn} bg-slate-800 text-white hover:bg-slate-700`}>
        🖨 Print / PDF
      </button>
      <button type="button" onClick={shareWhatsApp} className={`${btn} bg-emerald-600 text-white hover:bg-emerald-500`}>
        📱 WhatsApp Payment Update
      </button>
      <button type="button" onClick={shareEmail} className={`${btn} bg-sky-600 text-white hover:bg-sky-500`}>
        ✉️ Email
      </button>
      <button type="button" onClick={copySummary} className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
        {copied ? "✓ Copied" : "📋 Copy summary"}
      </button>
    </div>
  );
}
