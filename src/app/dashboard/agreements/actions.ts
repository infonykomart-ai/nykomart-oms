"use server";

// 2026-11-03 — AGREEMENT GENERATOR server actions.
//
// Everything that touches agreement data goes through this file, always behind
// requireAnyCapability("hr_letters", "party_admin") — the capability MD/Admin
// already hold for issuing official documents — and always scoped to the
// companies the signed-in employee can act for. Tables are RLS-forced with no
// policies, so the service-role client used here is safe ONLY because of that
// guard (same model as hr_letters).
//
// WORKFLOW (Legal & Compliance → Agreement Generator):
//   createAgreement()            — assigns NKM-AGR-YYYY-NNNNNN, saves draft
//   saveAgreementDraft()         — edit before/while issuing
//   previewAgreementPdf()        — renders the CURRENT draft, stores nothing
//   generateAgreementVersion()   — stores an immutable PDF version + SHA-256
//   recordAgreementShareLog()    — WhatsApp / email / download audit trail
//   createVendorAccessLink()     — expiring, hashed vendor link
//   uploadAgreementSignature()   — scanned signed copy OR countersigned copy
//   activateAgreement()          — only after both signatures exist
//   renewAgreement() / terminateAgreement()
//   saveAgreementLetterheadSettings() / setAgreementTemplateStatus()
//   startEsignRequest()          — provider adapter, "not configured" by default
//
// MIGRATION TOLERANCE: if db/2026-11-03-vendor-agreements.sql has not been run
// yet, every action returns a readable "run this file" message instead of a
// raw Postgres error (the repo's deliver-not-execute convention).
import { revalidatePath } from "next/cache";
import { requireAnyCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import {
  AGREEMENT_META_FIELDS,
  VENDOR_FIELDS,
  agreementFileBase,
  findAgreementTemplate,
  type AgreementTemplate,
  type AgreementValues,
} from "@/lib/agreements/templates";
// (AgreementTemplate is still used by the sanitizer's parameter type.)
import { buildAgreementDocument, type AgreementDocumentRow } from "@/lib/agreements/build-document";
import { loadAgreementLetterhead, isHexColor, AGREEMENT_FONT_OPTIONS, type AgreementFontFamily } from "@/lib/agreements/letterhead";
import { renderAgreementPdf } from "@/lib/agreements/agreement-pdf";
import {
  agreementPdfPath,
  createAccessToken,
  getAgreementPdf,
  hashAccessToken,
  putAgreementPdf,
  sha256Hex,
  validateUploadedPdf,
} from "@/lib/agreements/storage";
import { describeAgreementForLog, whatsAppDigits } from "@/lib/agreements/message";
import { AGREEMENT_MIGRATION_FILE, AGREEMENT_MIGRATION_HINT, isMissingAgreementSchema } from "@/lib/agreements/migration";
import type { Json } from "@/types/database";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

const MIGRATION_HINT = AGREEMENT_MIGRATION_HINT;

type ActionResult = { ok: true } | { ok: false; error: string };

function failure(error: { code?: string | null; message?: string | null } | null, fallback: string): { ok: false; error: string } {
  if (isMissingAgreementSchema(error)) return { ok: false, error: MIGRATION_HINT };
  return { ok: false, error: error?.message ?? fallback };
}

const MAX_FIELD_LENGTH = 4000;
const MAX_CLAUSES_LENGTH = 20000;

function sanitizeValues(template: AgreementTemplate, raw: AgreementValues | undefined): AgreementValues {
  const allowed = new Set([
    ...VENDOR_FIELDS.map((field) => field.key),
    ...AGREEMENT_META_FIELDS.map((field) => field.key),
    ...template.fields.map((field) => field.key),
  ]);
  const clean: AgreementValues = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!allowed.has(key) || typeof value !== "string") continue;
    const limit = key === "custom_clauses" ? MAX_CLAUSES_LENGTH : MAX_FIELD_LENGTH;
    clean[key] = value.slice(0, limit);
  }
  return clean;
}

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

type DocumentRow = AgreementDocumentRow & {
  company_id: string;
  vendor_name_snapshot: string;
  status: Database["public"]["Tables"]["agreement_documents"]["Row"]["status"];
  template_version: number;
  document_version: number;
  created_by: string;
};

type Loaded = {
  supabase: Client;
  employee: Awaited<ReturnType<typeof requireAnyCapability>>;
  document: DocumentRow;
  letterhead: NonNullable<Awaited<ReturnType<typeof loadAgreementLetterhead>>>;
};

