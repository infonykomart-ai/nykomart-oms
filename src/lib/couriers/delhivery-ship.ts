// Delhivery Create Shipment (CMU) API — real shipment creation, built from
// Delhivery's publicly documented REST API
// (track.delhivery.com/api/cmu/create.json — the same "One Point" API
// their own integration docs and public Postman collections describe).
// UNCONFIRMED against a real Delhivery account — no sample was provided
// for this round; built to the documented shape, not yet tested live.
//
// DOMESTIC-ONLY: unlike FedEx/UPS/Aramex/Shipglobal, Delhivery only ships
// within India — there is no DDP/DDU concept here at all (no customs
// border crossed), so this client's input type has no ddpDdu field, unlike
// the other 4 new couriers. Don't add one just for interface symmetry —
// it would always be meaningless for this courier specifically.
//
// AUTH: token-based (Authorization: Token <DELHIVERY_API_TOKEN>), not
// OAuth2 — the simplest of the 5 new couriers' auth schemes.
//
// BOOKED AMOUNT: per the task brief's own flag — Delhivery's Create
// Shipment API response does NOT return a quoted/charged freight amount
// (confirmed against Delhivery's public docs: the create.json response
// only echoes back waybill/status, no pricing field). This client
// therefore ALWAYS returns bookedAmt: null, same as Aramex — the caller
// always falls back to a Courier Rate Card estimate for Delhivery
// bookings specifically (see src/app/dashboard/courier-booking/actions.ts).

const DELHIVERY_API_BASE = process.env.DELHIVERY_API_BASE_URL || "https://track.delhivery.com";

export type DelhiveryShipInput = {
  pickupLocationName: string; // Delhivery requires a pre-registered "client name"/pickup location — DELHIVERY_CLIENT_NAME env var, see actions.ts
  paymentMode: "Prepaid" | "COD";
  consignee: {
    name: string;
    phone: string;
    address: string;
    city: string;
    state: string;
    pincode: string;
    country?: string; // Delhivery is domestic-only, but the field exists in their schema — always "India" in practice
  };
  packageWeightGrams: number;
  packageDimsCm: { length: number; width: number; height: number };
  productDescription: string;
  orderRefNo: string; // Delhivery's "order" field — this app's order ref_no
  codAmount?: number | null; // only relevant when paymentMode = 'COD'
  shipmentValue: number; // Delhivery's "total_amount" — the declared value of goods, not the freight charge
};

export type DelhiveryShipResult = {
  success: boolean;
  trackingNo: string | null; // Delhivery calls this "waybill"
  labelUrl: null; // Delhivery's create.json does not return a label directly — a separate packing-slip/label-print API call is needed, out of scope this round (flagged, not built)
  bookedAmt: null; // always — see header comment
  bookedCurrency: null;
  raw: unknown;
};

function getDelhiveryApiToken(): string {
  const token = process.env.DELHIVERY_API_TOKEN;
  if (!token) throw new Error("DELHIVERY_API_TOKEN is not set.");
  return token;
}

export async function createDelhiveryShipment(input: DelhiveryShipInput): Promise<DelhiveryShipResult> {
  const token = getDelhiveryApiToken();

  const shipment = {
    name: input.consignee.name,
    add: input.consignee.address,
    pin: input.consignee.pincode,
    city: input.consignee.city,
    state: input.consignee.state,
    country: input.consignee.country || "India",
    phone: input.consignee.phone,
    order: input.orderRefNo,
    payment_mode: input.paymentMode,
    cod_amount: input.paymentMode === "COD" ? input.codAmount ?? 0 : 0,
    total_amount: input.shipmentValue,
    products_desc: input.productDescription,
    weight: input.packageWeightGrams,
    shipment_length: input.packageDimsCm.length,
    shipment_width: input.packageDimsCm.width,
    shipment_height: input.packageDimsCm.height,
  };

  // Delhivery's create.json takes the payload as a `format=json&data=<JSON string>` urlencoded body — an unusual
  // shape confirmed across multiple public Delhivery integration write-ups/Postman collections, not a guess.
  const payload = { shipments: [shipment], pickup_location: { name: input.pickupLocationName } };
  const body = new URLSearchParams({ format: "json", data: JSON.stringify(payload) });

  const res = await fetch(`${DELHIVERY_API_BASE}/api/cmu/create.json`, {
    method: "POST",
    headers: {
      Authorization: `Token ${token}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const text = await res.text();
  let parsed: {
    success?: boolean;
    packages?: Array<{ waybill?: string; status?: string; remarks?: string[] }>;
    rmk?: string;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Delhivery Create Shipment returned non-JSON response (${res.status}): ${text.slice(0, 500)}`);
  }
  if (!res.ok || parsed.success === false) {
    const remarks = parsed.packages?.[0]?.remarks?.join("; ") ?? parsed.rmk ?? text.slice(0, 500);
    throw new Error(`Delhivery Create Shipment failed: ${remarks}`);
  }

  const pkg = parsed.packages?.[0];
  const trackingNo = pkg?.waybill ?? null;

  return {
    success: !!trackingNo,
    trackingNo,
    labelUrl: null,
    bookedAmt: null,
    bookedCurrency: null,
    raw: parsed,
  };
}
