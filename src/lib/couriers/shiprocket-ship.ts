// Shiprocket — real order + AWB creation, built from Shiprocket's publicly
// documented REST API (apidocs.shiprocket.in). UNCONFIRMED against a real
// Shiprocket account — no sample was provided, built to documented shape.
//
// Included because the task brief asked to extend the unified booking flow
// to Shiprocket too "if it's a small marginal addition once the pattern
// exists" — Shiprocket's API genuinely is the simplest of the 5 (plain
// REST, email+password login like Shipglobal, no SOAP/OAuth2), so it is
// included rather than skipped.
//
// 2026-09-08 correction: an earlier version of this comment claimed
// Shiprocket "does support international via a separate endpoint" and that
// this client "only implements the DOMESTIC adhoc-order flow" pending that
// other endpoint. That was an unverified assumption typed in before anyone
// actually checked, and it turned out to be wrong: Shiprocket's own support
// site (support.shiprocket.in's API Document Helpsheet, a primary source)
// confirms there is only ONE order-creation endpoint in the whole
// documented public API — `orders/create/adhoc` — described as designed
// for all order types "without differentiation for international
// shipments." There is no separate international endpoint to be missing.
// ("Shiprocket X" is the name of their cross-border product, but it is
// presented as a dashboard product, not as a separately documented API.)
//
// Given that, `createShiprocketShipment` below already IS the whole story:
// it builds one request against that one endpoint, and `billing.country`
// is passed straight through as free text into `billing_country` — this
// file never hardcodes "India" anywhere. International destinations
// should work through this same client PROVIDED the connected Shiprocket
// account has international couriers enabled/serviceable on Shiprocket's
// OWN dashboard — that's account configuration on Shiprocket's side that
// this app has no way to control or verify from here. If
// `courier/assign/awb` fails for an international destination (e.g. no
// serviceable international courier enabled on the account), the error
// thrown below already surfaces Shiprocket's own failure `message`
// verbatim, so that reason will be visible to whoever is booking.
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
  item: {
    name: string;
    sku: string;
    units: number;
    sellingPrice: number;
    // 2026-09-08: HSN/customs tariff code, commonly required on
    // export/customs documentation for an international shipment. Optional
    // and additive — see the `hsn` comment at the order_items[] call site
    // below for why the exact field name is unconfirmed against a live
    // account.
    hsnCode?: string | null;
  };
  paymentMethod: "Prepaid" | "COD";
  subTotal: number;
  packageWeightKg: number;
  packageDimsCm: { length: number; width: number; height: number };
};

export type ShiprocketShipResult = {
  success: boolean;
  trackingNo: string | null;
  // 2026-10-26 — Shiprocket's OWN shipment id, the number to look this parcel
  // up with inside Shiprocket's dashboard/API, kept beside the partner
  // courier's tracking number in trackingNo (Shiprocket allocates an AWB from
  // whichever logistics partner it picked, so the two genuinely differ).
  // Stored as `SR-<shipment_id>` — the id alone is a bare integer that would
  // be indistinguishable from a PO/RF number anywhere else in the app.
  // See db/2026-10-26-order-shipment-forwarding-no.sql.
  forwardingNo: string | null;
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
      order_items: [
        {
          name: input.item.name,
          sku: input.item.sku,
          units: input.item.units,
          selling_price: input.item.sellingPrice,
          // Best-effort, unconfirmed against a live account — same caveat
          // as parseAddOrderAmount in shipglobal.ts: `hsn` is the field
          // name Shiprocket's docs use elsewhere for this concept, but no
          // live order_items[] response/request pair confirms it's the
          // right key for THIS endpoint specifically. Only sent when the
          // caller actually has an HSN code to offer (never guessed), and
          // if the key name turns out to be wrong once tried against a
          // real account, REST APIs typically just ignore an unrecognized
          // JSON key rather than reject the request — so this is low-risk
          // to ship unconfirmed, but say so plainly rather than implying
          // it's verified.
          ...(input.item.hsnCode ? { hsn: input.item.hsnCode } : {}),
        },
      ],
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
    forwardingNo: orderParsed.shipment_id ? `SR-${orderParsed.shipment_id}` : null,
    labelUrl: null,
    bookedAmt: typeof data.freight_charges === "number" ? data.freight_charges : null,
    bookedCurrency: typeof data.freight_charges === "number" ? "INR" : null,
    raw: { order: orderParsed, awb: awbParsed },
  };
}
