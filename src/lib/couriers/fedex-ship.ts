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
  labelUrl: string | null; // FedEx returns a base64-encoded label document; kept as a data: URI so the caller can store/link it the same way as a real URL
  bookedAmt: number | null;
  bookedCurrency: string | null;
  raw: unknown;
};

function fedexDutiesPaymentType(ddpDdu: FedexDdpDdu): "SENDER" | "RECIPIENT" {
  // See header comment — FedEx has no literal "DDP"/"DDU" enum value.
  return ddpDdu === "DDP" ? "SENDER" : "RECIPIENT";
}

export async function createFedexShipment(input: FedexShipInput): Promise<FedexShipResult> {
  const accessToken = await getFedexAccessToken();

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
          unitPrice: { amount: input.customsValue ?? 0, currency: input.currencyCode },
          customsValue: { amount: input.customsValue ?? 0, currency: input.currencyCode },
        },
      ],
    };
  }

  const body = {
    labelResponseOptions: "URL_ONLY",
    requestedShipment,
    accountNumber: { value: input.shipper.accountNumber },
  };

  const res = await fetch(`${FEDEX_API_BASE}/ship/v1/shipments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-locale": "en_US",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: {
    output?: {
      transactionShipments?: Array<{
        completedShipmentDetail?: {
          masterTrackingId?: { trackingNumber?: string };
          shipmentRating?: { shipmentRateDetails?: Array<{ totalNetCharge?: { amount?: number; currency?: string } }> };
          shipmentDocuments?: Array<{ url?: string; encodedLabel?: string }>;
        };
      }>;
    };
    errors?: Array<{ message?: string; code?: string }>;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`FedEx Ship API returned non-JSON response (${res.status}): ${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    const msg = parsed.errors?.map((e) => e.message).filter(Boolean).join("; ") || text.slice(0, 500);
    throw new Error(`FedEx Ship API failed ${res.status}: ${msg}`);
  }

  const shipment = parsed.output?.transactionShipments?.[0];
  const detail = shipment?.completedShipmentDetail;
  const trackingNo = detail?.masterTrackingId?.trackingNumber ?? null;
  const rate = detail?.shipmentRating?.shipmentRateDetails?.[0]?.totalNetCharge;
  const doc = detail?.shipmentDocuments?.[0];
  const labelUrl = doc?.url ?? (doc?.encodedLabel ? `data:application/pdf;base64,${doc.encodedLabel}` : null);

  return {
    success: !!trackingNo,
    trackingNo,
    labelUrl,
    bookedAmt: rate?.amount ?? null,
    bookedCurrency: rate?.currency ?? null,
    raw: parsed,
  };
}
