// 2026-10-29b — the FULL printed identity for the Debit Note and Credit Note
// report sheets.
//
// Until now those two pages printed only a logo and the company name, while the
// Purchase Bill statement (components/bill-statement-document.tsx) printed the
// complete letterhead. A Debit/Credit Note is a document the party files — it
// has to carry the same identity as every other sheet we send out:
//
//   left  : logo + company name + address + phone/WhatsApp + email
//   right : GSTIN / Bank / A/C No. / IFSC
//   under : a double rule, the way a printed letterhead is ruled
//
// Plain presentational components (no hooks) because they render inside
// PrintArea on server pages.
export type LetterheadCompany = { name: string; logo_url: string | null } | null;

export type LetterheadProfile = {
  address: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  gstin: string | null;
  bank_name: string | null;
  account_no: string | null;
  ifsc_code: string | null;
} | null;

export function DocLetterhead({ company, profile }: { company: LetterheadCompany; profile: LetterheadProfile }) {
  const contactLine = [
    profile?.phone && `Phone: ${profile.phone}`,
    profile?.whatsapp && `WhatsApp: ${profile.whatsapp}`,
  ]
    .filter(Boolean)
    .join("  |  ");

  return (
    <div className="mb-4 flex items-start justify-between gap-6 pb-3" style={{ borderBottom: "3px double #1e293b" }}>
      <div className="flex items-start gap-3">
        {company?.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element -- print document; a plain <img> keeps the logo out of next/image's optimizer
          <img src={company.logo_url} alt={company.name} className="h-14 w-14 object-contain" />
        )}
        <div>
          <div className="text-lg font-bold leading-tight">{company?.name ?? "—"}</div>
          {profile?.address && <div className="max-w-[24rem] whitespace-pre-wrap text-[11px] text-slate-600">{profile.address}</div>}
          {contactLine && <div className="text-[11px] text-slate-600">{contactLine}</div>}
          {profile?.email && <div className="text-[11px] text-slate-600">Email: {profile.email}</div>}
        </div>
      </div>
      <div className="shrink-0 text-right text-[10px] leading-relaxed text-slate-700">
        <div>GSTIN: {profile?.gstin ?? "—"}</div>
        <div>Bank: {profile?.bank_name ?? "—"}</div>
        <div>A/C No.: {profile?.account_no ?? "—"}</div>
        <div>IFSC: {profile?.ifsc_code ?? "—"}</div>
      </div>
    </div>
  );
}

/** The "this is a machine, not a signature" footer every generated sheet ends with. */
export function DocGeneratedFooter({ className }: { className?: string }) {
  return (
    <div className={`mt-2 text-[10px] italic text-slate-500 ${className ?? ""}`}>
      This is a computer-generated document from the Nyko Mart Order Management System — no signature required.
    </div>
  );
}
