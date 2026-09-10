// FedEx Ship API v1 — real shipment creation, built from FedEx's publicly
// documented Ship API (developer.fedex.com/api/en-us/catalog/ship.html),
// same OAuth2 client_credentials app as the existing Track API polling
// (see fedex-auth.ts's header comment on why the same env vars are
// reused). UNCONFIRMED against a real FedEx account — no sample
// request/response was provided for this round, unlike Shipglobal (whose
// client was built from the user's own pasted docs) or Aramex (whose
// tracking client was built from an uploaded WSDL kit). This mirrors the
// publicly documented request/response shape as closely as possible but
// has NOT been verified against FedEx's sandbox or production — see the
// project delivery notes for exactly what needs a real credentialed test
// before this is trusted with a real booking.
//
// DDP vs DDU: FedEx's own field for this is
// requestedShipment.customsClearanceDetail.dutiesPayment.paymentType,
// which takes 'SENDER' (importer of record pays = DDP-equivalent) or
// 'RECIPIENT' (buyer pays = DDU-equivalent) — NOT literally "DDP"/"DDU"
// strings. This client accepts the app's own 'DDP'/'DDU' enum (matching
// the other 4 new couriers, for one consistent UI) and translates it to
// FedEx's paymentType at the API-call boundary, so the mapping lives in
// exactly one place if it ever needs correcting against a real account.
//
// BOOKED AMOUNT: FedEx's Ship API response includes
// completedShipmentDetail.shipmentRating.shipmentRateDetails[] with a
// totalNetCharge per rate type (ACCOUNT/LIST/etc) WHEN the requester has
// rating enabled on their account — this is the one courier of the 5 new
// ones most likely to return a real quoted price at booking time (Delhivery
// typically does not — see delhivery-ship.ts). Falls back to a null
// amount (caller falls back to a rate-card estimate) if the response has
// no rating block, rather than guessing at a value.

import { getFedexAccessToken, FEDEX_API_BASE } from "@/lib/couriers/fedex-auth";

export type FedexDdpDdu = "DDP" | "DDU";

export type FedexShipInput = {
  serviceType: string; // e.g. "INTERNATIONAL_PRIORITY", "FEDEX_GROUND" — FedEx's own service-type codes, kept as free text like Shipglobal's service selector rather than a hardcoded list, since FedEx has dozens and adds more over time
  packagingType: string; // e.g. "YOUR_PACKAGING"
  ddpDdu: FedexDdpDdu | null; // null for a domestic (US-only) shipment where FedEx's customsClearanceDetail block doesn't apply at all
  shipper: {
    accountNumber: string; // the FedEx account number shipping charges post to
    contactName: string;
    companyName: string;
    phone: string;
    address1: string;
    address2?: string | null;
    city: string;
    state?: string | null;
    postalCode: string;
    countryCode: string;
  };
  recipient: {
    contactName: string;
    companyName?: string | null;
    phone: string;
    address1: string;
    address2?: string | null;
    city: string;
    state?: string | null;
    postalCode: string;
    countryCode: string;
  };
  packageWeightKg: number;
  packageDimsCm: { length: number; width: number; height: number };
  currencyCode: string;
  customsValue?: number | null; // required by FedEx when countryCode differs from shipper's (international) — declared customs value
  commodityDescription?: string | null;
  referenceNo: string; // FedEx's customerReferences — this app's own order ref_no, for FedEx-side lookup/display only
};

export type FedexShipResult = {
  success: boolean;
  trackingNo: string | null;
  // Always a self-contained data:application/pdf;base64,... URI (or null)
  // by the time this leaves createFedexShipment — see resolveLabelAsDataUri
  // below for why this is fetched server-side rather than handed back as
  // FedEx's own raw document URL.
  labelUrl: string | null;
  bookedAmt: number | null;
  bookedCurrency: string | null;
  raw: unknown;
};

function fedexDutiesPaymentType(ddpDdu: FedexDdpDdu): "SENDER" | "RECIPIENT" {
  // See header comment — FedEx has no literal "DDP"/"DDU" enum value.
  return ddpDdu === "DDP" ? "SENDER" : "RECIPIENT";
}

