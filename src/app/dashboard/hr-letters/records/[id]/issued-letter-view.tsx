"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PrintArea } from "@/components/print-view";
import { formatLetterDate } from "@/lib/hr-letters/templates";
import { RichTextEditor } from "@/components/hr-letters/rich-text-editor";
import { downloadLetterDoc, mailtoLetterLink, shareLetterOnWhatsApp } from "@/lib/hr-letters/letter-export";
import { updateIssuedHrLetter } from "../../actions";

type IssuedLetter = {
  id: string;
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

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

// 2026-08-27 — read-only reprint/export view for one row from the Issued
// Letters record (records/page.tsx). Renders the SAVED snapshot exactly —
// no employee lookups, no template re-render — same print-area technique
// and the same Word/Email/WhatsApp exporters as the live letter-form.tsx,
// so a re-download years later looks identical to what was originally
// issued/printed.
//
// 2026-10-23 — "print section dekh lena sath me edit vgera ka bhi dekh lena
// sahi se": Edit mode added on top of that read-only view. A mistake in an
// already-issued notice (a wrong day count, a misspelt name, a line the MD
// wants reworded) is corrected HERE, in place, instead of issuing a fresh
// letter and burning a new dispatch number. `draft` is what both the
// on-screen preview and the print area render, so printing while editing
// shows exactly what will be saved. Ref no. / letter type / dispatch series
// are never touched by the update action.
export function IssuedLetterView({ letter, company }: { letter: IssuedLetter; company: Company }) {
  const [draft, setDraft] = useState<IssuedLetter>(letter);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, startSaving] = useTransition();
  const router = useRouter();

  // Stored as a real date (ISO) for sorting/filtering, but a letter has to
  // read "07 November 2026" — same conversion the live letter form uses.
  const displayDate = formatLetterDate(draft.letterDate);

  const letterDocInput = {
    companyName: company.name || "—",
    refNo: draft.refNo ?? "",
    dateIssued: displayDate,
    toLine: draft.toWhomsoever
      ? "TO WHOMSOEVER IT MAY CONCERN"
      : `To,\n${draft.employeeName}${draft.employeeAddress ? `\n${draft.employeeAddress}` : ""}`,
    subjectLine: draft.subjectLine ?? undefined,
    bodyText: draft.bodyText,
    signatoryName: draft.signatoryName ?? undefined,
    signatoryDesignation: draft.signatoryDesignation ?? undefined,
  };
  const filenameBase = `${draft.refNo || "letter"}-${draft.employeeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  function handleSave() {
    setError(null);
    startSaving(async () => {
      const result = await updateIssuedHrLetter({
        id: draft.id,
        letterDate: draft.letterDate,
        employeeName: draft.employeeName,
        employeeAddress: draft.employeeAddress ?? "",
        subjectLine: draft.subjectLine ?? "",
        bodyText: draft.bodyText,
        signatoryName: draft.signatoryName ?? "",
        signatoryDesignation: draft.signatoryDesignation ?? "",
      });
      if (result.ok) {
        setEditing(false);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  }

  function handleCancel() {
    setDraft(letter);
    setError(null);
    setEditing(false);
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-4 rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:hidden">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">
            {draft.templateIcon} {draft.templateTitle}
          </h2>
          <Link href="/dashboard/hr-letters/records" className="text-xs text-amber-600 hover:underline">
            ← Back to record
          </Link>
        </div>

        {editing ? (
          <div className="space-y-3">
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}

            <div>
              <label className={labelClass} htmlFor="edit_employee_name">Employee</label>
              <input
                id="edit_employee_name"
                className={inputClass}
                value={draft.employeeName}
                onChange={(e) => setDraft((d) => ({ ...d, employeeName: e.target.value }))}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="edit_employee_address">Employee Address</label>
              <input
                id="edit_employee_address"
                className={inputClass}
                value={draft.employeeAddress ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, employeeAddress: e.target.value }))}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="edit_letter_date">Date</label>
              <input
                id="edit_letter_date"
                type="date"
                className={inputClass}
                value={draft.letterDate}
                onChange={(e) => setDraft((d) => ({ ...d, letterDate: e.target.value }))}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="edit_subject">Subject</label>
              <input
                id="edit_subject"
                className={inputClass}
                value={draft.subjectLine ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, subjectLine: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="edit_signatory_name">Authorized Signatory</label>
                <input
                  id="edit_signatory_name"
                  className={inputClass}
                  value={draft.signatoryName ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, signatoryName: e.target.value }))}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="edit_signatory_designation">Designation</label>
                <input
                  id="edit_signatory_designation"
                  className={inputClass}
                  value={draft.signatoryDesignation ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, signatoryDesignation: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <label className={labelClass}>Letter Text (editable)</label>
              <RichTextEditor
                html={draft.bodyText}
                onChange={(html) => setDraft((d) => ({ ...d, bodyText: html }))}
                minHeightClassName="min-h-[220px]"
              />
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className="flex-1 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {isSaving ? "Saving…" : "Save changes"}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={isSaving}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
            <p className="text-xs text-slate-400">
              Dispatch No. {draft.refNo ?? "—"} and the letter type stay the same — this corrects the same letter, it
              does not issue a new one.
            </p>
          </div>
        ) : (
          <>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Dispatch No.</dt>
                <dd className="font-mono font-medium text-slate-900">{draft.refNo ?? "—"}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Date</dt>
                <dd className="text-slate-800">{displayDate}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Employee</dt>
                <dd className="text-slate-800">{draft.employeeName}</dd>
              </div>
            </dl>

            <button
              type="button"
              onClick={() => setEditing(true)}
              className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              ✏️ Edit this letter
            </button>

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
                href={mailtoLetterLink(draft.subjectLine || draft.templateTitle, letterDocInput)}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                ✉️ Email
              </a>
              <button
                type="button"
                onClick={() => shareLetterOnWhatsApp(filenameBase, draft.subjectLine || draft.templateTitle, letterDocInput)}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
              >
                📱 WhatsApp
              </button>
            </div>
          </>
        )}
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
              <span>Ref No.: {draft.refNo || "—"}</span>
              <span>Date: {displayDate}</span>
            </div>

            {!draft.toWhomsoever && (
              <div className="mb-4 text-sm">
                <div>To,</div>
                <div className="font-semibold">{draft.employeeName}</div>
                {draft.employeeAddress && <div>{draft.employeeAddress}</div>}
              </div>
            )}

            {draft.toWhomsoever ? (
              <div className="mb-4 text-center text-sm font-bold uppercase tracking-wide">To Whomsoever It May Concern</div>
            ) : (
              draft.subjectLine && <div className="mb-4 text-sm font-semibold">Subject: {draft.subjectLine}</div>
            )}

            {/* 2026-09-23 — letters issued after the rich-text editor
                (rich-text-editor.tsx) shipped have body_text stored as
                real HTML, so it's rendered directly to keep bold/bullets/
                alignment. Letters issued before that change stored a
                plain \n-broken string with no tags at all — rendering
                THOSE as raw HTML would collapse their line breaks into
                one run-on paragraph, so plain text (no "<" followed by a
                tag-like pattern) still goes through the old
                whitespace-pre-wrap path instead. */}
            {/<[a-z][\s\S]*>/i.test(draft.bodyText) ? (
              <div
                className="text-sm leading-relaxed [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
                dangerouslySetInnerHTML={{ __html: draft.bodyText }}
              />
            ) : (
              <div className="whitespace-pre-wrap text-sm leading-relaxed">{draft.bodyText}</div>
            )}

            <div className="mt-10 text-sm">
              <div className="font-semibold">{draft.signatoryName || " "}</div>
              <div className="text-xs text-slate-500">({draft.signatoryDesignation})</div>
            </div>
          </div>
        </PrintArea>
      </div>
    </div>
  );
}
