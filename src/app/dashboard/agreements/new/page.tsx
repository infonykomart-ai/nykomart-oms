import Link from "next/link";
import { requireAnyCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { AGREEMENT_TEMPLATES, CLAUSE_LIBRARY } from "@/lib/agreements/templates";
import { AGREEMENT_MIGRATION_FILE } from "@/lib/agreements/migration";
import { NewAgreementForm, type TemplateOption, type VendorOption } from "./new-agreement-form";

/**
 * Create New Agreement — vendor + template + clause groups + details, then
 * createAgreement() assigns the NKM-AGR-YYYY-NNNNNN number and opens the
 * document workspace. Only templates whose registry row is ACTIVE and whose
 * version matches the reviewed version are offered (the same rule the server
 * action enforces).
 */
export default async function NewAgreementPage({ searchParams }: { searchParams: Promise<{ vendor?: string; template?: string }> }) {
  const employee = await requireAnyCapability("hr_letters", "party_admin");
  const { vendor: vendorParam, template: templateParam } = await searchParams;
  const supabase = await createClient();

  const [{ data: companies }, { data: parties }, { data: registry, error: registryError }] = await Promise.all([
    supabase.from("companies").select("id, name, active").in("id", employee.companyIds).order("name"),
    supabase.from("parties").select("id, name, address, contact_no, email, gst").order("name"),
    supabase.from("agreement_templates").select("slug, version, status"),
  ]);

  const registryBySlug = new Map((registry ?? []).map((row) => [row.slug, row]));
  const migrationPending = Boolean(registryError);

  const templates: TemplateOption[] = AGREEMENT_TEMPLATES.map((template) => {
    const row = registryBySlug.get(template.slug);
    const status = row?.status ?? "draft";
    const versionMatches = row?.version === template.version;
    return {
      slug: template.slug,
      title: template.title,
      icon: template.icon,
      summary: template.summary,
      version: template.version,
      reviewedVersion: row?.version ?? null,
      status,
      usable: !migrationPending && status === "active" && versionMatches,
      blockedReason: !row
        ? "Not in the template registry yet"
        : status !== "active"
          ? `Template is ${status.replace("_", " ")} — legal review + activation required`
          : !versionMatches
            ? `Wording changed since review (code v${template.version}, reviewed v${row.version})`
            : null,
    };
  });

  const vendors: VendorOption[] = (parties ?? []).map((party) => ({
    id: party.id,
    name: party.name,
    address: party.address ?? null,
    contactNo: party.contact_no ?? null,
    email: party.email ?? null,
    gst: party.gst ?? null,
  }));

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Create New Agreement</h1>
          <p className="mt-1 text-sm text-slate-500">
            Pick the vendor and an activated template, verify the vendor details, then generate the agreement number and PDF.
          </p>
        </div>
        <Link href="/dashboard/agreements" className="text-sm font-medium text-amber-600 hover:underline">
          ← All agreements
        </Link>
      </div>

      {migrationPending && (
        <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-semibold">Agreement tables are not set up yet.</p>
          <p className="mt-1">
            Run <code className="rounded bg-white px-1">{AGREEMENT_MIGRATION_FILE}</code> in the Supabase SQL editor. No agreement can
            be created until then — the template registry and numbering function live in that file.
          </p>
        </div>
      )}

      <NewAgreementForm
        templates={templates}
        vendors={vendors}
        defaultVendorId={vendors.some((vendor) => vendor.id === vendorParam) ? (vendorParam as string) : ""}
        defaultTemplateSlug={templates.some((template) => template.slug === templateParam) ? (templateParam as string) : ""}
        companies={(companies ?? []).map((company) => ({ id: company.id, name: company.name }))}
        defaultCompanyId={
          employee.companyIds.includes(employee.currentCompanyId) ? employee.currentCompanyId : (companies?.[0]?.id ?? "")
        }
        defaultSignatoryName={employee.name}
        defaultEffectiveDate={todayIST()}
        clauseGroups={CLAUSE_LIBRARY.map((group) => ({ slug: group.slug, title: group.title, summary: group.summary }))}
      />
    </div>
  );
}

