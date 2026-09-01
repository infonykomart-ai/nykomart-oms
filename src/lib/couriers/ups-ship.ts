// UPS Shipping API — real shipment creation, built from UPS's publicly
// documented Shipping API (developer.ups.com/api/reference?loc=en_US,
// "Shipping" product, OAuth2 client_credentials auth). UNCONFIRMED against
// a real UPS account — no sample request/response was provided for this
// round; built to the documented shape, not yet tested live.
//
// IMPORTANT — this is a DIFFERENT OAuth2 flow than
// src/app/api/webhooks/courier/ups/token/route.ts. That file issues a
// token WE generate so UPS can call OUR webhook (UPS Track Alert). This
// file calls UPS's OWN /security/v1/oauth/token endpoint to get a token
// FROM UPS, to call UPS's Shipping API. Needs its own, separate client
// credentials — UPS_CLIENT_ID / UPS_CLIENT_SECRET — registered against the
// "Shipping" API product in UPS's developer portal, NOT the
// UPS_WEBHOOK_CLIENT_ID/SECRET pair (those only exist to satisfy Track
// Alert's own credentialsUrl requirement and carry zero Shipping API
// scope).
//
// DDP vs DDU: UPS's own field is
// InternationalForms/ShipmentServiceOptions -> the "Bill To" /
// PaymentInformation.ShipmentCharge[].BillShipper vs BillReceiver +
// (for the international customs side specifically)
// InternationalForms.Contacts / TermsOfShipment (e.g. "DDP" IS actually a
// literal UPS TermsOfShipment code — UPS is the one courier of the 4 SOAP/
// REST bookers here whose docs use "DDP"/"DDU" almost verbatim, via
// TermsOfShipment: 'DDP' | 'DAP' | ... — DAP is UPS's modern name for what
// used to be called DDU/DDA, so 'DDU' here is mapped to UPS's 'DAP').
//
// BOOKED AMOUNT: UPS's Shipment Response includes
// ShipmentResults.ShipmentCharges.TotalCharges.MonetaryValue whenever
// UPS's own negotiated/published rates are returned with the shipment
// (NegotiatedRatesIndicator) — extracted when present, null otherwise
// (caller falls back to a rate-card estimate).

const UPS_API_BASE = process.env.UPS_API_BASE_URL || "https://onlinetools.ups.com";

export type UpsDdpDdu = "DDP" | "DDU";

