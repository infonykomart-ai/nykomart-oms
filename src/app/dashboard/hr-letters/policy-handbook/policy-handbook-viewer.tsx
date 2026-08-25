"use client";

import { useState } from "react";
import { policyHandbookText } from "@/lib/hr-letters/policy-handbook";
import { PrintArea } from "@/components/print-view";
import { downloadLetterDoc, mailtoLetterLink, shareLetterOnWhatsApp } from "@/lib/hr-letters/letter-export";

type Company = { id: string; name: string; logo_url: string | null };

export function PolicyHandbookViewer({ companies }: { companies: Company[] }) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const company = companies.find((c) => c.id === companyId);
  // Mirrors the textarea's own initial value (see HandbookTextarea below) —
  // used only for the Word/Email/WhatsApp buttons, which need the text as
  // a plain string rather than reading it out of the DOM. If the employee
  // has edited the textarea, these three still send the ORIGINAL text
  // (same limitation the textarea's own "keyed by company, no lifted
  // state" design already has); Print/PDF is the one that always reflects
  // on-screen edits, since it captures the live textarea via window.print().
  const companyName = company?.name ?? "";
  const filenameBase = `policy-handbook-${companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "company"}`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <select
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
          value={companyId}
          onChange={(e) => setCompanyId(e.target.value)}
        >
          {companies.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600"
        >
          🖨️ Print / Save as PDF
        </button>
        <button
          type="button"
          onClick={() => downloadLetterDoc(filenameBase, { companyName, refNo: "", dateIssued: "", bodyText: policyHandbookText(companyName) })}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ⬇️ Word
        </button>
        <a
          href={mailtoLetterLink(`${companyName} — Company Policy Handbook`, { companyName, refNo: "", dateIssued: "", bodyText: policyHandbookText(companyName) })}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ✉️ Email
        </a>
        <button
          type="button"
          onClick={() =>
            shareLetterOnWhatsApp(filenameBase, `${companyName} — Company Policy Handbook`, {
              companyName,
              refNo: "",
              dateIssued: "",
              bodyText: policyHandbookText(companyName),
            })
          }
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          📱 WhatsApp
        </button>
      </div>

      <PrintArea id="handbook-print-area">
      <div className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        {company?.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={company.logo_url} alt={company.name} className="mb-4 h-14 w-14 object-contain" />
        )}
        {/* Keyed by company so switching companies mounts a fresh textarea
            with that company's own default text, instead of syncing state
            in an effect (avoids the setState-in-effect cascading-render
            pattern for what is really just "reset on prop change"). */}
        <HandbookTextarea key={companyId} companyName={company?.name ?? ""} />
      </div>
      </PrintArea>
    </div>
  );
}

function HandbookTextarea({ companyName }: { companyName: string }) {
  const [text, setText] = useState(() => policyHandbookText(companyName));
  return (
    <textarea
      className="min-h-[900px] w-full resize-y border-0 text-sm leading-relaxed text-slate-900 outline-none print:min-h-0"
      value={text}
      onChange={(e) => setText(e.target.value)}
    />
  );
}
