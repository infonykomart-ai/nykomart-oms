// Shiprocket Generate Label — a SEPARATE API call from
// createShiprocketShipment (shiprocket-ship.ts), which — per that file's
// own header comment — deliberately doesn't call this (flagged "out of
// scope this round" at the time). Built from Shiprocket's publicly
// documented `courier/generate/label` endpoint (apidocs.shiprocket.in).
//
// 2026-09-03: added at the owner's explicit request ("label generation
// bhi is round me try karo"). UNCONFIRMED against a real Shiprocket
// account, same caveat as shiprocket-ship.ts itself — no sample response
// was available, built to the documented shape only. Re-verify the
// response field names below the first time this runs against live
// credentials.
//
// Needs Shiprocket's own internal `shipment_id` (a number Shiprocket
// assigns at orders/create/adhoc time — NOT this app's AWB/tracking
// number). createShiprocketShipment's result.raw already captures this
// (`raw.order.shipment_id`, see shiprocket-ship.ts) and
// courier-booking/actions.ts persists `raw` into
// courier_shipments.response_payload — so a later "Generate Label" action
// reads shipment_id back out of that stored payload rather than needing a
// new column.

const SHIPROCKET_API_BASE = process.env.SHIPROCKET_API_BASE_URL || "https://apiv2.shiprocket.in/v1/external";

export type ShiprocketLabelResult = {
  success: boolean;
  labelUrl: string | null;
  raw: unknown;
};

async function shiprocketLoginForLabel(credentials?: { email?: string; password?: string }): Promise<string> {
  const email = credentials?.email || process.env.SHIPROCKET_EMAIL;
  const password = credentials?.password || process.env.SHIPROCKET_PASSWORD;
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

export async function generateShiprocketLabel(
  shiprocketShipmentId: number,
  credentials?: { email?: string; password?: string }
): Promise<ShiprocketLabelResult> {
  const token = await shiprocketLoginForLabel(credentials);

  const res = await fetch(`${SHIPROCKET_API_BASE}/courier/generate/label`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ shipment_id: [shiprocketShipmentId] }),
  });
  const text = await res.text();
  let parsed: { label_created?: number; label_url?: string; response?: string };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Shiprocket courier/generate/label returned non-JSON response (${res.status}): ${text.slice(0, 500)}`);
  }
  if (!res.ok || !parsed.label_url) {
    throw new Error(`Shiprocket courier/generate/label failed: ${parsed.response ?? text.slice(0, 500)}`);
  }

  return { success: true, labelUrl: parsed.label_url, raw: parsed };
}
