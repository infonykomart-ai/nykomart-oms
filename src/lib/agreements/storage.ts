// 2026-11-03 — private storage for agreement PDFs.
//
// The bucket is created private (`public = false`, see
// db/2026-11-03-vendor-agreements.sql). Nothing here ever calls
// getPublicUrl(): a generated agreement contains vendor names, addresses,
// GSTINs, commercial terms and signatures, so every byte is served either
// through an authenticated server action / route handler, or through the
// expiring vendor token route — never through a public object URL.
import { createHash, randomBytes } from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const AGREEMENT_BUCKET = "agreement-documents";

export function sha256Hex(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** 32 random bytes, hex — the vendor access token. Only its hash is stored. */
export function createAccessToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: sha256Hex(Buffer.from(token, "utf8")) };
}

export function hashAccessToken(token: string): string {
  return sha256Hex(Buffer.from(token, "utf8"));
}

export function agreementPdfPath(args: {
  companyId: string;
  documentId: string;
  kind: "generated" | "vendor-signed" | "counter-signed";
  version?: number;
}): string {
  const { companyId, documentId, kind } = args;
  const stamp = Date.now();
  if (kind === "generated") return `${companyId}/${documentId}/generated/v${args.version ?? 1}-${stamp}.pdf`;
  return `${companyId}/${documentId}/${kind}/${stamp}.pdf`;
}

export async function putAgreementPdf(path: string, buffer: Buffer): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.storage.from(AGREEMENT_BUCKET).upload(path, buffer, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function getAgreementPdf(path: string): Promise<Buffer | null> {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase.storage.from(AGREEMENT_BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** A scanned upload is only accepted when it really is a PDF, within limits. */
export function validateUploadedPdf(buffer: Buffer): { ok: true } | { ok: false; error: string } {
  const MAX_BYTES = 20 * 1024 * 1024;
  if (buffer.byteLength === 0) return { ok: false, error: "The uploaded file is empty." };
  if (buffer.byteLength > MAX_BYTES) return { ok: false, error: "The uploaded PDF is larger than 20 MB." };
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return { ok: false, error: "Only PDF files are accepted (the uploaded file is not a valid PDF)." };
  }
  return { ok: true };
}
