"use server";

// 2026-11-03 — VENDOR-side upload of the signed agreement.
//
// Public by design (vendors are not OMS users) and therefore deliberately
// narrow: the ONLY thing this action accepts is a PDF plus the opaque token
// from the link. The token is re-verified on every call (existence, expiry,
// revocation), the upload is size/type validated, and only the document that
// token points at is ever touched. A vendor can never read another vendor's
// agreement, and never sees the OMS itself.
import { createServiceRoleClient } from "@/lib/supabase/server";
import { resolveVendorAccessToken } from "@/app/dashboard/agreements/actions";
import { agreementPdfPath, putAgreementPdf, sha256Hex, validateUploadedPdf } from "@/lib/agreements/storage";

export type VendorUploadResult = { ok: true; message: string } | { ok: false; error: string };

export async function uploadVendorSignedCopy(formData: FormData): Promise<VendorUploadResult> {
  const token = String(formData.get("token") ?? "");
  const signerName = String(formData.get("signerName") ?? "").trim();
  const signerDesignation = String(formData.get("signerDesignation") ?? "").trim();
  const signedOnRaw = String(formData.get("signedOn") ?? "").trim();
  const file = formData.get("file");

  const resolved = await resolveVendorAccessToken(token);
  if (!resolved.ok) return resolved;
  if (resolved.purpose !== "view_and_upload") return { ok: false, error: "This link is view-only." };
  if (!(file instanceof File)) return { ok: false, error: "Choose the signed PDF file to upload." };
  if (!signerName) return { ok: false, error: "Please enter the name of the person who signed." };

  const signedOn = /^\d{4}-\d{2}-\d{2}$/.test(signedOnRaw) ? signedOnRaw : null;
  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateUploadedPdf(buffer);
  if (!validation.ok) return validation;

  const supabase = createServiceRoleClient();

  const { data: document } = await supabase
    .from("agreement_documents")
    .select("id, company_id, status")
    .eq("id", resolved.document.id)
    .maybeSingle();
  if (!document) return { ok: false, error: "Agreement not found." };
  if (["active", "terminated", "renewed"].includes(document.status)) {
    return { ok: false, error: "This agreement has already been closed. Please contact Nyko Mart." };
  }

  const path = agreementPdfPath({
    companyId: document.company_id,
    documentId: document.id,
    kind: "vendor-signed",
  });
  const upload = await putAgreementPdf(path, buffer);
  if (!upload.ok) return { ok: false, error: "The upload could not be stored. Please try again." };

  const { data: currentVersion } = await supabase
    .from("agreement_document_versions")
    .select("id")
    .eq("document_id", document.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const sha256 = sha256Hex(buffer);
  const { error: signatureError } = await supabase.from("agreement_signature_records").insert({
    document_id: document.id,
    version_id: currentVersion?.id ?? null,
    kind: "vendor",
    method: "scanned_upload",
    signer_name: signerName,
    signer_designation: signerDesignation || null,
    signed_on: signedOn,
    pdf_path: path,
    pdf_sha256: sha256,
    verification: {
      uploadedVia: "vendor_secure_link",
      originalFileName: file.name,
      size: buffer.byteLength,
      note: "Uploaded by the vendor through the expiring token link; not provider-verified",
    },
    uploaded_by: null,
  });
  if (signatureError) return { ok: false, error: "The signed copy could not be recorded. Please contact Nyko Mart." };

  await supabase.from("agreement_documents").update({ status: "signed_received" }).eq("id", document.id);
  await supabase.from("agreement_history").insert({
    document_id: document.id,
    action: "signed_received",
    actor_employee_id: null,
    actor_name: "Vendor (secure link)",
    note: `Signed copy uploaded by ${signerName}${signedOn ? ` (signed ${signedOn})` : ""}`,
    meta: { sha256, via: "vendor_secure_link" },
  });

  return { ok: true, message: "Thank you — your signed copy has been received by Nyko Mart." };
}
