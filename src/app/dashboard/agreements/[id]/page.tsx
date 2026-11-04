import { notFound } from "next/navigation";
import Link from "next/link";
import { requireAnyCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { AGREEMENT_MIGRATION_FILE, isMissingAgreementSchema } from "@/lib/agreements/migration";
import { AgreementWorkspace } from "./agreement-workspace";

/**
 * One agreement: preview / regenerate, download, WhatsApp share, vendor link,
 * signed-copy upload, countersign, activation, renewal, termination — plus the
 * full history, version and signature panels.
 */
export default async function AgreementDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const employee = await requireAnyCapability("hr_letters", "party_admin");
  const { id } = await params;
  const supabase = await createClient();
  // agreement_* tables are RLS-forced with zero policies (service-role only);
  // the capability + company checks below are the gate.
  const db = createServiceRoleClient();

  const { data: document, error } = await db.from("agreement_documents").select("*").eq("id", id).maybeSingle();

  if (error && isMissingAgreementSchema(error)) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-sm text-amber-900">
        <p className="font-semibold">Agreement tables are not set up yet.</p>
        <p className="mt-1">
          Run <code className="rounded bg-white px-1">{AGREEMENT_MIGRATION_FILE}</code> in the Supabase SQL editor.
        </p>
      </div>
    );
  }
  if (error || !document) notFound();
  if (!employee.companyIds.includes(document.company_id)) notFound();

  const [versions, signatures, sharing, history, company, letterheadSettings] = await Promise.all([
    db
      .from("agreement_document_versions")
      .select("id, version, pdf_sha256, pdf_size, generated_at, template_version")
      .eq("document_id", id)
      .order("version", { ascending: false }),
    db
      .from("agreement_signature_records")
      .select("id, kind, method, signer_name, signer_designation, signed_on, pdf_sha256, created_at, verification")
      .eq("document_id", id)
      .order("created_at", { ascending: false }),
    db
      .from("agreement_sharing_logs")
      .select("id, channel, provider, status, phone, created_at, actor_employee_id")
      .eq("document_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
    db
      .from("agreement_history")
      .select("id, action, actor_name, note, created_at, meta")
      .eq("document_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("companies").select("name").eq("id", document.company_id).maybeSingle(),
    db.from("agreement_letterhead_settings").select("company_id").eq("company_id", document.company_id).maybeSingle(),
  ]);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Legal &amp; Compliance · Agreement</p>
          <h1 className="mt-0.5 font-mono text-xl font-semibold text-slate-900">{document.ref_no}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {document.vendor_name_snapshot} · {company.data?.name ?? "—"}
          </p>
        </div>
        <Link href="/dashboard/agreements" className="text-sm font-medium text-amber-600 hover:underline">
          ← All agreements
        </Link>
      </div>

      <AgreementWorkspace
        agreement={{
          id: document.id,
          refNo: document.ref_no,
          status: document.status,
          templateSlug: document.template_slug,
          includedClauseSlugs: document.included_clause_slugs ?? [],
          effectiveDate: document.effective_date,
          includeWitnesses: document.include_witnesses,
          documentVersion: document.document_version,
          fieldValues: (document.field_values ?? {}) as Record<string, string>,
          vendorName: document.vendor_name_snapshot,
          renewalOf: document.renewal_of,
          terminatedReason: document.terminated_reason,
        }}
        companyName={company.data?.name ?? null}
        letterheadConfigured={Boolean(letterheadSettings.data)}
        defaultSignatoryName={employee.name}
        versions={(versions.data ?? []).map((row) => ({
          id: row.id,
          version: row.version,
          sha256: row.pdf_sha256,
          size: row.pdf_size,
          generatedAt: row.generated_at,
          templateVersion: row.template_version,
        }))}
        signatures={(signatures.data ?? []).map((row) => ({
          id: row.id,
          kind: row.kind,
          method: row.method,
          signerName: row.signer_name,
          signerDesignation: row.signer_designation,
          signedOn: row.signed_on,
          sha256: row.pdf_sha256,
          createdAt: row.created_at,
        }))}
        sharingLogs={(sharing.data ?? []).map((row) => ({
          id: row.id,
          channel: row.channel,
          provider: row.provider,
          status: row.status,
          phone: row.phone,
          createdAt: row.created_at,
        }))}
        history={(history.data ?? []).map((row) => ({
          id: row.id,
          action: row.action,
          actorName: row.actor_name,
          note: row.note,
          createdAt: row.created_at,
        }))}
      />
    </div>
  );
}