/** Fetches one document + its letterhead, enforcing capability + company scope. */
async function loadDocument(documentId: string): Promise<{ ok: true; loaded: Loaded } | { ok: false; error: string }> {
  const employee = await requireAnyCapability("hr_letters", "party_admin");
  if (!documentId) return { ok: false, error: "Missing agreement id." };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("agreement_documents")
    .select(
      "id, ref_no, company_id, template_slug, template_version, included_clause_slugs, effective_date, field_values, include_witnesses, vendor_name_snapshot, status, document_version, created_by"
    )
    .eq("id", documentId)
    .maybeSingle();

  if (error) return failure(error, "Agreement not found.");
  if (!data) return { ok: false, error: "Agreement not found." };
  if (!employee.companyIds.includes(data.company_id)) {
    return { ok: false, error: "You do not have access to this company's agreements." };
  }

  const letterhead = await loadAgreementLetterhead(supabase, data.company_id);
  if (!letterhead) return { ok: false, error: "Company letterhead details could not be loaded." };

  return { ok: true, loaded: { supabase, employee, document: data as DocumentRow, letterhead } };
}

async function logHistory(
  supabase: Client,
  args: {
    documentId: string;
    action: Database["public"]["Tables"]["agreement_history"]["Insert"]["action"];
    actorEmployeeId?: string | null;
    actorName?: string | null;
    note?: string | null;
    meta?: Json;
  }
) {
  await supabase.from("agreement_history").insert({
    document_id: args.documentId,
    action: args.action,
    actor_employee_id: args.actorEmployeeId ?? null,
    actor_name: args.actorName ?? null,
    note: args.note ?? null,
    meta: args.meta ?? {},
  });
}

