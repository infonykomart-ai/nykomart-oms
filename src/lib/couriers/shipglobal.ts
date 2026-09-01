// Shipglobal — cross-border shipment creation + label generation, built
// directly from Shipglobal's own official API docs the user pasted in
// (base URL https://labels.shipglobal.in/api/v1/, 3 endpoints:
// customers.php login, addOrder.php shipment creation, processDestination
// .php manifest-and-get-tracking-number). Plain REST/JSON, unlike Aramex's
// SOAP or FedEx's OAuth2 — much simpler auth: email+password -> bearer
// token (no refresh-token flow documented, just re-login when needed).
//
// UNLIKE every other courier in this app, this is NOT a
// tracking-only integration — it actually CREATES a real shipment (and,
// once real credentials + a manifest_code are supplied, a real customs
// declaration) via addOrder.php, then hands it to a real carrier
// (DPD/UniUni/VipParcel/DHL E-Commerce/UBI, chosen via `service`) via
// processDestination.php. See db/2026-08-10-shipglobal.sql and
// src/app/dashboard/shipglobal/actions.ts for the full flow and the new
// 'shipglobal_shipment' capability gating who can trigger it.
//
// ON-DEMAND, not a cron job — every other polling-based courier
// (FedEx/Aramex) needed a Vercel Cron slot; this doesn't, since it's
// triggered by a person clicking "Create Shipment" for one order at a
// time, not a scheduled background sweep. No vercel.json changes needed.
//
// Ongoing tracking-status updates AFTER a Shipglobal shipment is created
// are OUT OF SCOPE here — the docs the user provided only cover
// create+manifest (which returns the tracking number once), not a
// separate status-lookup or webhook endpoint. If Shipglobal has one, it
// wasn't in what was provided; flagged in the project notes as a known gap
// rather than guessed at.

const SHIPGLOBAL_BASE_URL = process.env.SHIPGLOBAL_BASE_URL || "https://labels.shipglobal.in/api/v1";

// The 5 service codes from the table the user provided — kept as a plain
// array (not a TS enum) since Shipglobal could add more without a code
// change here; the UI dropdown iterates this list.
export const SHIPGLOBAL_SERVICES = [
  { carrier: "DPD", code: "DPD-CLASSIC" },
  { carrier: "UniUni", code: "UNIUNI-CLASSIC" },
  { carrier: "VipParcel", code: "VIPPARCEL-CLASSIC" },
  { carrier: "DHL E-Commerce", code: "DHLECS-CLASSIC" },
  { carrier: "UBI (eTower)", code: "UBI-CLASSIC" },
] as const;

export type ShipglobalServiceCode = (typeof SHIPGLOBAL_SERVICES)[number]["code"];

function getShipglobalCredentials(): { email: string; password: string } {
  const email = process.env.SHIPGLOBAL_EMAIL;
  const password = process.env.SHIPGLOBAL_PASSWORD;
  if (!email || !password) {
    throw new Error("SHIPGLOBAL_EMAIL / SHIPGLOBAL_PASSWORD are not set.");
  }
  return { email, password };
}

/**
 * Logs in and returns a bearer token. No refresh-token flow was in the
 * docs provided — this just re-authenticates on every call. Fine for the
 * on-demand (one-shipment-at-a-time) usage pattern here; would need
 * caching if this ever became high-volume.
 */
export async function shipglobalLogin(): Promise<string> {
  const { email, password } = getShipglobalCredentials();
  const res = await fetch(`${SHIPGLOBAL_BASE_URL}/customers.php`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Shipglobal login failed ${res.status}: ${text.slice(0, 500)}`);
  }
  let data: { token?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Shipglobal login returned non-JSON response: ${text.slice(0, 500)}`);
  }
  if (!data.token) {
    throw new Error(`Shipglobal login response missing "token": ${text.slice(0, 500)}`);
  }
  return data.token;
}

