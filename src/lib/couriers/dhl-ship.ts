// DHL Express — MyDHL API, shipment creation (POST /shipments). Built from
// DHL's own public developer docs (developer.dhl.com/api-reference/dhl-
// express-mydhl-api — "Shipment Creation" / "Create a new shipment"), the
// REST API DHL's own docs describe as the current standard for booking a
// DHL Express shipment (the older "DHL Express XML-PI" SOAP/XML contract is
// still documented but MyDHL API is what DHL's developer portal leads new
// integrators to — same choice the owner asked for: "whichever DHL's own
// public developer docs describe as their standard REST shipment-booking
// API"). Mirrors this app's other 5 real-booking clients
// (fedex-ship.ts/ups-ship.ts/aramex-shipping.ts/delhivery-ship.ts/
// shiprocket-ship.ts) in overall shape. UNCONFIRMED against a real DHL
// account — no sample request/response was provided for this round (same
// position as FedEx/UPS/Delhivery/Shiprocket's own header comments); built
// to the documented request/response shape as closely as this app's other
// clients were, not yet tested live. Where a field is genuinely uncertain
// (see BOOKED AMOUNT below), that uncertainty is flagged rather than
// pretended-confirmed — same honesty standard aramex-shipping.ts set.
//
// NOT THE SAME PRODUCT AS dhl-tracking.ts. This app's existing
// dhl-tracking.ts calls DHL's "Shipment Tracking - Unified" API, a
// DIFFERENT DHL developer-portal product with its own single `DHL-API-Key`
// header auth. MyDHL API (this file) is DHL's shipment-creation/booking
// product — registering an app for it in developer.dhl.com issues a
// separate username/password (Consumer Key / Consumer Secret) pair, used
// as HTTP Basic Auth credentials here, NOT the DHL_API_KEY tracking
// already uses. Getting MyDHL API access requires DHL's own account-
// enablement review (same "not self-serve" caveat dhl-tracking.ts's header
// comment already flags for the Tracking product) — see the new env vars
// below.
//
// DDP vs DDU — DHL Express has its OWN dedicated field for this, unlike
// FedEx (paymentType SENDER/RECIPIENT, nested under
// customsClearanceDetail.dutiesPayment) or UPS (TermsOfShipment DDP/DAP,
// nested under InternationalForms). DHL's MyDHL API takes a top-level
// `content.incoterm` string using standard Incoterms 2020 3-letter codes —
// "DAP" (Delivered At Place — buyer/receiver pays duty, DHL's DDU-
// equivalent) or "DDP" (Delivered Duty Paid — shipper pays duty) are the
// two this app's shared DDP/DDU toggle maps onto, same as UPS's DAP
// naming. DHL's incoterm field also accepts other codes (EXW, FCA, CPT,
// CIP, DAT, FOB, CFR, CIF) that this app's own DDP/DDU toggle has no
// concept of — deliberately NOT exposed here, only DAP/DDP are reachable
// via this client's `ddpDdu` input, matching the app's existing two-way
// toggle rather than building a 9-way Incoterm picker no other courier in
// this app has.
//
// BOOKED AMOUNT — UNCERTAIN, flagged rather than guessed. MyDHL API's
// create-shipment response is NOT primarily a pricing response (DHL has a
// separate `/rates` endpoint for that, out of scope this round — same
// reasoning Aramex's own separate Rate Calculator WSDL operation was left
// out). Some public integration write-ups describe a shipment-creation
// response that can carry a `shipmentDetails[].totalPrice` breakdown
// (currency + price array) when rate-related request flags are set, but
// this could not be confirmed against DHL's own reference docs with
// certainty for this build. This client defensively LOOKS for that shape
// if present and extracts it, but — unlike FedEx/UPS/Shiprocket where the
// pricing field is confirmed-documented — DHL should be treated as
// ALWAYS-uncertain for booked-amount capture until a real response is
// seen. The caller (courier-booking/actions.ts) always has the Courier
// Rate Card fallback for whenever this comes back null, exactly like
// Aramex/Delhivery.

const DHL_EXPRESS_API_BASE = process.env.DHL_EXPRESS_API_BASE_URL || "https://express.api.dhl.com/mydhlapi";

export type DhlDdpDdu = "DDP" | "DDU";

export type DhlShipInput = {
  productCode: string; // DHL Express product code, e.g. "P" (EXPRESS WORLDWIDE), "U" (EXPRESS WORLDWIDE Non-Doc) — kept free text like the other 5 couriers' service/product codes, since DHL has many and adds more per-country
  ddpDdu: DhlDdpDdu;
  accountNumber: string; // DHL Express Account Number charges post to (accounts[].number, typeCode "shipper")
  shipper: {
    contactName: string;
    companyName: string;
    phone: string;
    email: string;
    address1: string;
    address2?: string | null;
    city: string;
    stateOrProvince?: string | null;
    postalCode: string;
    countryCode: string;
  };
  recipient: {
    contactName: string;
    companyName?: string | null;
    phone: string;
    email?: string | null;
    address1: string;
    address2?: string | null;
    city: string;
    stateOrProvince?: string | null;
    postalCode: string;
    countryCode: string;
  };
  packageWeightKg: number;
  packageDimsCm: { length: number; width: number; height: number };
  currencyCode: string;
  customsValue?: number | null;
  goodsDescription: string;
  numberOfPieces: number;
  referenceNo: string;
};

export type DhlShipResult = {
  success: boolean;
  trackingNo: string | null;
  labelUrl: string | null; // DHL returns a base64-encoded label document in `documents[]`; kept as a data: URI, same convention fedex-ship.ts/ups-ship.ts use for their own base64 labels
  bookedAmt: number | null; // see header comment — always treat as likely-null, not confirmed-present like FedEx/UPS/Shiprocket
  bookedCurrency: string | null;
  raw: unknown;
};

