"use client";

import Link from "next/link";
import { PrintArea } from "@/components/print-view";
import { downloadLetterDoc, mailtoLetterLink, shareLetterOnWhatsApp } from "@/lib/hr-letters/letter-export";

type IssuedLetter = {
  refNo: string | null;
  letterDate: string;
  employeeName: string;
  employeeAddress: string | null;
  subjectLine: string | null;
  bodyText: string;
  signatoryName: string | null;
  signatoryDesignation: string | null;
  toWhomsoever: boolean;
  templateTitle: string;
  templateIcon: string;
};

type Company = { name: string; logoUrl: string | null; address: string | null; phone: string | null; email: string | null };

// 2026-08-27 — read-only reprint/export view for one row from the Issued
// Letters record (records/page.tsx). Renders the SAVED snapshot exactly —
// no employee lookups, no template re-render — same print-area technique
// and the same Word/Email/WhatsApp exporters as the live letter-form.tsx,
// so a re-download years later looks identical to what was originally
// issued/printed.
export function IssuedLetterView({ letter, company }: { letter: IssuedLetter; company: Company }) {
  const letterDocInput = {
    companyName: company.name || "—",
    refNo: letter.refNo ?? "",
    dateIssued: letter.letterDate,
    toLine: letter.toWhomsoever
      ? "TO WHOMSOEVER IT MAY CONCERN"
      : `To,\n${letter.employeeName}${letter.employeeAddress ? `\n${letter.employeeAddress}` : ""}`,
    subjectLine: letter.subjectLine ?? undefined,
    bodyText: letter.bodyText,
    signatoryName: letter.signatoryName ?? undefined,
    signatoryDesignation: letter.signatoryDesignation ?? undefined,
  };
  const filenameBase = `${letter.refNo || "letter"}-${letter.employeeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:hidden">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            {letter.templateIcon} {letter.templateTitle}
          </h2>
          <Link href="/dashboard/hr-letters/records" className="text-xs text-amber-600 hover:underline">
            ← Back to record
          </Link>
        </div>

        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-slate-500">Dispatch No.</dt>
            <dd className="font-mono font-medium text-slate-900">{letter.refNo ?? "—"}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Date</dt>
            <dd className="text-slate-800">{letter.letterDate}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-slate-500">Employee</dt>
            <dd className="text-slate-800">{letter.employeeName}</dd>
          </div>
        </dl>

        <button
          type="button"
          onClick={() => window.print()}
          className="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600"
        >
          🖨️ Print / Save as PDF
        </button>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => downloadLetterDoc(filenameBase, letterDocInput)}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            ⬇️ Word
          </button>
          <a
            href={mailtoLetterLink(letter.subjectLine || letter.templateTitle, letterDocInput)}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            ✉️ Email
          </a>
          <button
            type="button"
            onClick={() => shareLetterOnWhatsApp(filenameBase, letter.subjectLine || letter.templateTitle, letterDocInput)}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
          >
            📱 WhatsApp
          </button>
        </div>
      </div>

      <div>
        <PrintArea id="letter-print-area">
          <div className="mx-auto w-full bg-white p-10 text-sm text-slate-900 shadow-sm" style={{ fontFamily: "Georgia, serif" }}>
            <div className="mb-6 flex items-center gap-4 border-b border-slate-300 pb-4">
              {company.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={company.logoUrl} alt={company.name} className="h-14 w-14 object-contain" />
              )}
              <div>
                <div className="text-lg font-bold">{company.name}</div>
                <div className="text-xs text-slate-500">
                  {[company.address, company.phone, company.email].filter(Boolean).join(" | ")}
                </div>
              </div>
            </div>

            <div className="mb-4 flex justify-between text-xs font-semibold">
              <span>Ref No.: {letter.refNo || "—"}</span>
              <span>Date: {letter.letterDate}</span>
            </div>

            {!letter.toWhomsoever && (
              <div className="mb-4 text-sm">
                <div>To,</div>
                <div className="font-semibold">{letter.employeeName}</div>
                {letter.employeeAddress && <div>{letter.employeeAddress}</div>}
              </div>
            )}

            {letter.toWhomsoever ? (
              <div className="mb-4 text-center text-sm font-bold uppercase tracking-wide">To Whomsoever It May Concern</div>
            ) : (
              letter.subjectLine && <div className="mb-4 text-sm font-semibold">Subject: {letter.subjectLine}</div>
            )}

            <div className="whitespace-pre-wrap text-sm leading-relaxed">{letter.bodyText}</div>

            <div className="mt-10 text-sm">
              <div className="font-semibold">{letter.signatoryName || " "}</div>
              <div className="text-xs text-slate-500">({letter.signatoryDesignation})</div>
            </div>
          </div>
        </PrintArea>
      </div>
    </div>
  );
}
