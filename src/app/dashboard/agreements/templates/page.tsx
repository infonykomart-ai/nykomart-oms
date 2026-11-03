import Link from "next/link";
import { requireAnyCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { AGREEMENT_TEMPLATES } from "@/lib/agreements/templates";
import { AGREEMENT_MIGRATION_FILE, isMissingAgreementSchema } from "@/lib/agreements/migration";
import { TemplateRegistryTable } from "./template-registry-table";

/**
 * Template registry — the "version-controlled and legally reviewed before
 * activation" gate. The wording lives in git (lib/agreements/templates.ts with
 * a version number); this screen records who reviewed which version and makes
 * it the one new agreements may use. A template whose code version is newer
 * than the reviewed version is automatically unusable until re-reviewed.
 */
export default async function AgreementTemplatesPage() {
  await requireAnyCapability("hr_letters", "party_admin");
  const supabase = await createClient();

  const { data: registry, error } = await supabase
    .from("agreement_templates")
    .select("slug, version, status, legally_reviewed_by, legally_reviewed_on, activated_at, notes")
    .order("slug");

  const migrationPending = Boolean(error) && isMissingAgreementSchema(error);
  const bySlug = new Map((registry ?? []).map((row) => [row.slug, row]));

  const rows = AGREEMENT_TEMPLATES.map((template) => {
    const row = bySlug.get(template.slug);
    return {
      slug: template.slug,
      title: template.title,
      icon: template.icon,
      codeVersion: template.version,
      status: row?.status ?? "draft",
      reviewedVersion: row?.version ?? null,
      reviewedBy: row?.legally_reviewed_by ?? "",
      reviewedOn: row?.legally_reviewed_on ?? "",
      activatedAt: row?.activated_at ?? null,
      notes: row?.notes ?? "",
      clauseCount: template.clauses.length,
    };
  });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Legal &amp; Compliance</p>
          <h1 className="mt-0.5 text-2xl font-semibold text-slate-900">Agreement Templates</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Wording is version-controlled in the repository. Only a template whose <em>reviewed</em> version matches the code version
            and whose status is <em>active</em> can be used for a new agreement.
          </p>
        </div>
        <Link href="/dashboard/agreements" className="text-sm font-medium text-amber-600 hover:underline">
          ← Agreement Generator
        </Link>
      </div>

      {migrationPending ? (
        <div className="mb-5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Run <code className="rounded bg-white px-1">{AGREEMENT_MIGRATION_FILE}</code> in the Supabase SQL editor to create the
          template registry.
        </div>
      ) : null}

      <TemplateRegistryTable rows={rows} />
    </div>
  );
}