function getDhlExpressCredentials(): { username: string; password: string } {
  const username = process.env.DHL_EXPRESS_USERNAME;
  const password = process.env.DHL_EXPRESS_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "DHL_EXPRESS_USERNAME / DHL_EXPRESS_PASSWORD are not set. (These are MyDHL API booking credentials — NOT the same as DHL_API_KEY, which only covers DHL's Tracking API. Register a separate MyDHL API app at developer.dhl.com.)"
    );
  }
  return { username, password };
}

function dhlIncoterm(ddpDdu: DhlDdpDdu): "DDP" | "DAP" {
  // DHL's Incoterm code for the DDU-equivalent concept is "DAP" (Delivered
  // At Place), same modern naming UPS uses — see header comment.
  return ddpDdu === "DDP" ? "DDP" : "DAP";
}

function dhlPostalAddress(p: {
  address1: string;
  address2?: string | null;
  city: string;
  stateOrProvince?: string | null;
  postalCode: string;
  countryCode: string;
}) {
  return {
    addressLine1: p.address1,
    addressLine2: p.address2 || undefined,
    cityName: p.city,
    provinceCode: p.stateOrProvince || undefined,
    postalCode: p.postalCode,
    countryCode: p.countryCode,
  };
}

export async function createDhlShipment(input: DhlShipInput): Promise<DhlShipResult> {
  const { username, password } = getDhlExpressCredentials();
  const isInternational = input.shipper.countryCode !== input.recipient.countryCode;
  const declaredValue = input.customsValue ?? 0;

  const body: Record<string, unknown> = {
    plannedShippingDateAndTime: `${new Date().toISOString().slice(0, 19)}GMT+00:00`,
    pickup: { isRequested: false },
    productCode: input.productCode,
    accounts: [{ typeCode: "shipper", number: input.accountNumber }],
    customerDetails: {
      shipperDetails: {
        postalAddress: dhlPostalAddress(input.shipper),
        contactInformation: {
          fullName: input.shipper.contactName,
          companyName: input.shipper.companyName,
          phone: input.shipper.phone,
          email: input.shipper.email,
        },
      },
      receiverDetails: {
        postalAddress: dhlPostalAddress(input.recipient),
        contactInformation: {
          fullName: input.recipient.contactName,
          companyName: input.recipient.companyName || input.recipient.contactName,
          phone: input.recipient.phone,
          email: input.recipient.email || undefined,
        },
      },
    },
    content: {
      packages: [
        {
          weight: input.packageWeightKg,
          dimensions: { length: input.packageDimsCm.length, width: input.packageDimsCm.width, height: input.packageDimsCm.height },
          customerReferences: [{ value: input.referenceNo, typeCode: "CU" }],
        },
      ],
      isCustomsDeclarable: isInternational,
      declaredValue,
      declaredValueCurrency: input.currencyCode,
      description: input.goodsDescription,
      incoterm: dhlIncoterm(input.ddpDdu),
      unitOfMeasurement: "metric",
    },
    outputImageProperties: { printerDPI: 300, encodingFormat: "pdf" },
  };

  if (isInternational) {
    // DHL requires an export declaration with per-line-item detail for a
    // dutiable international shipment — modeled as ONE line covering the
    // whole package (this app doesn't carry a multi-line commodity
    // breakdown for courier booking today, same simplification
    // fedex-ship.ts's single-commodity block and aramex-shipping.ts's
    // single DescriptionOfGoods field make).
    (body.content as Record<string, unknown>).exportDeclaration = {
      lineItems: [
        {
          number: 1,
          description: input.goodsDescription,
          price: declaredValue,
          priceCurrency: input.currencyCode,
          quantity: { value: input.numberOfPieces || 1, unitOfMeasurement: "PCS" },
          manufacturerCountry: input.shipper.countryCode,
        },
      ],
      invoice: { number: input.referenceNo, date: new Date().toISOString().slice(0, 10) },
    };
  }

  const res = await fetch(`${DHL_EXPRESS_API_BASE}/shipments`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      "Message-Reference": `oms-${Date.now()}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: {
    shipmentTrackingNumber?: string;
    documents?: Array<{ typeCode?: string; content?: string; imageFormat?: string }>;
    shipmentDetails?: Array<{ totalPrice?: Array<{ currencyType?: string; priceCurrency?: string; price?: number }> }>;
    detail?: string;
    title?: string;
    additionalDetails?: string[];
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`DHL Express MyDHL API returned non-JSON response (${res.status}): ${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    const msg = parsed.detail || parsed.additionalDetails?.join("; ") || parsed.title || text.slice(0, 500);
    throw new Error(`DHL Express MyDHL API shipment creation failed ${res.status}: ${msg}`);
  }

  const trackingNo = parsed.shipmentTrackingNumber ?? null;
  const label = parsed.documents?.find((d) => d.typeCode === "label") ?? parsed.documents?.[0];
  const labelUrl = label?.content ? `data:application/${(label.imageFormat || "pdf").toLowerCase()};base64,${label.content}` : null;

  // See header comment — this field's presence/shape is NOT confirmed
  // against DHL's own docs, extracted defensively only.
  const priceEntry = parsed.shipmentDetails?.[0]?.totalPrice?.[0];
  const bookedAmt = typeof priceEntry?.price === "number" ? priceEntry.price : null;
  const bookedCurrency = priceEntry?.priceCurrency ?? priceEntry?.currencyType ?? null;

  return {
    success: !!trackingNo,
    trackingNo,
    labelUrl,
    bookedAmt,
    bookedCurrency: bookedAmt != null ? bookedCurrency : null,
    raw: parsed,
  };
}
