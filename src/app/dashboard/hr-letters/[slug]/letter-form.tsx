"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { renderTemplate, todayFormatted, type LetterTemplate } from "@/lib/hr-letters/templates";
import { PrintArea } from "@/components/print-view";
import { downloadLetterDoc, mailtoLetterLink, shareLetterOnWhatsApp } from "@/lib/hr-letters/letter-export";
import { issueHrLetter } from "../actions";

type Employee = {
  id: string;
  name: string;
  company_id: string;
  designation: string | null;
  employee_code: string | null;
  date_of_joining: string | null;
};
type Company = { id: string; name: string; logo_url: string | null; active: boolean };
type CompanyProfile = { company_id: string; address: string | null; phone: string | null; email: string | null };

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export function LetterForm({
  template,
  employees,
  companies,
  companyProfiles,
}: {
  template: LetterTemplate;
  employees: Employee[];
  companies: Company[];
  companyProfiles: CompanyProfile[];
}) {
  const [employeeId, setEmployeeId] = useState("");
  const [employeeName, setEmployeeName] = useState("");
  const [employeeAddress, setEmployeeAddress] = useState("");
  const [refNo, setRefNo] = useState("");
  const [dateIssued, setDateIssued] = useState(todayFormatted());
  const [signatoryName, setSignatoryName] = useState("");
  const [signatoryDesignation, setSignatoryDesignation] = useState("Director / CEO");

  const initialFieldValues: Record<string, string> = {};
  for (const f of template.fields) initialFieldValues[f.key] = f.default ?? "";
  const [fieldValues, setFieldValues] = useState(initialFieldValues);
  const [bodyText, setBodyText] = useState("");
  const [hasGenerated, setHasGenerated] = useState(false);

  // 2026-08-27 — "record teyar hota jaye ... usko ek no diya jaye": a
  // deliberate, separate step from Print/Word/Email/WhatsApp (those still
  // work exactly as before, unchanged) — clicking "Issue" is what actually
  // saves this letter into the hr_letters record and assigns its dispatch
  // no. (ref_no), so previewing/printing a draft never burns a number.
  // Regenerating the text (below) clears this, since a regenerated letter
  // is a new draft that needs its own Issue step / dispatch number.
  const [issuing, setIssuing] = useState(false);
  const [issued, setIssued] = useState<{ id: string; refNo: string } | null>(null);
  const [issueError, setIssueError] = useState<string | null>(null);

  const [companyId, setCompanyId] = useState("");

  const companyMap = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies]);
  const profileMap = useMemo(() => new Map(companyProfiles.map((p) => [p.company_id, p])), [companyProfiles]);
  const company = companyMap.get(companyId);
  const profile = company ? profileMap.get(company.id) : undefined;

  // Company is a SEPARATE, directly-editable dropdown — not derived from
  // the employee's `company_id` (their fixed "home company" in the DB).
  // Real staff work across all 3 companies from one login (see
  // employee_company_access), so an employee's home company often has
  // nothing to do with which company's letterhead is actually needed.
  // Picking an employee just pre-fills a sensible default company.
  function handleEmployeeChange(id: string) {
    setEmployeeId(id);
    const emp = employees.find((e) => e.id === id);
    if (emp) {
      setEmployeeName(emp.name);
      if (!companyId) setCompanyId(emp.company_id);
      // Pre-fill any matching common fields (job title comes from designation, etc.)
      setFieldValues((prev) => ({
        ...prev,
        ...(template.fields.some((f) => f.key === "employee_id") ? { employee_id: emp.employee_code ?? "" } : {}),
        ...(template.fields.some((f) => f.key === "date_of_joining") ? { date_of_joining: emp.date_of_joining ?? "" } : {}),
        ...(template.fields.some((f) => f.key === "job_title") && emp.designation ? { job_title: emp.designation } : {}),
      }));
    }
  }

  function generateBody() {
    const values: Record<string, string> = {
      employee_name: employeeName,
      employee_address: employeeAddress,
      company_name: company?.name ?? "",
      reference_number: refNo,
      date_issued: dateIssued,
      ...fieldValues,
    };
    setBodyText(renderTemplate(template.bodyTemplate, values));
    setHasGenerated(true);
    setIssued(null);
    setIssueError(null);
  }

  const subject = renderTemplate(template.subject, fieldValues);

  async function handleIssue() {
    setIssuing(true);
    setIssueError(null);
    const selectedEmployee = employees.find((e) => e.id === employeeId);
    const result = await issueHrLetter({
      templateSlug: template.slug,
      companyId,
      employeeId: employeeId || null,
      employeeName,
      employeeCode: selectedEmployee?.employee_code ?? null,
      employeeAddress,
      letterDate: dateIssued,
      signatoryName,
      signatoryDesignation,
      subjectLine: subject,
      fieldValues,
      bodyText,
    });
    setIssuing(false);
    if (result.ok) {
      setIssued({ id: result.id, refNo: result.refNo });
      setRefNo(result.refNo);
    } else {
      setIssueError(result.error);
    }
  }

  // Shared shape for Word/Email/WhatsApp — same content the print area
  // renders, built once here so all three "send" buttons and the print
  // area stay in sync with whatever's currently in the editable fields.
  const letterDocInput = {
    companyName: company?.name ?? "Select company",
    refNo,
    dateIssued,
    toLine: template.toWhomsoever ? "TO WHOMSOEVER IT MAY CONCERN" : `To,\n${employeeName || "Employee Name"}${employeeAddress ? `\n${employeeAddress}` : ""}`,
    subjectLine: !template.toWhomsoever && subject ? `Subject: ${subject}` : undefined,
    bodyText: bodyText || "",
    signatoryName,
    signatoryDesignation,
  };
  const filenameBase = `${template.slug}-${(employeeName || "letter").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <div className="space-y-5 rounded-xl border border-slate-200 bg-white p-6 shadow-sm print:hidden">
        <h2 className="text-sm font-semibold text-slate-900">Details</h2>

        <div>
          <label className={labelClass} htmlFor="employee">Employee *</label>
          <select id="employee" className={inputClass} value={employeeId} onChange={(e) => handleEmployeeChange(e.target.value)}>
            <option value="">Select employee</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>{e.name}{e.designation ? ` — ${e.designation}` : ""}</option>
            ))}
          </select>
        </div>

        <div>
          <label className={labelClass} htmlFor="company">Company (letterhead) *</label>
          <select id="company" className={inputClass} value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">Select company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-slate-400">
            Selecting an employee fills in a default company — you can change it here if needed.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass} htmlFor="employee_name">Name (on letter)</label>
            <input id="employee_name" className={inputClass} value={employeeName} onChange={(e) => setEmployeeName(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="ref_no">Reference No. {issued && <span className="font-normal text-emerald-600">(dispatch no. assigned)</span>}</label>
            <input
              id="ref_no"
              className={inputClass}
              value={refNo}
              onChange={(e) => setRefNo(e.target.value)}
              placeholder="Assigned automatically when you click Issue below"
              readOnly={!!issued}
            />
          </div>
        </div>

        {!template.toWhomsoever && (
          <div>
            <label className={labelClass} htmlFor="employee_address">Employee Address</label>
            <input id="employee_address" className={inputClass} value={employeeAddress} onChange={(e) => setEmployeeAddress(e.target.value)} />
          </div>
        )}

        {template.fields.map((f) => (
          <div key={f.key}>
            <label className={labelClass} htmlFor={f.key}>{f.label}</label>
            {f.type === "textarea" ? (
              <textarea
                id={f.key}
                rows={3}
                className={inputClass}
                value={fieldValues[f.key] ?? ""}
                onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            ) : (
              <input
                id={f.key}
                type={f.type === "date" ? "date" : "text"}
                className={inputClass}
                value={fieldValues[f.key] ?? ""}
                onChange={(e) => setFieldValues((prev) => ({ ...prev, [f.key]: e.target.value }))}
              />
            )}
          </div>
        ))}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelClass} htmlFor="signatory_name">Authorized Signatory</label>
            <input id="signatory_name" className={inputClass} value={signatoryName} onChange={(e) => setSignatoryName(e.target.value)} />
          </div>
          <div>
            <label className={labelClass} htmlFor="signatory_designation">Designation</label>
            <input id="signatory_designation" className={inputClass} value={signatoryDesignation} onChange={(e) => setSignatoryDesignation(e.target.value)} />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="date_issued">Date</label>
          <input id="date_issued" className={inputClass} value={dateIssued} onChange={(e) => setDateIssued(e.target.value)} />
        </div>

        <button
          type="button"
          onClick={generateBody}
          disabled={!employeeId || !companyId}
          className="w-full rounded-lg border border-amber-500 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-40"
        >
          {hasGenerated ? "Regenerate text (this will overwrite your edits below)" : "Generate letter text"}
        </button>

        {hasGenerated && (
          <div>
            <label className={labelClass} htmlFor="body_text">Letter Text (editable)</label>
            <textarea id="body_text" rows={14} className={inputClass} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
          </div>
        )}

        {issueError && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{issueError}</p>}

        <button
          type="button"
          onClick={handleIssue}
          disabled={!hasGenerated || issuing || !!issued}
          className="w-full rounded-lg border border-emerald-500 bg-emerald-50 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-40"
        >
          {issued ? `✅ Issued — Dispatch No. ${issued.refNo}` : issuing ? "Saving record…" : "📌 Save Record & Assign Dispatch No."}
        </button>
        {issued && (
          <p className="text-xs text-slate-400">
            Saved to the Issued Letters record.{" "}
            <Link href="/dashboard/hr-letters/records" className="text-amber-600 hover:underline">View record →</Link>
          </p>
        )}

        <button
          type="button"
          onClick={() => window.print()}
          disabled={!hasGenerated}
          className="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-40"
        >
          🖨️ Print / Save as PDF
        </button>

        {/* 2026-08-25 — "file ko print, save in PDF, WORD email whatsapp ka
            option kyu nahi aara": Print/PDF already covered PDF (the
            browser's own print dialog has a Save-as-PDF destination) but
            these three didn't exist. Same send-a-real-file idea as the
            Universal Reports Export/Send system, just for one letter's
            free text instead of a rows/columns table — see
            lib/hr-letters/letter-export.ts. */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => downloadLetterDoc(filenameBase, letterDocInput)}
            disabled={!hasGenerated}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
          >
            ⬇️ Word
          </button>
          <a
            href={hasGenerated ? mailtoLetterLink(subject || template.title, letterDocInput) : undefined}
            aria-disabled={!hasGenerated}
            className={`flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-center text-xs font-medium text-slate-700 transition hover:bg-slate-50 ${!hasGenerated ? "pointer-events-none opacity-40" : ""}`}
          >
            ✉️ Email
          </a>
          <button
            type="button"
            onClick={() => shareLetterOnWhatsApp(filenameBase, subject || template.title, letterDocInput)}
            disabled={!hasGenerated}
            className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
          >
            📱 WhatsApp
          </button>
        </div>
      </div>

      <div>
        <PrintArea id="letter-print-area">
        {/* 2026-08-27 — "pure page ka print hota hai lekin jo data apn
            dalte hai uska hi print hona chahiye": min-h-[1000px] gives the
            on-screen preview a nice full-page look, but PrintArea's
            @media print CSS (print-view.tsx) never neutralizes min-h-*
            utilities, so the forced 1000px minimum height was printing as
            blank space below the actual letter content on every letter
            shorter than that. print:min-h-0 removes ONLY the print-time
            minimum — screen preview is unchanged, the printed/PDF page now
            sizes to the real content. */}
        <div className="mx-auto min-h-[1000px] w-full bg-white p-10 text-sm text-slate-900 shadow-sm print:min-h-0" style={{ fontFamily: "Georgia, serif" }}>
          <div className="mb-6 flex items-center gap-4 border-b border-slate-300 pb-4">
            {company?.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logo_url} alt={company.name} className="h-14 w-14 object-contain" />
            )}
            <div>
              <div className="text-lg font-bold">{company?.name ?? "Select company"}</div>
              <div className="text-xs text-slate-500">
                {[profile?.address, profile?.phone, profile?.email].filter(Boolean).join(" | ")}
              </div>
            </div>
          </div>

          <div className="mb-4 flex justify-between text-xs font-semibold">
            <span>Ref No.: {refNo || "—"}</span>
            <span>Date: {dateIssued}</span>
          </div>

          {!template.toWhomsoever && (
            <div className="mb-4 text-sm">
              <div>To,</div>
              <div className="font-semibold">{employeeName || "Employee Name"}</div>
              {employeeAddress && <div>{employeeAddress}</div>}
            </div>
          )}

          {template.toWhomsoever ? (
            <div className="mb-4 text-center text-sm font-bold uppercase tracking-wide">To Whomsoever It May Concern</div>
          ) : (
            subject && <div className="mb-4 text-sm font-semibold">Subject: {subject}</div>
          )}

          <div className="whitespace-pre-wrap text-sm leading-relaxed">
            {bodyText || "Click \"Generate letter text\" — the text will appear here, and you can edit it before printing."}
          </div>

          <div className="mt-10 text-sm">
            <div className="font-semibold">{signatoryName || " "}</div>
            <div className="text-xs text-slate-500">({signatoryDesignation})</div>
          </div>
        </div>
        </PrintArea>
      </div>
    </div>
  );
}