export type UpsShipInput = {
  serviceCode: string; // UPS's own numeric service code, e.g. "07" (Express), "65" (Saver) — kept free text, see fedex-ship.ts's rationale
  ddpDdu: UpsDdpDdu | null;
  shipperNumber: string; // UPS account/shipper number charges post to
  shipper: {
    name: string;
    attentionName: string;
    phone: string;
    address1: string;
    address2?: string | null;
    city: string;
    state?: string | null;
    postalCode: string;
    countryCode: string;
  };
  recipient: {
    name: string;
    attentionName: string;
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
  customsValue?: number | null;
  commodityDescription?: string | null;
  referenceNo: string;
};

export type UpsShipResult = {
  success: boolean;
  trackingNo: string | null;
  labelUrl: string | null;
  bookedAmt: number | null;
  bookedCurrency: string | null;
  raw: unknown;
};

async function getUpsAccessToken(): Promise<string> {
  const clientId = process.env.UPS_CLIENT_ID;
  const clientSecret = process.env.UPS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("UPS_CLIENT_ID / UPS_CLIENT_SECRET are not set. (Not the same as UPS_WEBHOOK_CLIENT_ID/SECRET — see this file's header comment.)");
  }
  const res = await fetch(`${UPS_API_BASE}/security/v1/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });
  if (!res.ok) {
    throw new Error(`UPS OAuth token request failed ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

function upsTermsOfShipment(ddpDdu: UpsDdpDdu): "DDP" | "DAP" {
  // UPS retired "DDU" in favor of "DAP" (Delivered At Place) — same
  // buyer-pays-duty concept, new name. See header comment.
  return ddpDdu === "DDP" ? "DDP" : "DAP";
}

export async function createUpsShipment(input: UpsShipInput): Promise<UpsShipResult> {
  const accessToken = await getUpsAccessToken();
  const isInternational = input.shipper.countryCode !== input.recipient.countryCode;

  const shipmentPayload: Record<string, unknown> = {
    Description: input.commodityDescription || "General merchandise",
    Shipper: {
      Name: input.shipper.name,
      AttentionName: input.shipper.attentionName,
      Phone: { Number: input.shipper.phone },
      ShipperNumber: input.shipperNumber,
      Address: {
        AddressLine: [input.shipper.address1, input.shipper.address2 ?? ""].filter(Boolean),
        City: input.shipper.city,
        StateProvinceCode: input.shipper.state ?? "",
        PostalCode: input.shipper.postalCode,
        CountryCode: input.shipper.countryCode,
      },
    },
    ShipTo: {
      Name: input.recipient.name,
      AttentionName: input.recipient.attentionName,
      Phone: { Number: input.recipient.phone },
      Address: {
        AddressLine: [input.recipient.address1, input.recipient.address2 ?? ""].filter(Boolean),
        City: input.recipient.city,
        StateProvinceCode: input.recipient.state ?? "",
        PostalCode: input.recipient.postalCode,
        CountryCode: input.recipient.countryCode,
      },
    },
    ShipFrom: {
      Name: input.shipper.name,
      Address: {
        AddressLine: [input.shipper.address1, input.shipper.address2 ?? ""].filter(Boolean),
        City: input.shipper.city,
        StateProvinceCode: input.shipper.state ?? "",
        PostalCode: input.shipper.postalCode,
        CountryCode: input.shipper.countryCode,
      },
    },
    PaymentInformation: { ShipmentCharge: [{ Type: "01", BillShipper: { AccountNumber: input.shipperNumber } }] },
    Service: { Code: input.serviceCode },
    Package: [
      {
        Packaging: { Code: "02" }, // "02" = Customer Supplied Package
        Dimensions: {
          UnitOfMeasurement: { Code: "CM" },
          Length: String(input.packageDimsCm.length),
          Width: String(input.packageDimsCm.width),
          Height: String(input.packageDimsCm.height),
        },
        PackageWeight: { UnitOfMeasurement: { Code: "KGS" }, Weight: String(input.packageWeightKg) },
        ReferenceNumber: { Value: input.referenceNo },
      },
    ],
  };

  if (isInternational) {
    shipmentPayload.InvoiceLineTotal = { CurrencyCode: input.currencyCode, MonetaryValue: String(input.customsValue ?? 0) };
    shipmentPayload.InternationalForms = {
      FormType: "01", // Invoice
      TermsOfShipment: upsTermsOfShipment(input.ddpDdu ?? "DDU"),
      Contacts: { SoldTo: { Name: input.recipient.name } },
      Product: [
        {
          Description: [input.commodityDescription || "General merchandise"],
          Unit: { Number: "1", Value: String(input.customsValue ?? 0), UnitOfMeasurement: { Code: "PCS" } },
        },
      ],
    };
  }

  const res = await fetch(`${UPS_API_BASE}/api/shipments/v2409/ship`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      transId: `oms-${Date.now()}`,
      transactionSrc: "nykomart-oms",
    },
    body: JSON.stringify({ ShipmentRequest: { Shipment: shipmentPayload, LabelSpecification: { LabelImageFormat: { Code: "GIF" } } } }),
  });
  const text = await res.text();
  let parsed: {
    ShipmentResponse?: {
      ShipmentResults?: {
        ShipmentIdentificationNumber?: string;
        ShipmentCharges?: { TotalCharges?: { MonetaryValue?: string; CurrencyCode?: string } };
        PackageResults?: Array<{ TrackingNumber?: string; ShippingLabel?: { GraphicImage?: string } }>;
      };
    };
    response?: { errors?: Array<{ message?: string }> };
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`UPS Shipping API returned non-JSON response (${res.status}): ${text.slice(0, 500)}`);
  }
  if (!res.ok) {
    const msg = parsed.response?.errors?.map((e) => e.message).filter(Boolean).join("; ") || text.slice(0, 500);
    throw new Error(`UPS Shipping API failed ${res.status}: ${msg}`);
  }

  const results = parsed.ShipmentResponse?.ShipmentResults;
  const trackingNo = results?.ShipmentIdentificationNumber ?? results?.PackageResults?.[0]?.TrackingNumber ?? null;
  const label = results?.PackageResults?.[0]?.ShippingLabel?.GraphicImage;
  const charges = results?.ShipmentCharges?.TotalCharges;

  return {
    success: !!trackingNo,
    trackingNo,
    labelUrl: label ? `data:image/gif;base64,${label}` : null,
    bookedAmt: charges?.MonetaryValue ? Number(charges.MonetaryValue) : null,
    bookedCurrency: charges?.CurrencyCode ?? null,
    raw: parsed,
  };
}
