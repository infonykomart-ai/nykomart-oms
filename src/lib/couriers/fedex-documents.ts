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
// ⚠️ Two things below are NOT confirmed against a real account — flagged
// honestly rather than guessed at silently, same as every other genuinely
// unconfirmed piece of FedEx wiring in this codebase:
//
// 1. Host: the OpenAPI spec's TOP-LEVEL `servers` block lists
//    https://apis-sandbox.fedex.com / https://apis.fedex.com — the exact
//    same hosts FEDEX_API_BASE (fedex-auth.ts) already uses successfully
//    for the Ship and Rate APIs — so that's what this reuses. But a
//    PER-OPERATION `servers` override further down in that same spec lists
//    DIFFERENT hosts (documentapitest.prod.fedex.com/sandbox and
//    documentapi.prod.fedex.com) specifically for this upload endpoint,
//    and it's not clear from the spec alone which one actually governs a
//    real call. If this 404s or gets routed wrong, that's the first thing
//    to check.
// 2. Whether createFedexShipment's request needs ANY extra field to
//    "expect" a post-shipment upload — this file's read of the Upload API
//    spec found nothing about it (it's a different API, with its own
//    separate spec this app doesn't have), so fedex-ship.ts currently
//    sends nothing extra for the UPLOAD_OWN case beyond the already-
//    confirmed ELECTRONIC_TRADE_DOCUMENTS special service. If FedEx
//    silently ignores the uploaded document (label still comes back as 4
//    pages) rather than erroring, that's the most likely reason.
//
// Both are exactly the shape of thing this project's real-live-test
// feedback loop has already caught and fixed twice today (the missing
// COMMERCIAL_OR_PRO_FORMA_INVOICE special service, then its wrong level) —
// expect a similar correction round here too.

import { getFedexAccessToken, FEDEX_API_BASE } from "@/lib/couriers/fedex-auth";

export type FedexUploadInvoiceInput = {
  trackingNumber: string;
  shipmentDate: string; // YYYY-MM-DD
  originCountryCode: string;
  destinationCountryCode: string;
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
    res = await fetch(`${FEDEX_API_BASE}/documents/v1/etds/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "X-locale": "en_US" },
      body: form,
      signal: AbortSignal.timeout(30000),
    });
    text = await res.text();
  } catch (err) {
    return { ok: false, error: `FedEx Document Upload API request failed: ${err instanceof Error ? err.message : String(err)}` };
  }

  let parsed: { output?: { documentId?: string; document?: { documentId?: string } }; errors?: Array<{ message?: string }> } | null = null;
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

  const docId = parsed?.output?.documentId ?? parsed?.output?.document?.documentId ?? null;
  return { ok: true, docId, raw: parsed ?? text };
}