async function assertTemplateActive(supabase: Client, template: AgreementTemplate): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from("agreement_templates")
    .select("slug, version, status")
    .eq("slug", template.slug)
    .maybeSingle();

  if (error) return failure(error, "Template registry could not be read.");
  if (!data) return { ok: false, error: `Template "${template.title}" is not in the registry — run ${AGREEMENT_MIGRATION_FILE}.` };
  if (data.status !== "active") {
    return {
      ok: false,
      error: `Template "${template.title}" is not active yet (status: ${data.status}). Record its legal review on Legal & Compliance → Templates before issuing from it.`,
    };
  }
  if (data.version !== template.version) {
    return {
      ok: false,
      error: `Template "${template.title}" wording changed (v${template.version} in code, v${data.version} reviewed). Re-review and activate the new version before issuing.`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Create / edit
// ---------------------------------------------------------------------------

export type CreateAgreementInput = {
  templateSlug: string;
  companyId: string;
  vendorPartyId?: string | null;
  values: AgreementValues;
  includeWitnesses: boolean;
  clauseGroupSlugs: string[];
};

export async function createAgreement(
  input: CreateAgreementInput
): Promise<{ ok: true; id: string; refNo: string } | { ok: false; error: string }> {
  const employee = await requireAnyCapability("hr_letters", "party_admin");
  const template = findAgreementTemplate(input.templateSlug);
  if (!template) return { ok: false, error: "Unknown agreement template." };
  if (!employee.companyIds.includes(input.companyId)) return { ok: false, error: "You do not have access to this company." };

  const values = sanitizeValues(template, input.values);
  const legalName = (values.vendor_legal_name ?? "").trim();
  const address = (values.vendor_address ?? "").trim();
  const effectiveDate = isoDate(values.effective_date);
  if (!legalName) return { ok: false, error: "Vendor legal name is required." };
  if (!address) return { ok: false, error: "Vendor registered address is required." };
  if (!effectiveDate) return { ok: false, error: "A valid effective date is required." };

  const supabase = createServiceRoleClient();
  const templateOk = await assertTemplateActive(supabase, template);
  if (!templateOk.ok) return templateOk;

  const year = Number(effectiveDate.slice(0, 4));
  const { data: refNo, error: refError } = await supabase.rpc("next_agreement_ref", { p_year: year });
  if (refError || !refNo) return failure(refError, "Could not allocate an agreement number.");

  const { data: document, error } = await supabase
    .from("agreement_documents")
    .insert({
      ref_no: refNo as string,
      company_id: input.companyId,
      vendor_party_id: input.vendorPartyId || null,
      vendor_name_snapshot: legalName,
      template_slug: template.slug,
      template_version: template.version,
      included_clause_slugs: input.clauseGroupSlugs.filter((slug) => Boolean(slug)),
      status: "draft",
      effective_date: effectiveDate,
      field_values: values as unknown as Json,
      include_witnesses: input.includeWitnesses,
      created_by: employee.id,
    })
    .select("id, ref_no")
    .single();

  if (error || !document) return failure(error, "Could not create the agreement.");

  const { error: vendorError } = await supabase.from("agreement_vendor_details").upsert({
    document_id: document.id,
    legal_name: legalName,
    business_name: values.vendor_business_name || null,
    contact_person: values.vendor_contact_person || null,
    designation: values.vendor_designation || null,
    address,
    city: values.vendor_city || null,
    state: values.vendor_state || null,
    country: values.vendor_country || null,
    postal_code: values.vendor_postal_code || null,
    email: values.vendor_email || null,
    whatsapp: values.vendor_whatsapp || null,
    gstin: values.vendor_gstin || null,
    registration_no: values.vendor_reg_no || null,
    category: values.vendor_category || null,
  });
  if (vendorError) return failure(vendorError, "Agreement created but the vendor details could not be saved.");

  await logHistory(supabase, {
    documentId: document.id,
    action: "created",
    actorEmployeeId: employee.id,
    actorName: employee.name,
    note: describeAgreementForLog({
      templateTitle: template.title,
      vendorName: legalName,
      refNo: document.ref_no,
      version: 0,
      values,
    }),
    meta: { templateSlug: template.slug, clauseGroups: input.clauseGroupSlugs },
  });

  revalidatePath("/dashboard/agreements");
  return { ok: true, id: document.id, refNo: document.ref_no };
}

export type SaveDraftInput = {
  id: string;
  values: AgreementValues;
  includeWitnesses: boolean;
  clauseGroupSlugs: string[];
};

export async function saveAgreementDraft(input: SaveDraftInput): Promise<ActionResult> {
  const result = await loadDocument(input.id);
  if (!result.ok) return result;
  const { supabase, employee, document } = result.loaded;

  if (["countersigned", "active", "terminated", "renewed"].includes(document.status)) {
    return { ok: false, error: "This agreement is already executed — create a new version or a renewal instead of editing it." };
  }

  const template = findAgreementTemplate(document.template_slug);
  if (!template) return { ok: false, error: "Unknown agreement template." };

  const values = sanitizeValues(template, input.values);
  const legalName = (values.vendor_legal_name ?? "").trim();
  const address = (values.vendor_address ?? "").trim();
  const effectiveDate = isoDate(values.effective_date);
  if (!legalName) return { ok: false, error: "Vendor legal name is required." };
  if (!address) return { ok: false, error: "Vendor registered address is required." };
  if (!effectiveDate) return { ok: false, error: "A valid effective date is required." };

  const { error } = await supabase
    .from("agreement_documents")
    .update({
      vendor_name_snapshot: legalName,
      effective_date: effectiveDate,
      field_values: values as unknown as Json,
      include_witnesses: input.includeWitnesses,
      included_clause_slugs: input.clauseGroupSlugs.filter(Boolean),
    })
    .eq("id", document.id);
  if (error) return failure(error, "Could not save the agreement.");

  const { error: vendorError } = await supabase.from("agreement_vendor_details").upsert({
    document_id: document.id,
    legal_name: legalName,
    business_name: values.vendor_business_name || null,
    contact_person: values.vendor_contact_person || null,
    designation: values.vendor_designation || null,
    address,
    city: values.vendor_city || null,
    state: values.vendor_state || null,
    country: values.vendor_country || null,
    postal_code: values.vendor_postal_code || null,
    email: values.vendor_email || null,
    whatsapp: values.vendor_whatsapp || null,
    gstin: values.vendor_gstin || null,
    registration_no: values.vendor_reg_no || null,
    category: values.vendor_category || null,
  });
  if (vendorError) return failure(vendorError, "Could not save the vendor details.");

  await logHistory(supabase, {
    documentId: document.id,
    action: "updated",
    actorEmployeeId: employee.id,
    actorName: employee.name,
    note: "Agreement details updated",
  });

  revalidatePath(`/dashboard/agreements/${document.id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// PDF preview / generation
// ---------------------------------------------------------------------------

async function buildPdfForDocument(loaded: Loaded, versionLabel: number) {
  const { document, letterhead, employee } = loaded;
  const built = buildAgreementDocument({
    document,
    vendorName: document.vendor_name_snapshot,
    letterhead,
    version: versionLabel,
    signatoryName: employee.name,
    signatoryDesignation: "Authorised Signatory",
  });
  const buffer = await renderAgreementPdf(built.data);
  return { built, buffer };
}

export async function previewAgreementPdf(id: string): Promise<{ ok: true; base64: string; fileName: string } | { ok: false; error: string }> {
  const result = await loadDocument(id);
  if (!result.ok) return result;
  const { document } = result.loaded;
  try {
    const { buffer } = await buildPdfForDocument(result.loaded, Math.max(1, document.document_version));
    return {
      ok: true,
      base64: buffer.toString("base64"),
      fileName: `${agreementFileBase({ slug: document.template_slug }, document.vendor_name_snapshot)}.pdf`,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not render the preview PDF." };
  }
}

export async function generateAgreementVersion(
  id: string
): Promise<{ ok: true; version: number; sha256: string; fileName: string } | { ok: false; error: string }> {
  const result = await loadDocument(id);
  if (!result.ok) return result;
  const { supabase, employee, document } = result.loaded;

  if (document.status === "terminated" || document.status === "renewed") {
    return { ok: false, error: "This agreement is closed — generate a renewal instead." };
  }
  if (document.status === "active" || document.status === "countersigned") {
    return { ok: false, error: "This agreement is already executed. Create a renewal to issue a new document." };
  }

  const nextVersion = document.document_version + 1;
  let buffer: Buffer;
  let built: Awaited<ReturnType<typeof buildPdfForDocument>>["built"];
  try {
    const rendered = await buildPdfForDocument(result.loaded, nextVersion);
    buffer = rendered.buffer;
    built = rendered.built;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Could not generate the PDF." };
  }

  const path = agreementPdfPath({ companyId: document.company_id, documentId: document.id, kind: "generated", version: nextVersion });
  const upload = await putAgreementPdf(path, buffer);
  if (!upload.ok) return { ok: false, error: `PDF storage failed: ${upload.error}` };

  const sha256 = sha256Hex(buffer);
  const { error: versionError } = await supabase.from("agreement_document_versions").insert({
    document_id: document.id,
    version: nextVersion,
    pdf_path: path,
    pdf_sha256: sha256,
    pdf_size: buffer.byteLength,
    template_version: built.template.version,
    content_snapshot: built.snapshot as unknown as Json,
    generated_by: employee.id,
  });
  if (versionError) return failure(versionError, "Could not record the PDF version.");

  const { error: updateError } = await supabase
    .from("agreement_documents")
    .update({
      document_version: nextVersion,
      template_version: built.template.version,
      status: document.status === "draft" ? "generated" : document.status,
    })
    .eq("id", document.id);
  if (updateError) return failure(updateError, "PDF stored but the document could not be updated.");

  await logHistory(supabase, {
    documentId: document.id,
    action: nextVersion === 1 ? "pdf_generated" : "pdf_regenerated",
    actorEmployeeId: employee.id,
    actorName: employee.name,
    note: `PDF version v${nextVersion} generated (${(buffer.byteLength / 1024).toFixed(1)} KB)`,
    meta: { version: nextVersion, sha256, templateVersion: built.template.version },
  });

  revalidatePath(`/dashboard/agreements/${document.id}`);
  revalidatePath("/dashboard/agreements");
  return {
    ok: true,
    version: nextVersion,
    sha256,
    fileName: `${agreementFileBase({ slug: document.template_slug }, document.vendor_name_snapshot)}-v${nextVersion}.pdf`,
  };
}

// ---------------------------------------------------------------------------
// Sharing
// ---------------------------------------------------------------------------

export type ShareLogInput = {
  id: string;
  channel: "whatsapp" | "email" | "download" | "vendor_link";
  provider?: string | null;
  status: "initiated" | "sent" | "failed" | "manual_attach_required";
  phone?: string | null;
  message?: string | null;
  providerMessageId?: string | null;
};

export async function recordAgreementShareLog(input: ShareLogInput): Promise<ActionResult> {
  const result = await loadDocument(input.id);
  if (!result.ok) return result;
  const { supabase, employee, document } = result.loaded;

  const { data: currentVersion } = await supabase
    .from("agreement_document_versions")
    .select("id, version")
    .eq("document_id", document.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const phone = input.phone ? whatsAppDigits(input.phone) : null;
  const { error } = await supabase.from("agreement_sharing_logs").insert({
    document_id: document.id,
    version_id: currentVersion?.id ?? null,
    channel: input.channel,
    provider: input.provider ?? null,
    status: input.status,
    phone,
    message: input.message ?? null,
    provider_message_id: input.providerMessageId ?? null,
    actor_employee_id: employee.id,
  });
  if (error) return failure(error, "Could not record the sharing attempt.");

  if (input.channel === "whatsapp") {
    await supabase
      .from("agreement_documents")
      .update({ last_shared_at: new Date().toISOString(), status: document.status === "generated" ? "shared" : document.status })
      .eq("id", document.id);

    await logHistory(supabase, {
      documentId: document.id,
      action: "whatsapp_share_initiated",
      actorEmployeeId: employee.id,
      actorName: employee.name,
      note:
        input.status === "manual_attach_required"
          ? "WhatsApp chat opened; PDF downloaded for manual attachment"
          : `WhatsApp share ${input.status}`,
      meta: { phone, provider: input.provider ?? null, status: input.status, version: currentVersion?.version ?? null },
    });
  } else if (input.channel === "download") {
    await logHistory(supabase, {
      documentId: document.id,
      action: "pdf_downloaded",
      actorEmployeeId: employee.id,
      actorName: employee.name,
      note: `PDF v${currentVersion?.version ?? document.document_version} downloaded`,
      meta: { version: currentVersion?.version ?? null },
    });
  }

  revalidatePath(`/dashboard/agreements/${document.id}`);
  return { ok: true };
}

/** Creates (and returns) the expiring vendor link. Only the hash is stored. */
export async function createVendorAccessLink(
  id: string,
  validDays = 7
): Promise<{ ok: true; url: string; expiresAt: string } | { ok: false; error: string }> {
  const result = await loadDocument(id);
  if (!result.ok) return result;
  const { supabase, employee, document } = result.loaded;

  const { token, tokenHash } = createAccessToken();
  const expiresAt = new Date(Date.now() + Math.min(Math.max(validDays, 1), 30) * 24 * 60 * 60 * 1000);

  const { error } = await supabase.from("agreement_access_links").insert({
    document_id: document.id,
    token_hash: tokenHash,
    purpose: "view_and_upload",
    expires_at: expiresAt.toISOString(),
    created_by: employee.id,
  });
  if (error) return failure(error, "Could not create the vendor link.");

  await logHistory(supabase, {
    documentId: document.id,
    action: "vendor_link_created",
    actorEmployeeId: employee.id,
    actorName: employee.name,
    note: `Vendor link created, expires ${expiresAt.toISOString().slice(0, 10)}`,
  });

  revalidatePath(`/dashboard/agreements/${document.id}`);
  return { ok: true, url: `/agreements/${token}`, expiresAt: expiresAt.toISOString() };
}

/** Public-facing token lookup used by the vendor route + upload (no employee auth). */
export async function resolveVendorAccessToken(token: string): Promise<
  | {
      ok: true;
      document: { id: string; ref_no: string; template_slug: string; vendor_name_snapshot: string; status: string; document_version: number };
      purpose: "view" | "view_and_upload";
      linkId: string;
    }
  | { ok: false; error: string }
> {
  const trimmed = (token ?? "").trim();
  if (!/^[a-f0-9]{64}$/i.test(trimmed)) return { ok: false, error: "This link is not valid." };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("agreement_access_links")
    .select("id, document_id, purpose, expires_at, revoked_at")
    .eq("token_hash", hashAccessToken(trimmed))
    .maybeSingle();

  if (error) return failure(error, "This link could not be verified.");
  if (!data) return { ok: false, error: "This link is not valid." };
  if (data.revoked_at) return { ok: false, error: "This link has been revoked. Please contact Nyko Mart for a new link." };
  if (new Date(data.expires_at).getTime() < Date.now()) {
    return { ok: false, error: "This link has expired. Please contact Nyko Mart for a new link." };
  }

  const { data: document } = await supabase
    .from("agreement_documents")
    .select("id, ref_no, template_slug, vendor_name_snapshot, status, document_version")
    .eq("id", data.document_id)
    .maybeSingle();
  if (!document) return { ok: false, error: "Agreement not found." };

  await supabase
    .from("agreement_access_links")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id);

  return {
    ok: true,
    document,
    purpose: data.purpose,
    linkId: data.id,
  };
}

/** Latest generated PDF's storage path (used by both download routes). */
export async function getLatestAgreementPdfPath(
  documentId: string
): Promise<{ ok: true; path: string; version: number } | { ok: false; error: string }> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("agreement_document_versions")
    .select("pdf_path, version")
    .eq("document_id", documentId)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return failure(error, "Could not find a generated PDF.");
  if (!data) return { ok: false, error: "No PDF has been generated for this agreement yet." };
  return { ok: true, path: data.pdf_path, version: data.version };
}

/** Employee-side authenticated download (also records the history entry). */
export async function registerAgreementDownload(
  id: string
): Promise<{ ok: true; path: string; version: number } | { ok: false; error: string }> {
  const result = await loadDocument(id);
  if (!result.ok) return result;
  const latest = await getLatestAgreementPdfPath(id);
  if (!latest.ok) return latest;

  await result.loaded.supabase.from("agreement_sharing_logs").insert({
    document_id: id,
    channel: "download",
    provider: "authenticated_download",
    status: "sent",
    actor_employee_id: result.loaded.employee.id,
  });
  await logHistory(result.loaded.supabase, {
    documentId: id,
    action: "pdf_downloaded",
    actorEmployeeId: result.loaded.employee.id,
    actorName: result.loaded.employee.name,
    note: `PDF v${latest.version} downloaded`,
    meta: { version: latest.version },
  });
  revalidatePath(`/dashboard/agreements/${id}`);
  return latest;
}

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

export async function uploadAgreementSignature(formData: FormData): Promise<ActionResult> {
  const documentId = String(formData.get("documentId") ?? "");
  const kindRaw = String(formData.get("kind") ?? "vendor");
  const kind: "vendor" | "counter" = kindRaw === "counter" ? "counter" : "vendor";
  const signerName = String(formData.get("signerName") ?? "").trim();
  const signerDesignation = String(formData.get("signerDesignation") ?? "").trim();
  const signedOn = isoDate(String(formData.get("signedOn") ?? ""));
  const file = formData.get("file");

  if (!(file instanceof File)) return { ok: false, error: "Choose the signed PDF file to upload." };
  if (!signerName) return { ok: false, error: "Signatory name is required." };

  const result = await loadDocument(documentId);
  if (!result.ok) return result;
  const { supabase, employee, document } = result.loaded;

  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateUploadedPdf(buffer);
  if (!validation.ok) return validation;

  const path = agreementPdfPath({
    companyId: document.company_id,
    documentId: document.id,
    kind: kind === "vendor" ? "vendor-signed" : "counter-signed",
  });
  const upload = await putAgreementPdf(path, buffer);
  if (!upload.ok) return { ok: false, error: `Upload failed: ${upload.error}` };

  const { data: currentVersion } = await supabase
    .from("agreement_document_versions")
    .select("id, version")
    .eq("document_id", document.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("agreement_signature_records").insert({
    document_id: document.id,
    version_id: currentVersion?.id ?? null,
    kind,
    method: "scanned_upload",
    signer_name: signerName,
    signer_designation: signerDesignation || null,
    signed_on: signedOn,
    pdf_path: path,
    pdf_sha256: sha256Hex(buffer),
    verification: {
      uploadedByEmployeeId: employee.id,
      originalFileName: file.name,
      size: buffer.byteLength,
      note: "Scanned wet-ink signature uploaded by an authorised OMS user",
    } as unknown as Json,
    uploaded_by: employee.id,
  });
  if (error) return failure(error, "Could not record the signature.");

  await supabase
    .from("agreement_documents")
    .update({ status: kind === "vendor" ? "signed_received" : "countersigned" })
    .eq("id", document.id);

  await logHistory(supabase, {
    documentId: document.id,
    action: kind === "vendor" ? "signed_received" : "countersigned",
    actorEmployeeId: employee.id,
    actorName: employee.name,
    note:
      kind === "vendor"
        ? `Vendor signed copy received from ${signerName}${signedOn ? ` (signed ${signedOn})` : ""}`
        : `Countersigned by ${signerName}${signedOn ? ` on ${signedOn}` : ""}`,
    meta: { kind, signedOn, sha256: sha256Hex(buffer), version: currentVersion?.version ?? null },
  });

  revalidatePath(`/dashboard/agreements/${document.id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export async function activateAgreement(id: string): Promise<ActionResult> {
  const result = await loadDocument(id);
  if (!result.ok) return result;
  const { supabase, employee, document } = result.loaded;

  if (!["signed_received", "countersigned"].includes(document.status)) {
    return { ok: false, error: "Upload the vendor-signed copy and the Nyko Mart countersignature before activating." };
  }

  const { data: signatures, error: signatureError } = await supabase
    .from("agreement_signature_records")
    .select("kind")
    .eq("document_id", document.id);
  if (signatureError) return failure(signatureError, "Could not verify the signatures.");
  const hasVendor = (signatures ?? []).some((row) => row.kind === "vendor");
  const hasCounter = (signatures ?? []).some((row) => row.kind === "counter");
  if (!hasVendor || !hasCounter) {
    return { ok: false, error: "Both the vendor signature and the Nyko Mart countersignature must be recorded first." };
  }

  const { error } = await supabase
    .from("agreement_documents")
    .update({ status: "active", activated_at: new Date().toISOString() })
    .eq("id", document.id);
  if (error) return failure(error, "Could not activate the agreement.");

  await logHistory(supabase, {
    documentId: document.id,
    action: "activated",
    actorEmployeeId: employee.id,
    actorName: employee.name,
    note: "Agreement activated",
  });
  revalidatePath(`/dashboard/agreements/${document.id}`);
  revalidatePath("/dashboard/agreements");
  return { ok: true };
}

export async function terminateAgreement(id: string, reason: string): Promise<ActionResult> {
  const result = await loadDocument(id);
  if (!result.ok) return result;
  const { supabase, employee, document } = result.loaded;

  const trimmed = (reason ?? "").trim();
  if (!trimmed) return { ok: false, error: "A termination reason is required." };
  if (document.status === "terminated") return { ok: false, error: "This agreement is already terminated." };

  const { error } = await supabase
    .from("agreement_documents")
    .update({ status: "terminated", terminated_at: new Date().toISOString(), terminated_reason: trimmed.slice(0, 2000) })
    .eq("id", document.id);
  if (error) return failure(error, "Could not terminate the agreement.");

  await logHistory(supabase, {
    documentId: document.id,
    action: "terminated",
    actorEmployeeId: employee.id,
    actorName: employee.name,
    note: trimmed.slice(0, 2000),
  });
  revalidatePath(`/dashboard/agreements/${document.id}`);
  revalidatePath("/dashboard/agreements");
  return { ok: true };
}

export async function renewAgreement(
  id: string,
  values: AgreementValues
): Promise<{ ok: true; id: string; refNo: string } | { ok: false; error: string }> {
  const result = await loadDocument(id);
  if (!result.ok) return result;
  const { supabase, employee, document } = result.loaded;

  const template = findAgreementTemplate(document.template_slug);
  if (!template) return { ok: false, error: "Unknown agreement template." };

  const renewedValues = sanitizeValues(template, { ...(document.field_values ?? {}), ...values });
  const effectiveDate = isoDate(renewedValues.effective_date);
  if (!effectiveDate) return { ok: false, error: "A valid effective date is required for the renewal." };

  const templateOk = await assertTemplateActive(supabase, template);
  if (!templateOk.ok) return templateOk;

  const year = Number(effectiveDate.slice(0, 4));
  const { data: refNo, error: refError } = await supabase.rpc("next_agreement_ref", { p_year: year });
  if (refError || !refNo) return failure(refError, "Could not allocate a renewal number.");

  const { data: created, error } = await supabase
    .from("agreement_documents")
    .insert({
      ref_no: refNo as string,
      company_id: document.company_id,
      vendor_party_id: null,
      vendor_name_snapshot: document.vendor_name_snapshot,
      template_slug: document.template_slug,
      template_version: template.version,
      included_clause_slugs: document.included_clause_slugs ?? [],
      status: "draft",
      effective_date: effectiveDate,
      field_values: renewedValues as unknown as Json,
      include_witnesses: document.include_witnesses,
      renewal_of: document.id,
      created_by: employee.id,
    })
    .select("id, ref_no")
    .single();
  if (error || !created) return failure(error, "Could not create the renewal.");

  const { data: vendorRow } = await supabase
    .from("agreement_vendor_details")
    .select("*")
    .eq("document_id", document.id)
    .maybeSingle();
  if (vendorRow) {
    const { document_id: _ignored, ...copy } = vendorRow;
    void _ignored;
    await supabase.from("agreement_vendor_details").insert({ ...copy, document_id: created.id });
  }

  await supabase.from("agreement_documents").update({ status: "renewed" }).eq("id", document.id);

  await logHistory(supabase, {
    documentId: document.id,
    action: "renewed",
    actorEmployeeId: employee.id,
    actorName: employee.name,
    note: `Renewed as ${created.ref_no}`,
    meta: { renewalId: created.id, renewalRefNo: created.ref_no },
  });
  await logHistory(supabase, {
    documentId: created.id,
    action: "created",
    actorEmployeeId: employee.id,
    actorName: employee.name,
    note: `Renewal of ${document.ref_no}`,
    meta: { renewalOf: document.id },
  });

  revalidatePath("/dashboard/agreements");
  return { ok: true, id: created.id, refNo: created.ref_no };
}

// ---------------------------------------------------------------------------
// Letterhead settings + template registry
// ---------------------------------------------------------------------------

export type LetterheadSettingsInput = {
  companyId: string;
  legalName: string;
  address: string;
  email: string;
  website: string;
  phone: string;
  gstin: string;
  footerText: string;
  logoUrl: string;
  signatureUrl: string;
  brandColor: string;
  accentColor: string;
  fontFamily: string;
};

export async function saveAgreementLetterheadSettings(input: LetterheadSettingsInput): Promise<ActionResult> {
  const employee = await requireAnyCapability("hr_letters", "party_admin");
  if (!input.companyId) return { ok: false, error: "Select a company." };
  if (!employee.companyIds.includes(input.companyId)) return { ok: false, error: "You do not have access to this company." };
  if (!input.legalName.trim()) return { ok: false, error: "Company legal name is required." };
  if (!isHexColor(input.brandColor) || !isHexColor(input.accentColor)) {
    return { ok: false, error: "Brand colours must be hex values like #0f172a." };
  }
  const font = AGREEMENT_FONT_OPTIONS.find((option) => option.value === input.fontFamily)?.value ?? "Helvetica";

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("agreement_letterhead_settings").upsert({
    company_id: input.companyId,
    legal_name: input.legalName.trim(),
    address: input.address.trim() || null,
    email: input.email.trim() || null,
    website: input.website.trim() || null,
    phone: input.phone.trim() || null,
    gstin: input.gstin.trim() || null,
    footer_text: input.footerText.trim() || null,
    logo_url: input.logoUrl.trim() || null,
    signature_url: input.signatureUrl.trim() || null,
    brand_color: input.brandColor,
    accent_color: input.accentColor,
    font_family: font as AgreementFontFamily,
    updated_by: employee.id,
    updated_at: new Date().toISOString(),
  });
  if (error) return failure(error, "Could not save the letterhead settings.");

  revalidatePath("/dashboard/agreements/letterhead");
  revalidatePath("/dashboard/agreements");
  return { ok: true };
}

export async function setAgreementTemplateStatus(input: {
  slug: string;
  status: "draft" | "legal_review" | "active" | "retired";
  reviewedBy?: string;
  reviewedOn?: string;
  notes?: string;
}): Promise<ActionResult> {
  const employee = await requireAnyCapability("hr_letters", "party_admin");
  const template = findAgreementTemplate(input.slug);
  if (!template) return { ok: false, error: "Unknown agreement template." };
  if (input.status === "active") {
    if (!input.reviewedBy?.trim()) return { ok: false, error: "Record who legally reviewed this template before activating it." };
    if (!isoDate(input.reviewedOn)) return { ok: false, error: "Record the legal review date before activating this template." };
  }

  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("agreement_templates").upsert({
    slug: template.slug,
    title: template.title,
    version: template.version,
    status: input.status,
    legally_reviewed_by: input.reviewedBy?.trim() || null,
    legally_reviewed_on: isoDate(input.reviewedOn),
    activated_at: input.status === "active" ? new Date().toISOString() : null,
    retired_at: input.status === "retired" ? new Date().toISOString() : null,
    notes: input.notes?.trim() || null,
    updated_at: new Date().toISOString(),
  });
  if (error) return failure(error, "Could not update the template registry.");

  // NOTE: agreement_history rows are per DOCUMENT (document_id is NOT NULL),
  // so a registry-level change is deliberately not written there — the
  // template row itself stores who reviewed it, when, and its status.
  void employee;

  revalidatePath("/dashboard/agreements/templates");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Electronic-signature provider (method B)
// ---------------------------------------------------------------------------

/**
 * Optional provider-backed signing. Deliberately inert until credentials are
 * configured: there is no way to fake a legally verifiable e-signature, and
 * the spec explicitly says a typed name must not be treated as one. When
 * DOCUSEAL_API_URL + DOCUSEAL_API_KEY are present the current PDF is submitted
 * and the provider's signing URL is returned; the signed file is then recorded
 * through uploadAgreementSignature() with method 'esign_provider'.
 */
export async function startEsignRequest(
  id: string
): Promise<{ ok: true; signingUrl: string } | { ok: false; error: string }> {
  const result = await loadDocument(id);
  if (!result.ok) return result;
  const { employee, document } = result.loaded;

  const baseUrl = (process.env.DOCUSEAL_API_URL ?? "").trim().replace(/\/$/, "");
  const apiKey = (process.env.DOCUSEAL_API_KEY ?? "").trim();
  if (!baseUrl || !apiKey) {
    return {
      ok: false,
      error:
        "No e-signature provider is configured. Use the scanned signed-PDF upload flow, or add DOCUSEAL_API_URL and DOCUSEAL_API_KEY to enable provider-backed signing.",
    };
  }

  const latest = await getLatestAgreementPdfPath(document.id);
  if (!latest.ok) return latest;

  const pdf = await getAgreementPdf(latest.path);
  if (!pdf) return { ok: false, error: "Generated PDF could not be read from storage." };

  try {
    const form = new FormData();
    form.append("name", `${document.ref_no} — ${document.vendor_name_snapshot}`);
    form.append("documents[0][name]", `${document.ref_no}.pdf`);
    form.append("documents[0][file]", new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), `${document.ref_no}.pdf`);

    const response = await fetch(`${baseUrl}/api/templates/pdf`, {
      method: "POST",
      headers: { "X-Auth-Token": apiKey },
      body: form,
    });
    if (!response.ok) return { ok: false, error: `E-sign provider rejected the request (${response.status}).` };
    const payload = (await response.json()) as { slug?: string };
    if (!payload.slug) return { ok: false, error: "E-sign provider did not return a signing link." };

    const signingUrl = `${baseUrl}/d/${payload.slug}`;
    const supabase = createServiceRoleClient();
    await logHistory(supabase, {
      documentId: document.id,
      action: "updated",
      actorEmployeeId: employee.id,
      actorName: employee.name,
      note: "E-signature request created with the configured provider",
      meta: { provider: "docuseal", signingUrl, refNo: document.ref_no } as unknown as Json,
    });
    return { ok: true, signingUrl };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "E-sign request failed." };
  }
}
