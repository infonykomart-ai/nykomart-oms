// 2026-10-24 — the printed letterhead block for bill sheets: logo + company
// name + address + GSTIN/phone/email. Reads its data from
// loadCompanyLetterhead() (src/lib/company-letterhead.ts), which always
// resolves the DOCUMENT's own company, so a bill entered under Rugara prints
// Rugara's letterhead even when the top-nav switcher is on Nyko Mart.
//
// Deliberately a plain (server) component with no hooks: it is rendered inside
// PrintArea on the A4 report pages, including from the dialog's iframe.
import type { CompanyLetterhead as Letterhead } from "@/lib/company-letterhead";

export function CompanyLetterheadHeader({
  letterhead,
  title,
  subtitle,
  className,
}: {
  letterhead: Letterhead | null;
  /** Document title, e.g. "Courier Bill Report". */
  title: string;
  /** Line under the title, e.g. "Invoice FEDX-123 · 2026-10-24". */
  subtitle?: string;
  className?: string;
}) {
  const contact = [letterhead?.gstin ? `GSTIN: ${letterhead.gstin}` : null, letterhead?.phone ? `Ph: ${letterhead.phone}` : null, letterhead?.email]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className={`flex items-start gap-3 ${className ?? ""}`}>
      {letterhead?.logo_url && (
        // eslint-disable-next-line @next/next/no-img-element -- print document; a plain <img> keeps the logo out of next/image's optimizer
        <img src={letterhead.logo_url} alt={letterhead.name} className="h-10 w-10 object-contain" />
      )}
      <div className="leading-tight">
        {letterhead?.name && (
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{letterhead.name}</p>
        )}
        {letterhead?.address && (
          <p className="max-w-[22rem] whitespace-pre-wrap text-[10px] text-slate-500">{letterhead.address}</p>
        )}
        {contact && <p className="text-[10px] text-slate-500">{contact}</p>}
        <h1 className="mt-1 text-lg font-bold text-slate-900">{title}</h1>
        {subtitle && <p className="text-slate-500">{subtitle}</p>}
      </div>
    </div>
  );
}
