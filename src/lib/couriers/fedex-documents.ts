// 2026-09-12 — FedEx Trade Documents Upload API (POST /documents/v1/etds/
// upload), built directly from the OpenAPI spec + docs the user uploaded
// this round (upload-documents.json). This is the second half of "I will
// upload my own invoice" — fedex-invoice-pdf.tsx builds the PDF file
// itself; this file sends it to FedEx and links it to a real shipment.
//
// POST-SHIPMENT flow chosen (not pre-shipment): per the docs, pre-shipment
// upload happens BEFORE createFedexShipment and needs the resulting docId
// threaded into that same request's shipmentSpecialServices.etdDetail.
// attachedDocuments — post-shipment upload happens AFTER a normal
// createFedexShipment call succeeds, using the real trackingNumber +
// shipmentDate it returns. This app already generates its CSB-V invoice
// AFTER booking (once a real AWB exists) for the exact same reason —
// post-shipment is the one that fits without inventing a new
// reserve-before-booking mechanism (see courier-booking/actions.ts's
// resolveFedexLabelReferences for what that already looks like for the
// Invoice No./Master Invoice No. fields, and why it was needed there but
// isn't needed here).
//
// 2026-09-12 (correction #4) — the two things flagged below as unconfirmed
// have now both been resolved, per an updated/cleaner copy of FedEx's own
// Trade Documents Upload API docs the user's FedEx developer team supplied
// directly (they've separately confirmed self-upload, i.e. this whole
// file, is the correct path forward for this account):
//
// 1. Host — CONFIRMED this dedicated Document Upload API endpoint does NOT
//    share a host with the Ship/Rate API (FEDEX_API_BASE, apis.fedex.com).
//    The docs' own "EDU Production Server" / "EDU Sandbox Server" entries
//    name a separate host: https://documentapi.prod.fedex.com (production)
//    and https://documentapitest.prod.fedex.com/sandbox (sandbox). See
//    FEDEX_DOCUMENT_API_BASE below.
// 2. Response shape — CONFIRMED via the docs' own sample success response:
//    { output: { meta: { documentType, docId, folderId } },
//    customerTransactionId }. docId lives at output.meta.docId, not
//    output.documentId — fixed below.
//
// The Ship API side of this (does createFedexShipment need an extra field
// to "expect" a post-shipment upload) is ALSO now confirmed — see
// fedex-ship.ts's shipmentSpecialServices.etdDetail.attributes:
// ["POST_SHIPMENT_UPLOAD_REQUESTED"], added in the same round as this file.

import { getFedexAccessToken } from "@/lib/couriers/fedex-auth";

// 2026-09-12 — dedicated host for the Trade Documents Upload API, separate
// from FEDEX_API_BASE (fedex-auth.ts, apis.fedex.com — still used
// internally by getFedexAccessToken above for the shared OAuth endpoint,
// since token issuance is NOT per-product and stays on apis.fedex.com
// regardless of which product API the token is then used against).
// Env-overridable the same way FEDEX_API_BASE is, for a sandbox switch
// without a code change.
export const FEDEX_DOCUMENT_API_BASE = process.env.FEDEX_DOCUMENT_API_BASE_URL || "https://documentapi.prod.fedex.com";

export type FedexUploadInvoiceInput = {
  trackingNumber: string;
  shipmentDate: string; // YYYY-MM-DD
  originCountryCode: string;
  destinationCountryCode: string;
  // 2026-09-12 — optional but "highly recommended" by FedEx's own docs to
  // avoid customs delays ("your shipment could face customs delays and
  // could be hold until CI/Documents are provided via alternative method
  // upon request"). Best-effort — courier-booking/actions.ts passes
  // whatever fedex-ship.ts's createFedexShipment managed to extract from
  // the real Create Shipment response, which may be null; omitted from the
  // upload request entirely when null rather than sent as "".
  originLocationCode?: string | null;
  destinationLocationCode?: string | null;
  pdfBuffer: Buffer;
  fileName: string;
};

export type FedexUploadInvoiceResult = { ok: true; docId: string | null; raw: unknown } | { ok: false; error: string };

export async function uploadFedexPostShipmentInvoice(
  input: FedexUploadInvoiceInput,
  credentials?: { client_id?: string; client_secret?: string }
): Promise<FedexUploadInvoiceResult> {
  let accessToken: string;
  try {
    accessToken = await getFedexAccessToken({ clientId: credentials?.client_id, clientSecret: credentials?.client_secret });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not get a FedEx access token." };
  }

  // 2026-09-12 — exact shape confirmed from the OpenAPI spec's own
  // ETDPostshipment example payload (upload-documents.json): workflowName,
  // carrierCode, name, contentType, and a meta block with shipDocumentType/
  // trackingNumber/shipmentDate/origin+destinationCountryCode. formCode
  // ("USMCA" in FedEx's own example) is US/Canada/Mexico-trade-specific —
  // omitted here since this business ships from India, not part of that
  // trade agreement.
  const documentMeta = {
    workflowName: "ETDPostshipment",
    carrierCode: "FDXE",
    name: input.fileName,
    contentType: "application/pdf",
    meta: {
      shipDocumentType: "COMMERCIAL_INVOICE",
      trackingNumber: input.trackingNumber,
      shipmentDate: `${input.shipmentDate}T00:00:00`,
      originCountryCode: input.originCountryCode,
      destinationCountryCode: input.destinationCountryCode,
      // 2026-09-12 — "strongly recommended" per FedEx's docs (see
      // FedexUploadInvoiceInput's comment above); never sent as "" when
      // unavailable, matching this file's existing never-send-empty
      // pattern for optional fields.
      ...(input.originLocationCode ? { originLocationCode: input.originLocationCode } : {}),
      ...(input.destinationLocationCode ? { destinationLocationCode: input.destinationLocationCode } : {}),
    },
  };

  const form = new FormData();
  form.append("document", JSON.stringify(documentMeta));
  // 2026-09-12 — Buffer's underlying ArrayBufferLike type isn't directly
  // assignable to BlobPart (TS2322: SharedArrayBuffer is missing some
  // ArrayBuffer-only members) — copying into a plain Uint8Array first
  // sidesteps that without changing the actual bytes sent.
  form.append("attachment", new Blob([new Uint8Array(input.pdfBuffer)], { type: "application/pdf" }), input.fileName);

  let res: Response;
  let text: string;
  try {
    res = await fetch(`${FEDEX_DOCUMENT_API_BASE}/documents/v1/etds/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "X-locale": "en_US" },
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    text = await res.text();
  } catch (err) {
    return { ok: false, error: `FedEx Document Upload API request failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  // 2026-09-12 (correction #4) — shape confirmed via the docs' own sample
  // success response: { output: { meta: { documentType, docId, folderId } },
  // customerTransactionId }. docId lives at output.meta.docId.
  let parsed: { output?: { meta?: { docId?: string } }; errors?: Array<{ message?: string }> } | null = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON body (e.g. a plain-text gateway error) — fall through, the
    // raw text still gets surfaced in the error message below.
  }

  if (!res.ok) {
    const msg = parsed?.errors?.map((e) => e.message).filter(Boolean).join("; ") || text || `HTTP ${res.status}`;
    return { ok: false, error: `FedEx Document Upload API failed ${res.status}: ${msg}` };
  }

  const docId = parsed?.output?.meta?.docId ?? null;
  return { ok: true, docId, raw: parsed ?? text };
}