// 2026-09-08: added after a real 503 — "The service is currently
// unavailable and we are working to resolve the issue... Please check back
// at a later time." — surfaced during testing. That exact text is FedEx's
// own documented generic gateway/maintenance response (FedEx's Developer
// Portal Best Practices guide has this as boilerplate), not something a
// request's content can trigger — malformed-request errors from FedEx come
// back as 400s with field-level detail instead (the state/postal-mismatch
// and other errors already handled above are examples of that). It's a
// well-known, chronic pain point specifically on FedEx's sandbox/test host
// — independent reports describe it as "intermittently unavailable" with
// no predictable duration, distinct from FedEx's production reliability.
// Ruled out before treating this as pure FedEx flakiness: the OAuth token
// is fetched fresh on every single call (see getFedexAccessToken — no
// caching, so it can't be a stale/expired token), and FEDEX_API_BASE is
// one fixed, unchanged env var, so a wrong host isn't silently varying
// between calls either. That leaves genuine transient FedEx-side
// unavailability as the remaining explanation, which is exactly the kind
// of failure a short backoff-and-retry is meant for — retries ONLY on
// 502/503/504 (gateway-level failures); a 400 (bad request), 401 (bad
// auth) etc. fails immediately as before, since retrying those would just
// get the same rejection every time.
const RETRYABLE_GATEWAY_STATUSES = new Set([502, 503, 504]);
const RETRY_DELAYS_MS = [1500, 3500]; // 2 retries: ~1.5s, then ~3.5s after that

