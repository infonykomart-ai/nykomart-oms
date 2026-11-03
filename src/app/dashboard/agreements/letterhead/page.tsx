import Link from "next/link";
import { requireAnyCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { loadAgreementLetterhead } from "@/lib/agreements/letterhead";
import { AGREEMENT_MIGRATION_FILE, isMissingAgreementSchema } from "@/lib/agreements/migration";
import { LetterheadForm } from "./letterhead-form";

/**
 * Official letterhead configuration (Legal & Compliance §4). Nothing here is
 * invented: blank fields print nothing on the document, and GSTIN / legal name
 * are only what the admin saves (or what the company profile already holds).
 */
export default async function AgreementLetterheadPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>;
}) {
  const employee = await requireAnyCapability("hr_letters", "party_admin");
  const { company: requestedCompany } = await searchParams;
  const supabase = await createClient();

  const [{ data: companies }, settingsResult] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("agreement_letterhead_settings").select("*").in("company_id", employee.companyIds),
  ]);

  const migrationPending = Boolean(settingsResult.error) && isMissingAgreementSchema(settingsResult.error);
  const settingsByCompany = new Map((settingsResult.data ?? []).map((row) => [row.company_id, row]));

  const selectedCompanyId =
    requestedCompany && employee.companyIds.includes(requestedCompany)
      ? requestedCompany
      : employee.companyIds.includes(employee.currentCompanyId)
        ? employee.currentCompanyId
        : (companies?.[0]?.id ?? "");

  const letterhead = await loadAgreementLetterhead(supabase, selectedCompanyId);
  const settings = settingsByCompany.get(selectedCompanyId);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Legal &amp; Compliance</p>
          <h1 className="mt-0.5 text-2xl font-semibold text-slate-900">Agreement Letterhead</h1>
          <p className="mt-1 text-sm text-slate-500">
            Configures the official letterhead printed on every agreement PDF. Empty fields are omitted from the document — no
            registration detail is ever assumed.
          </p>
        </div>
        <Link href="/dashboard/agreements" className="text-sm font-medium text-amber-600 hover:underline">
          ← Agreement Generator
        </Link>
      </div>

      {migrationPending ? (
        <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Run <code className="rounded bg-white px-1">{AGREEMENT_MIGRATION_FILE}</code> in the Supabase SQL editor before saving
          letterhead settings.
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap gap-2">
        {(companies ?? []).map((company) => (
          <Link
            key={company.id}
            href={`/dashboard/agreements/letterhead?company=${company.id}`}
            className={`rounded-lg border px-3 py-1.5 text-sm transition ${
              company.id === selectedCompanyId
                ? "border-amber-500 bg-amber-50 font-semibold text-amber-900"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
            }`}
          >
            {company.name}
            {settingsByCompany.has(company.id) ? "" : " · not configured"}
          </Link>
        ))}
      </div>

      {letterhead ? (
        <LetterheadForm
          companyId={selectedCompanyId}
          companyName={letterhead.legalName}
          initial={{
            legalName: settings?.legal_name ?? letterhead.legalName ?? "",
            address: settings?.address ?? letterhead.address ?? "",
            email: settings?.email ?? letterhead.email ?? "",
            website: settings?.website ?? letterhead.website ?? "",
            phone: settings?.phone ?? letterhead.phone ?? "",
            gstin: settings?.gstin ?? letterhead.gstin ?? "",
            footerText: settings?.footer_text ?? letterhead.footerText,
            logoUrl: settings?.logo_url ?? letterhead.logoUrl ?? "",
            signatureUrl: settings?.signature_url ?? letterhead.signatureUrl ?? "",
            brandColor: letterhead.brandColor,
            accentColor: letterhead.accentColor,
            fontFamily: letterhead.fontFamily,
          }}
          configured={letterhead.configured}
        />
      ) : (
        <p className="text-sm text-slate-500">Select a company you have access to.</p>
      )}
    </div>
  );
}