export type ShipglobalAddOrderInput = {
  invoiceNo: string;
  invoiceDate: string; // YYYY-MM-DD
  orderReference: string; // must be unique per Shipglobal account — used later to look this order up in processDestination.php
  service: ShipglobalServiceCode;
  packageWeightG: number;
  packageLengthCm: number;
  packageBreadthCm: number;
  packageHeightCm: number;
  currencyCode: string;
  csb5Status: number;

  seller: {
    nickname: string;
    firstname: string;
    lastname: string;
    mobile: string;
    email: string;
    company: string;
    address1: string;
    address2: string;
    address3?: string | null;
    city: string;
    postcode: string;
    countryCode: string;
    state: string;
    taxIdType?: string | null;
    taxId?: string | null;
  };

  shipping: {
    firstname: string;
    lastname: string;
    mobile: string;
    email: string;
    company?: string | null;
    address1: string;
    address2: string;
    address3?: string | null;
    city: string;
    postcode: string;
    countryCode: string;
    state: string;
  };

  iossNumber?: string | null;

  item: {
    name: string;
    sku: string;
    quantity: number;
    unitPrice: number;
    hsn: string;
    taxRate: number;
  };

  sellerReference: string; // addOrder.php's required "tracking" field — NOT the real courier tracking number
  mailClass?: string | null;
  deliveryConfirmation?: string | null;
};

export type ShipglobalAddOrderResult = {
  success: boolean;
  orderNumber: string | null;
  waybillNumber: string | null;
  labelPdfBase64: string | null;
  // 2026-09-01: booking-cost capture (see
  // db/2026-09-01-multi-courier-booking-and-freight-recon.sql). NOT part
  // of the original addOrder.php docs the user pasted in (per this file's
  // header comment, that response is order_number/waybill_number/
  // pdf_base64 only) — this is a best-effort opportunistic extraction that
  // checks a few plausible field names (amount/total_amount/
  // charged_amount) on the off chance Shipglobal's LIVE response includes
  // one that wasn't in the docs. Null every time unless one of those keys
  // is actually present — never guessed/fabricated. If Shipglobal's real
  // response turns out to have a differently-named pricing field once live
  // credentials are used, update parseAddOrderAmount below, not the
  // caller.
  chargedAmount: number | null;
  chargedCurrency: string | null;
  raw: unknown;
};

