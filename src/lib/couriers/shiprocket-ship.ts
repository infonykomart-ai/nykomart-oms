// Shiprocket — real order + AWB creation, built from Shiprocket's publicly
// documented REST API (apidocs.shiprocket.in). UNCONFIRMED against a real
// Shiprocket account — no sample was provided, built to documented shape.
//
// Included because the task brief asked to extend the unified booking flow
// to Shiprocket too "if it's a small marginal addition once the pattern
// exists" — Shiprocket's API genuinely is the simplest of the 5 (plain
// REST, email+password login like Shipglobal, no SOAP/OAuth2), so it is
// included rather than skipped. It is domestic-India-primary but does
// support international via a separate endpoint — this client only
// implements the DOMESTIC adhoc-order flow (`orders/create/adhoc` +
// `courier/assign/awb`), the one this app's other 4 new couriers don't
// already cover well; international Shiprocket booking is NOT built this
// round (flagged, not silently assumed done).
//
// TWO-STEP like Shipglobal: (1) orders/create/adhoc creates the order on
// Shiprocket's side, (2) courier/assign/awb picks a courier + generates
// the real AWB. Shiprocket also has its OWN webhook already wired in this
// app (src/app/api/webhooks/courier/shiprocket/route.ts) for ongoing
// tracking updates post-booking — this booking client only covers create +
// assign, tracking after that reuses what already exists, unchanged.
//
// AUTH: POST email+password to /v1/external/auth/login, get a bearer
// token — no refresh flow documented (same "just re-login every time"
// shape as Shipglobal, fine for one-shipment-at-a-time usage).
//
// BOOKED AMOUNT: courier/assign/awb's response includes a `freight_charges`
// field in Shiprocket's public docs when the assignment succeeds — the one
// other courier (besides FedEx) in this round's 5 with any chance of a
// real quoted amount at booking time. Falls back to null (rate-card
// estimate) if the field isn't present in a given response.

export const SHIPROCKET_API_BASE = process.env.SHIPROCKET_API_BASE_URL || "https://apiv2.shiprocket.in/v1/external";

export type ShiprocketShipInput = {
  orderRefNo: string;
  orderDate: string; // YYYY-MM-DD
  pickupLocationName: string; // Shiprocket "pickup location" nickname, registered on their dashboard
  billing: {
    customerName: string;
    address: string;
    city: string;
    state: string;
    pincode: string;
    country: string;
    phone: string;
    email: string;
  };
  item: { name: string; sku: string; units: number; sellingPrice: number };
  paymentMethod: "Prepaid" | "COD";
  subTotal: number;
  packageWeightKg: number;
  packageDimsCm: { length: number; width: number; height: number };
};

export type ShiprocketShipResult = {
  success: boolean;
  trackingNo: string | null;
  labelUrl: null; // label generation is a further separate endpoint (`courier/generate/label`) — out of scope this round
  bookedAmt: number | null;
  bookedCurrency: string | null;
  raw: unknown;
};

// 2026-09-03: `override` lets a caller supply per-company credentials
// resolved from the new courier_credentials table (see
// src/lib/couriers/credentials.ts) instead of this deployment's global env
// vars. Shiprocket's booking login is used ONLY here (not shared with any
// tracking cron — its webhook auth token, SHIPROCKET_WEBHOOK_TOKEN, is a
// completely separate credential, see .env.example), so no env-var-only
// caller depends on this staying argument-less.
export async function shiprocketLogin(override?: { email?: string; password?: string }): Promise<string> {
  const email = override?.email || process.env.SHIPROCKET_EMAIL;
  const password = override?.password || process.env.SHIPROCKET_PASSWORD;
  if (!email || !password) throw new Error("SHIPROCKET_EMAIL / SHIPROCKET_PASSWORD are not set (env var or Account Setup).");

  const res = await fetch(`${SHIPROCKET_API_BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Shiprocket login failed ${res.status}: ${text.slice(0, 500)}`);
  let data: { token?: string };
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`Shiprocket login returned non-JSON response: ${text.slice(0, 500)}`);
  }
  if (!data.token) throw new Error(`Shiprocket login response missing "token": ${text.slice(0, 500)}`);
  return data.token;
}

export async function createShiprocketShipment(
  input: ShiprocketShipInput,
  credentials?: { email?: string; password?: string }
): Promise<ShiprocketShipResult> {
  const token = await shiprocketLogin(credentials);

  const orderRes = await fetch(`${SHIPROCKET_API_BASE}/orders/create/adhoc`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      order_id: input.orderRefNo,
      order_date: input.orderDate,
      pickup_location: input.pickupLocationName,
      billing_customer_name: input.billing.customerName,
      billing_address: input.billing.address,
      billing_city: input.billing.city,
      billing_pincode: input.billing.pincode,
      billing_state: input.billing.state,
      billing_country: input.billing.country,
      billing_email: input.billing.email,
      billing_phone: input.billing.phone,
      shipping_is_billing: true,
      order_items: [{ name: input.item.name, sku: input.item.sku, units: input.item.units, selling_price: input.item.sellingPrice }],
      payment_method: input.paymentMethod,
      sub_total: input.subTotal,
      length: input.packageDimsCm.length,
      breadth: input.packageDimsCm.width,
      height: input.packageDimsCm.height,
      weight: input.packageWeightKg,
    }),
  });
  const orderText = await orderRes.text();
  let orderParsed: { order_id?: number; shipment_id?: number; message?: string };
  try {
    orderParsed = JSON.parse(orderText);
  } catch {
    throw new Error(`Shiprocket orders/create/adhoc returned non-JSON response (${orderRes.status}): ${orderText.slice(0, 500)}`);
  }
  if (!orderRes.ok || !orderParsed.shipment_id) {
    throw new Error(`Shiprocket orders/create/adhoc failed: ${orderParsed.message ?? orderText.slice(0, 500)}`);
  }

  const awbRes = await fetch(`${SHIPROCKET_API_BASE}/courier/assign/awb`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ shipment_id: orderParsed.shipment_id }),
  });
  const awbText = await awbRes.text();
  let awbParsed: {
    response?: { data?: { awb_code?: string; courier_name?: string; freight_charges?: number } };
    message?: string;
  };
  try {
    awbParsed = JSON.parse(awbText);
  } catch {
    throw new Error(`Shiprocket courier/assign/awb returned non-JSON response (${awbRes.status}): ${awbText.slice(0, 500)}`);
  }
  const data = awbParsed.response?.data;
  if (!awbRes.ok || !data?.awb_code) {
    throw new Error(`Shiprocket courier/assign/awb failed: ${awbParsed.message ?? awbText.slice(0, 500)} (order was created: shipment_id ${orderParsed.shipment_id})`);
  }

  return {
    success: true,
    trackingNo: data.awb_code,
    labelUrl: null,
    bookedAmt: typeof data.freight_charges === "number" ? data.freight_charges : null,
    bookedCurrency: typeof data.freight_charges === "number" ? "INR" : null,
    raw: { order: orderParsed, awb: awbParsed },
  };
}
