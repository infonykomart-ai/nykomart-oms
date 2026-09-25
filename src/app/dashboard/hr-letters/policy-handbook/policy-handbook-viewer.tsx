"use client";

import { useState } from "react";
import { policyHandbookText } from "@/lib/hr-letters/policy-handbook";
import { PrintArea } from "@/components/print-view";
import { downloadLetterDoc, mailtoLetterLink, shareLetterOnWhatsApp } from "@/lib/hr-letters/letter-export";

type Company = { id: string; name: string; logo_url: string | null };

export function PolicyHandbookViewer({ companies }: { companies: Company[] }) {
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const company = companies.find((c) => c.id === companyId);
  const companyName = company?.name ?? "";
  // 2026-09-25 — "hr latters me har section me print sahi kaam kar raha hai
  // lekin yaha kaam nahi kar raha": the print area used to render a live
  // <textarea> directly (see the removed HandbookTextarea below). Chrome's
  // print engine treats a <textarea> as an embedded form-control WIDGET,
  // not flowing text — it prints (at most) the widget's own on-screen box
  // at that box's rendered height, never the widget's full scrollable
  // content. The print CSS had `print:min-h-0` on that textarea (to stop
  // the on-screen min-h-[900px] from leaving blank trailing pages, the
  // same trick letter-form.tsx's own preview div uses) — but on a
  // <textarea> removing the min-height collapses it to a tiny few-row
  // default box instead of the div-based "shrinks to fit its real
  // content" behavior that trick relies on, so almost the whole handbook
  // text was getting clipped out of the printed page — exactly the small
  // top-left box + mostly blank A4 sheet the screenshot showed.
  //
  // Fix: the editable box and the printed output are now two separate
  // elements sharing one lifted `text` state, the same split every other
  // HR letter page already uses (letter-form.tsx's "Details" edit panel
  // vs. its print preview div; certificate-form.tsx the same) — an
  // editable <textarea> for on-screen tweaking (print:hidden, never
  // printed itself) and a plain flowing <div> inside PrintArea that
  // always mirrors its current value, which prints/paginates correctly
  // because it's real text in normal document flow, not a form control.
  const [text, setText] = useState(() => policyHandbookText(companyName));

  function handleCompanyChange(id: string) {
    setCompanyId(id);
    const next = companies.find((c) => c.id === id);
    setText(policyHandbookText(next?.name ?? ""));
  }

  const filenameBase = `policy-handbook-${companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "company"}`;
  // Word/Email/WhatsApp now send the LIVE edited text (previously these
  // always sent the original template text, a documented limitation —
  // now that `text` is lifted into this component it's the same value
  // driving the print preview, so all four outputs (Print/PDF, Word,
  // Email, WhatsApp) stay in sync with on-screen edits.
  const letterDocInput = { companyName, refNo: "", dateIssued: "", bodyText: text };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <select
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-amber-500"
          value={companyId}
          onChange={(e) => handleCompanyChange(e.target.value)}
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
          onClick={() => downloadLetterDoc(filenameBase, letterDocInput)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ⬇️ Word
        </button>
        <a
          href={mailtoLetterLink(`${companyName} — Company Policy Handbook`, letterDocInput)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ✉️ Email
        </a>
        <button
          type="button"
          onClick={() => shareLetterOnWhatsApp(filenameBase, `${companyName} — Company Policy Handbook`, letterDocInput)}
          className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          📱 WhatsApp
        </button>
      </div>

      <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm print:hidden">
        <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="handbook_text">
          Edit before printing/downloading (optional)
        </label>
        <textarea
          id="handbook_text"
          className="min-h-[400px] w-full resize-y rounded-lg border border-slate-200 p-3 text-sm leading-relaxed text-slate-900 outline-none focus:border-amber-500"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </div>

      <PrintArea id="handbook-print-area" companyName={companyName} companyLogoUrl={company?.logo_url}>
        <div className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          {company?.logo_url && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={company.logo_url} alt={company.name} className="mb-4 h-14 w-14 object-contain" />
          )}
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-900">{text}</div>
        </div>
      </PrintArea>
    </div>
  );
}