async function fetchWithRetryOnGatewayError(url: string, options: RequestInit): Promise<{ res: Response; text: string }> {
  let attemptRes: Response;
  let attemptText: string;
  for (let attempt = 0; ; attempt++) {
    attemptRes = await fetch(url, options);
    attemptText = await attemptRes.text();
    const isLastAttempt = attempt >= RETRY_DELAYS_MS.length;
    if (attemptRes.ok || !RETRYABLE_GATEWAY_STATUSES.has(attemptRes.status) || isLastAttempt) {
      return { res: attemptRes, text: attemptText };
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
  }
}

// 2026-09-10 — real reported bug: clicking a booked FedEx label opened a
// raw, unstyled FedEx XML error page — "LOGIN.REAUTHENTICATE.ERROR / Your
// session is expired. Please enter your user ID and password to log in
// again." Root cause: `labelResponseOptions: "URL_ONLY"` below (see that
// setting's own comment) makes FedEx return a FEDEX-HOSTED DOCUMENT URL,
// not a public link — every place in this app that shows a "label" link
// (generate-label-button.tsx, create-shipment-form.tsx, the shipment
// detail page, shipments-tracking.tsx) just put that URL straight into a
// plain `<a href>`, which sends the EMPLOYEE'S OWN BROWSER there with no
// credentials attached at all. FedEx's document host then (reasonably)
// refuses an unauthenticated request and serves back exactly this raw
// "please log in" XML — there's no FedEx account for the employee to log
// into; the app itself holds the OAuth credentials, not the browser.
//
// Fix: fetch the label SERVER-SIDE, with the SAME OAuth bearer token this
// module already uses for the Ship API call itself (FedEx's document
// retrieval sits behind the same client_credentials app/token — no
// separate login exists), and convert it to a self-contained
// data:application/pdf;base64,... URI before this ever reaches the
// browser — exactly the same shape every other courier's label already
// takes in this app (UPS/DHL build a data: URI directly from inline
// base64; this makes FedEx consistent even though FedEx's own API hands
// back a URL instead of inline bytes). The browser never talks to FedEx's
// document host directly anymore, so there's nothing left to "log in" to.
// Falls back to `null` (not the raw URL — a dead link that errors when
// clicked is worse than the app's own existing "no label captured yet"
// message) if the authenticated fetch itself fails for any reason; the
// booking/tracking number are entirely unaffected either way, since the
// label is fetched only AFTER FedEx has already confirmed the shipment.
async function resolveLabelAsDataUri(
  labelDoc: { url?: string; encodedLabel?: string; contentType?: string } | undefined,
  accessToken: string
): Promise<string | null> {
  if (!labelDoc) return null;
  if (labelDoc.encodedLabel) return `data:application/pdf;base64,${labelDoc.encodedLabel}`;
  if (!labelDoc.url) return null;

  try {
    const res = await fetch(labelDoc.url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) {
      console.error(`FedEx label fetch failed (${res.status}) for ${labelDoc.url}`);
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return `data:application/pdf;base64,${buffer.toString("base64")}`;
  } catch (err) {
    console.error("FedEx label fetch threw:", err);
    return null;
  }
}

export async function createFedexShipment(
  input: FedexShipInput,
  credentials?: { client_id?: string; client_secret?: string }
): Promise<FedexShipResult> {
  const accessToken = await getFedexAccessToken({ clientId: credentials?.client_id, clientSecret: credentials?.client_secret });

  const isInternational = input.shipper.countryCode !== input.recipient.countryCode;

  const requestedShipment: Record<string, unknown> = {
    shipper: {
      contact: { personName: input.shipper.contactName, companyName: input.shipper.companyName, phoneNumber: input.shipper.phone },
      address: {
        streetLines: [input.shipper.address1, input.shipper.address2 ?? ""].filter(Boolean),
        city: input.shipper.city,
        stateOrProvinceCode: input.shipper.state ?? "",
        postalCode: input.shipper.postalCode,
        countryCode: input.shipper.countryCode,
      },
    },
    recipients: [
      {
        contact: {
          personName: input.recipient.contactName,
          companyName: input.recipient.companyName ?? "",
          phoneNumber: input.recipient.phone,
        },
        address: {
          streetLines: [input.recipient.address1, input.recipient.address2 ?? ""].filter(Boolean),
          city: input.recipient.city,
          stateOrProvinceCode: input.recipient.state ?? "",
          postalCode: input.recipient.postalCode,
          countryCode: input.recipient.countryCode,
        },
      },
    ],
    shipDatestamp: new Date().toISOString().slice(0, 10),
    serviceType: input.serviceType,
    packagingType: input.packagingType,
    pickupType: "USE_SCHEDULED_PICKUP",
    shippingChargesPayment: { paymentType: "SENDER", payor: { responsibleParty: { accountNumber: { value: input.shipper.accountNumber } } } },
    labelSpecification: { labelFormatType: "COMMON2D", imageType: "PDF" },
    requestedPackageLineItems: [
      {
        weight: { units: "KG", value: input.packageWeightKg },
        dimensions: { length: input.packageDimsCm.length, width: input.packageDimsCm.width, height: input.packageDimsCm.height, units: "CM" },
        customerReferences: [{ customerReferenceType: "CUSTOMER_REFERENCE", value: input.referenceNo }],
      },
    ],
  };

  if (isInternational) {
    requestedShipment.customsClearanceDetail = {
      dutiesPayment: { paymentType: fedexDutiesPaymentType(input.ddpDdu ?? "DDU") },
      commodities: [
        {
          description: input.commodityDescription || "General merchandise",
          countryOfManufacture: input.shipper.countryCode,
          quantity: 1,
          quantityUnits: "PCS",
          // Required by FedEx on every commodity line once
          // customsClearanceDetail is present — without it FedEx rejects
          // the whole shipment with "Insufficient information for
          // commodity 1 ... Commodity weight is missing or invalid.", even
          // though the package-level weight above (requestedPackageLineItems)
          // is already set. One commodity line = the whole package here (no
          // multi-line commodity breakdown in this app), so it carries the
          // full package weight.
          weight: { units: "KG", value: input.packageWeightKg },
          unitPrice: { amount: input.customsValue ?? 0, currency: input.currencyCode },
          customsValue: { amount: input.customsValue ?? 0, currency: input.currencyCode },
        },
      ],
    };
  }

  const body = {
    // 2026-09-08: kept as "URL_ONLY" — confirmed correct against a real
    // FedEx sandbox response the user captured and pasted back (see
    // fedex-ship-real-response-2026-09-08.json in the delivery notes): with
    // this option FedEx really does return a fetchable label URL. That
    // round only confirmed the URL comes back at all (the field-path bug
    // fixed then); it did not confirm the URL is directly openable by a
    // browser with no credentials attached — 2026-09-10 found it isn't
    // (see resolveLabelAsDataUri above, and its call site below) — so this
    // setting is still correct, the app just now fetches that URL itself
    // with the right credentials instead of handing it to the browser raw.
    labelResponseOptions: "URL_ONLY",
    requestedShipment,
    accountNumber: { value: input.shipper.accountNumber },
  };

  const { res, text } = await fetchWithRetryOnGatewayError(`${FEDEX_API_BASE}/ship/v1/shipments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-locale": "en_US",
    },
    body: JSON.stringify(body),
  });
  // Both fields below were fixed 2026-09-08 against a REAL FedEx sandbox
  // response the user captured and pasted back — not FedEx's public docs
  // (which this project's rules treat as unreliable on their own; see the
  // header comment on FEDEX_API_BASE for why). The real response shape
  // differs from what was originally guessed in two ways:
  //
  // 1. LABEL: the label document does NOT live at
  //    completedShipmentDetail.shipmentDocuments[] — that field is simply
  //    absent from a real response. It's one level down, per package, at
  //    transactionShipments[].pieceResponses[].packageDocuments[], each
  //    entry shaped { url, docType, contentType }. This — not the
  //    labelResponseOptions setting above — was the actual reason no label
  //    ever came back: the code was reading a field that doesn't exist.
  //    contentType "LABEL" picks out the shipping label specifically,
  //    since an international shipment's packageDocuments can also carry
  //    other document types (e.g. a commercial invoice) in the same array.
  //
  // 2. RATE: shipmentRateDetails[].totalNetCharge is a plain number
  //    (e.g. 157.56), not a { amount, currency } object — currency is a
  //    sibling field on the same rate-detail entry. Reading
  //    totalNetCharge.amount/.currency (the original code) silently
  //    returned undefined for both on every real response, so bookedAmt
  //    and bookedCurrency were always null even when FedEx quoted a real
  //    rate.
  let parsed: {
    output?: {
      transactionShipments?: Array<{
        pieceResponses?: Array<{
          packageDocuments?: Array<{ url?: string; encodedLabel?: string; docType?: string; contentType?: string }>;
        }>;
        completedShipmentDetail?: {
          masterTrackingId?: { trackingNumber?: string };
          shipmentRating?: { shipmentRateDetails?: Array<{ totalNetCharge?: number; currency?: string }> };
        };
      }>;
    };
    errors?: Array<{ message?: string; code?: string }>;
  };
  // A 502/503/504 already went through fetchWithRetryOnGatewayError's
  // retries above by the time we get here — note that in the thrown
  // message so it's clear this isn't a first-try failure.
  const retriedNote = RETRYABLE_GATEWAY_STATUSES.has(res.status) ? " (already retried automatically — this is FedEx's own service, not this app, still not responding)" : "";
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`FedEx Ship API returned non-JSON response (${res.status}${retriedNote}): ${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    const msg = parsed.errors?.map((e) => e.message).filter(Boolean).join("; ") || text.slice(0, 500);
    throw new Error(`FedEx Ship API failed ${res.status}${retriedNote}: ${msg}`);
  }

  const shipment = parsed.output?.transactionShipments?.[0];
  const detail = shipment?.completedShipmentDetail;
  const trackingNo = detail?.masterTrackingId?.trackingNumber ?? null;
  const rateDetail = detail?.shipmentRating?.shipmentRateDetails?.[0];

  // One packageDocuments[] array per package (pieceResponses[]) — a
  // single-package shipment (the only case this app books today) has
  // exactly one. Flatten defensively so a future multi-package booking
  // doesn't silently drop documents from package 2+, then prefer the entry
  // FedEx marks contentType "LABEL" over just taking documents[0], since
  // international shipments can carry more than one document type here.
  const packageDocuments = shipment?.pieceResponses?.flatMap((p) => p.packageDocuments ?? []) ?? [];
  const labelDoc = packageDocuments.find((d) => d.contentType === "LABEL") ?? packageDocuments[0];
  const labelUrl = await resolveLabelAsDataUri(labelDoc, accessToken);

  return {
    success: !!trackingNo,
    trackingNo,
    labelUrl,
    bookedAmt: rateDetail?.totalNetCharge ?? null,
    bookedCurrency: rateDetail?.currency ?? null,
    raw: parsed,
  };
}