function parseAddOrderAmount(data: Record<string, unknown> | undefined): number | null {
  if (!data) return null;
  const candidate = data.amount ?? data.total_amount ?? data.charged_amount ?? data.shipping_charge;
  const n = Number(candidate);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export async function shipglobalAddOrder(token: string, input: ShipglobalAddOrderInput): Promise<ShipglobalAddOrderResult> {
  const body = {
    invoice_no: input.invoiceNo,
    invoice_date: input.invoiceDate,
    order_reference: input.orderReference,
    service: input.service,
    package_weight: input.packageWeightG,
    package_length: input.packageLengthCm,
    package_breadth: input.packageBreadthCm,
    package_height: input.packageHeightCm,
    currency_code: input.currencyCode,
    csb5_status: input.csb5Status,

    seller_nickname: input.seller.nickname,
    seller_firstname: input.seller.firstname,
    seller_lastname: input.seller.lastname,
    seller_mobile: input.seller.mobile,
    seller_email: input.seller.email,
    seller_company: input.seller.company,
    seller_address: input.seller.address1,
    seller_address_2: input.seller.address2,
    seller_address_3: input.seller.address3 ?? "",
    seller_city: input.seller.city,
    seller_postcode: input.seller.postcode,
    seller_country_code: input.seller.countryCode,
    seller_state: input.seller.state,
    seller_tax_id_type: input.seller.taxIdType ?? "",
    seller_tax_id: input.seller.taxId ?? "",

    customer_shipping_firstname: input.shipping.firstname,
    customer_shipping_lastname: input.shipping.lastname,
    customer_shipping_mobile: input.shipping.mobile,
    customer_shipping_email: input.shipping.email,
    customer_shipping_company: input.shipping.company ?? "",
    customer_shipping_address: input.shipping.address1,
    customer_shipping_address_2: input.shipping.address2,
    customer_shipping_address_3: input.shipping.address3 ?? "",
    customer_shipping_city: input.shipping.city,
    customer_shipping_postcode: input.shipping.postcode,
    customer_shipping_country_code: input.shipping.countryCode,
    customer_shipping_state: input.shipping.state,

    ioss_number: input.iossNumber ?? "",

    vendor_order_items: [
      {
        vendor_order_item_name: input.item.name,
        vendor_order_item_sku: input.item.sku,
        vendor_order_item_quantity: input.item.quantity,
        vendor_order_item_unit_price: input.item.unitPrice,
        vendor_order_item_hsn: input.item.hsn,
        vendor_order_item_tax_rate: input.item.taxRate,
      },
    ],

    tracking: input.sellerReference,
    mailClass: input.mailClass ?? "",
    deliveryConfirmation: input.deliveryConfirmation ?? "",
    retry: false,
  };

  const res = await fetch(`${SHIPGLOBAL_BASE_URL}/addOrder.php`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: {
    success?: boolean;
    error?: string;
    data?: { order_number?: string; waybill_number?: string; pdf_base64?: string; [key: string]: unknown };
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Shipglobal addOrder.php returned non-JSON response (${res.status}): ${text.slice(0, 500)}`);
  }
  if (!res.ok || !parsed.success) {
    throw new Error(`Shipglobal addOrder.php failed: ${parsed.error ?? text.slice(0, 500)}`);
  }
  return {
    success: true,
    orderNumber: parsed.data?.order_number ?? null,
    waybillNumber: parsed.data?.waybill_number ?? null,
    labelPdfBase64: parsed.data?.pdf_base64 ?? null,
    chargedAmount: parseAddOrderAmount(parsed.data),
    chargedCurrency: parseAddOrderAmount(parsed.data) != null ? input.currencyCode : null,
    raw: parsed,
  };
}

export type ShipglobalManifestResult = {
  success: boolean;
  trackingNo: string | null;
  raw: unknown;
};

/**
 * Manifests a previously-created order (by its order_reference — the SAME
 * value passed as `orderReference` to shipglobalAddOrder) and returns the
 * real carrier tracking number. `manifestCode` groups shipments into one
 * manifest/bag — this app calls it once per shipment with a fresh code
 * rather than batching multiple orders together, since staff create
 * shipments one at a time here (see src/app/dashboard/shipglobal/actions.ts).
 */
export async function shipglobalProcessDestination(
  token: string,
  service: ShipglobalServiceCode,
  orderReferenceNumbers: string[],
  manifestCode: string
): Promise<ShipglobalManifestResult> {
  const res = await fetch(`${SHIPGLOBAL_BASE_URL}/processDestination.php`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      service,
      order_reference_numbers: orderReferenceNumbers,
      manifest_code: manifestCode,
    }),
  });
  const text = await res.text();
  let parsed: {
    message?: string;
    error?: string;
    details?: { status?: string; data?: Array<{ status?: string; trackingNo?: string; errors?: string | null }> | null };
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Shipglobal processDestination.php returned non-JSON response (${res.status}): ${text.slice(0, 500)}`);
  }
  if (!res.ok || parsed.error || parsed.details?.status !== "Success") {
    const detail =
      (Array.isArray(parsed.details?.data) ? parsed.details?.data?.[0]?.errors : null) ??
      parsed.error ??
      text.slice(0, 500);
    throw new Error(`Shipglobal processDestination.php failed: ${detail}`);
  }
  const first = Array.isArray(parsed.details?.data) ? parsed.details?.data?.[0] : null;
  return { success: true, trackingNo: first?.trackingNo ?? null, raw: parsed };
}
