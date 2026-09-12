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
    // 2026-09-10: both new, optional — FedEx's real Ship Manager booking
    // page shows a separate "Ext." field alongside the recipient phone
    // number, and a Tax ID (VAT/EORI/IOSS) field for destinations that need
    // one. Wired to FedEx's documented contact.phoneExtension and
    // contact.tins[].number fields below. UNCONFIRMED against a real FedEx
    // account, same as the rest of this file (see header comment) — built
    // from FedEx's public docs only, no sample request/response for these
    // two fields specifically.
    phoneExtension?: string | null;
    taxId?: string | null;
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
  // 2026-09-12 — "Shipment Purpose" dropdown the user showed from FedEx's
  // own Ship Manager website (a required step there, right before Customs
  // documentation) — this app's form never had an equivalent field or sent
  // one to FedEx at all. Wired to FedEx's documented
  // customsClearanceDetail.commercialInvoice.shipmentPurpose enum. UNLIKE
  // the customerReferences mapping above (confirmed against 2 real
  // labels), this specific enum mapping is NOT yet confirmed against a
  // real FedEx account/booking — built from FedEx's public Web
  // Services/REST documentation only, same "plausible, not verified"
  // status as most of the rest of this file (see the header comment).
  // Only sent when international (inside the customsClearanceDetail block
  // below) and only when non-null — omitted otherwise, same
  // never-send-empty pattern used throughout this file.
  shipmentPurpose?: "SOLD" | "NOT_SOLD" | "GIFT" | "SAMPLE" | "PERSONAL_EFFECTS" | "REPAIR_AND_RETURN" | null;
  // 2026-09-12 — Electronic Trade Documents (ETD). From the real FedEx
  // Ship Manager website flow the user showed: after Shipment Purpose
  // comes "Customs documentation" with a "How would you like to complete
  // your commercial invoice?" choice, with 3 real options — "I will
  // upload my own invoice" / "I want FedEx to help me create a commercial
  // invoice" / "I want FedEx to help me create a proforma invoice".
  //
  // First round (same day) built ONLY the middle option (FedEx builds +
  // electronically transmits the commercial invoice from the
  // customs/commodity data already in this request — no paper invoice
  // needed, which is what cuts the label+paperwork from 4 pages to 2).
  // This follow-up round adds the third option (proforma) too — same
  // mechanism, different FedEx document type, no new infrastructure
  // needed. The FIRST option ("I will upload my own invoice") is
  // deliberately still NOT built: it needs a second, separate FedEx API
  // call (Upload Documents) plus generating an actual FedEx-formatted
  // invoice PDF file BEFORE booking — this app has no PDF-file-generation
  // capability today (its existing invoice "view" is an HTML page users
  // print from their own browser, not a server-generated PDF), so that
  // option is real, separate, bigger work — flagged back to the user
  // rather than guessed at.
  //
  // FedEx's documented mechanism for "let FedEx create it electronically"
  // is requestedShipment.shipmentSpecialServices.specialServiceTypes
  // including "ELECTRONIC_TRADE_DOCUMENTS", plus
  // shipmentSpecialServices.etdDetail.requestedDocumentTypes naming which
  // document FedEx should build — "COMMERCIAL_INVOICE" or
  // "PROFORMA_INVOICE" — built from FedEx's public Web Services/REST
  // documentation only, NOT yet confirmed against a real account/booking
  // (same status as shipmentPurpose above). null means neither (the old,
  // pre-ETD paper-invoice behavior) — the booking form defaults to
  // "COMMERCIAL_INVOICE" (matching the real FedEx page's own default,
  // pre-checked "recommended" option) but this is a plain dropdown that
  // can be switched to null per-shipment as a safety valve if a real
  // booking ever rejects it, with zero code change needed to fall back.
  electronicInvoiceType?: "COMMERCIAL_INVOICE" | "PROFORMA_INVOICE" | null;
  // The customs classification / Harmonized Tariff Number for the goods
  // (e.g. "5705.00.20.30" — see CourierBookingLookupOrder.harmonizedTariffNumber
  // in courier-booking/actions.ts for where this comes from: the order's
  // Item Category, same one goodsDescription/commodityDescription above
  // already uses). FedEx's own Rate API documentation shows a real
  // customerMessage warning ("the harmonized code... is missing or
  // invalid; estimated duties and taxes were not returned") for a
  // commodity with none set — suggesting a missing code degrades the
  // result rather than hard-failing the request, so this is sent
  // best-effort (omitted when null) rather than made a required field
  // that could block a booking for an Item Category with no code on file
  // in Admin yet.
  harmonizedTariffNumber?: string | null;
  // 2026-09-11 — built from a REAL FedEx test label the user uploaded
  // (SHIP DATE 10SEP26, a Combine & Book "1/2" test shipment). That label
  // showed FOUR separate printed reference lines: REF:, PO:, INV:, DEPT:.
  // FedEx's documented customerReferences array takes one entry per type;
  // this maps customerRef -> CUSTOMER_REFERENCE (REF:), poNumber ->
  // P_O_NUMBER (PO:), invoiceNumber -> INVOICE_NUMBER (INV:),
  // departmentNumber -> DEPARTMENT_NUMBER (DEPT:) — confirmed against that
  // real label's actual print layout, not guessed from public docs alone
  // like most of this file's other FedEx wiring. Each of poNumber/
  // invoiceNumber/departmentNumber is entirely optional and simply omitted
  // from the request when null (see createFedexShipment below) — same
  // "never send a field FedEx might reject as present-but-empty" pattern
  // already used elsewhere in this file (DDP/DDU, commodity weight).
  //
  // 2026-09-11 (correction, same day) — a SECOND real test label
  // (PO-A707) plus its matching CSB-V invoice PDF corrected what actually
  // belongs in the first two of these. The FedEx customerReferenceType
  // each field maps to (CUSTOMER_REFERENCE/P_O_NUMBER — i.e. which line
  // it prints on) is unchanged; only the VALUE courier-booking/actions.ts
  // sends for each one changed:
  //   - customerRef (REF:) now carries the Master Invoice No
  //     (sales_invoices.master_invoice_no — a company-wise serial number,
  //     the same one the auto-generated CSB-V invoice itself carries),
  //     not the order's own Ref No as first implemented.
  //   - poNumber (PO:) now carries the company's Bank AD Code
  //     (company_profiles.ad_code, numeric code portion only — the DB
  //     value is stored as "<code>/<IFSC>", e.g. "0304993/PUNB0614300",
  //     and the user asked for just "0304993"), not the order's own Ref
  //     No as first implemented.
  references: {
    customerRef: string; // prints as FedEx's "REF:" — this shipment's Master Invoice No (company-wise serial, falls back to the order's own Ref No only if the Master Invoice reservation wasn't available, e.g. a domestic shipment)
    poNumber?: string | null; // prints as "PO:" — the shipping company's Bank AD Code (code portion only, company-wise)
    invoiceNumber?: string | null; // prints as "INV:" — this shipment's CSB-V sales_invoices.invoice_no, pre-reserved before booking (see resolveFedexLabelReferences in courier-booking/actions.ts) so it exists in time to be sent here
    departmentNumber?: string | null; // prints as "DEPT:" — the FedEx-specific department reference this app already computes deterministically (see src/lib/invoices/department-reference.ts), same value the auto-generated invoice itself carries
  };
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
// again."
//
// First attempt at a fix (same day) fetched the label URL SERVER-SIDE
// using the Ship API's own OAuth bearer token, reasoning that FedEx's
// document retrieval sat behind the same client_credentials app. Real
// production data from the user's own next test booking proved that
// wrong: the URL FedEx actually returns is
// `https://wwwtest.fedex.com/document/v1/cache/retrieve/...` — note the
// hostname: `wwwtest.fedex.com`, FedEx's own *customer WEBSITE* domain
// (the "www" site, running in its test environment), NOT
// `apis-sandbox.fedex.com` (FEDEX_API_BASE, this whole file's actual API
// host). That's a completely different backend — a fedex.com *website*
// page expecting a real fedex.com account login (cookie session), not an
// Authorization: Bearer header for the developer API app. Sending the
// Ship API's OAuth token there does nothing useful — FedEx's website
// correctly doesn't recognize it as a valid login and serves exactly the
// same "please log in" page whether a browser or a server made the
// request. That's why the server-side authenticated fetch also failed
// (silently, to the app's own honest "no label captured yet" message —
// better than the raw error, but the label still wasn't retrievable).
//
// REAL fix: stop asking FedEx for a URL at all. `labelResponseOptions`
// below is now "LABEL" instead of "URL_ONLY" — FedEx's documented
// alternative, which returns the label as inline base64 bytes
// (`packageDocuments[].encodedLabel`) directly in the same Ship API
// response this module already parses, with the SAME API host and SAME
// bearer token already used for the booking call — no follow-up request,
// no second domain, no separate login of any kind to fail. This also
// makes FedEx consistent with how UPS/DHL/etc. already hand back their
// labels in this app (inline bytes -> data:application/pdf;base64,...
// URI). A `url`-only fallback is kept below purely as a last resort for
// the unlikely case FedEx ever returns one anyway; it's fetched
// unauthenticated (no Authorization header) since the wwwtest.fedex.com
// finding above means a Bearer token was never the right credential for
// it in the first place — if that also fails, this returns null rather
// than a dead link, exactly as before.
async function resolveLabelAsDataUri(
  labelDoc: { url?: string; encodedLabel?: string; contentType?: string } | undefined
): Promise<string | null> {
  if (!labelDoc) return null;
  if (labelDoc.encodedLabel) return `data:application/pdf;base64,${labelDoc.encodedLabel}`;
  if (!labelDoc.url) return null;

  try {
    const res = await fetch(labelDoc.url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      console.error(`FedEx label URL fetch failed (${res.status}) for ${labelDoc.url}`);
      return null;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    return `data:application/pdf;base64,${buffer.toString("base64")}`;
  } catch (err) {
    console.error("FedEx label URL fetch threw:", err);
    return null;
  }
}

export async function createFedexShipment(
  input: FedexShipInput,
  credentials?: { client_id?: string; client_secret?: string }
): Promise<FedexShipResult> {
  const accessToken = await getFedexAccessToken({ clientId: credentials?.client_id, clientSecret: credentials?.client_secret });

  const isInternational = input.shipper.countryCode !== input.recipient.countryCode;

  // 2026-09-11 — see FedexShipInput.references' header comment for the
  // full mapping (confirmed against a real FedEx test label). Built once
  // here so it's easy to see every reference line this shipment sends at a
  // glance; each optional entry is included only when a real value exists.
  const customerReferences: Array<{ customerReferenceType: string; value: string }> = [
    { customerReferenceType: "CUSTOMER_REFERENCE", value: input.references.customerRef },
  ];
  if (input.references.poNumber) customerReferences.push({ customerReferenceType: "P_O_NUMBER", value: input.references.poNumber });
  if (input.references.invoiceNumber) customerReferences.push({ customerReferenceType: "INVOICE_NUMBER", value: input.references.invoiceNumber });
  if (input.references.departmentNumber) customerReferences.push({ customerReferenceType: "DEPARTMENT_NUMBER", value: input.references.departmentNumber });

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
          // 2026-09-10: both omitted entirely when not provided, rather
          // than sent as empty strings/arrays — FedEx's Ship API is known
          // to reject some fields for being present-but-empty rather than
          // just absent (see the DDP/DDU and commodity-weight comments
          // elsewhere in this file for other examples of that pattern).
          ...(input.recipient.phoneExtension ? { phoneExtension: input.recipient.phoneExtension } : {}),
          ...(input.recipient.taxId
            ? { tins: [{ number: input.recipient.taxId, tinType: "BUSINESS_NATIONAL" }] }
            : {}),
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
        customerReferences,
      },
    ],
  };

  if (isInternational) {
    requestedShipment.customsClearanceDetail = {
      dutiesPayment: { paymentType: fedexDutiesPaymentType(input.ddpDdu ?? "DDU") },
      // 2026-09-12 — see FedexShipInput.shipmentPurpose's header comment
      // (unconfirmed mapping — public docs only, not yet a real account).
      ...(input.shipmentPurpose ? { commercialInvoice: { shipmentPurpose: input.shipmentPurpose } } : {}),
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
          // 2026-09-12 — see FedexShipInput.harmonizedTariffNumber's header
          // comment. Omitted entirely when not on file, rather than sent
          // as an empty string — same never-send-empty pattern as every
          // other optional field in this file.
          ...(input.harmonizedTariffNumber ? { harmonizedCode: input.harmonizedTariffNumber } : {}),
        },
      ],
    };

    // 2026-09-12 — Electronic Trade Documents. See
    // FedexShipInput.electronicInvoiceType's header comment for the full
    // reasoning and the exact scope decided with the user (FedEx
    // auto-generates + electronically transmits either the commercial
    // invoice or the proforma invoice from the customsClearanceDetail
    // data above — this app never uploads its own invoice PDF to FedEx).
    // Only added for international shipments (ETD is meaningless without
    // customs clearance) and only when the booking form's dropdown for it
    // isn't set to "none".
    //
    // 2026-09-12 (same-day correction) — CONFIRMED against a real FedEx
    // account: the user's first live test with only "ELECTRONIC_TRADE_
    // DOCUMENTS" in specialServiceTypes got a real 400 back from FedEx:
    // "COMMERCIAL_OR_PRO_FORMA_INVOICE is required to process your
    // electronic trade document request." So FedEx needs BOTH special
    // service types together — "ELECTRONIC_TRADE_DOCUMENTS" (send
    // documents electronically at all) AND "COMMERCIAL_OR_PRO_FORMA_
    // INVOICE" (which document family this is) — etdDetail.
    // requestedDocumentTypes then narrows it to the specific one
    // (COMMERCIAL_INVOICE or PROFORMA_INVOICE). This one piece is now
    // confirmed by a real error message, not just public docs.
    if (input.electronicInvoiceType) {
      requestedShipment.shipmentSpecialServices = {
        specialServiceTypes: ["ELECTRONIC_TRADE_DOCUMENTS", "COMMERCIAL_OR_PRO_FORMA_INVOICE"],
        etdDetail: { requestedDocumentTypes: [input.electronicInvoiceType] },
      };
    }
  }

  const body = {
    // 2026-09-08: originally "URL_ONLY" — confirmed against a real FedEx
    // sandbox response that this option does make FedEx return a label
    // URL. 2026-09-10: switched to "LABEL" — a second real sandbox
    // response showed that URL points at wwwtest.fedex.com (FedEx's own
    // customer WEBSITE, test environment — a completely different login
    // system from this API), which is why opening it produced a raw
    // "LOGIN.REAUTHENTICATE.ERROR" page instead of the PDF; see
    // resolveLabelAsDataUri's header comment above for the full story.
    // "LABEL" makes FedEx return the label as inline base64 bytes in the
    // SAME response instead, so there's no second URL/domain/login
    // involved at all.
    labelResponseOptions: "LABEL",
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
  const labelUrl = await resolveLabelAsDataUri(labelDoc);

  return {
    success: !!trackingNo,
    trackingNo,
    labelUrl,
    bookedAmt: rateDetail?.totalNetCharge ?? null,
    bookedCurrency: rateDetail?.currency ?? null,
    raw: parsed,
  };
}
