// DHL Express MyDHL API `/rates` — a QUOTE-ONLY call (no shipment/AWB
// created), same Basic Auth (Consumer Key/Secret = DHL_EXPRESS_USERNAME/
// PASSWORD) and same API base as the existing Shipment-creation client
// (dhl-ship.ts) — NOT the same credential as DHL_API_KEY, which only
// covers DHL's Tracking API (see dhl-ship.ts's own header comment).
//
// UNVERIFIED against a real DHL account — DHL's full API reference is
// gated behind a developer-portal login, so this was built from secondary
// sources (Postman/community collections, ShipEngine's carrier guide) that
// agree with each other and with dhl-ship.ts's own defensive price-
// extraction shape, but none is DHL's own primary reference doc. Whether
// Rating access is automatically included with Shipment-creation account
// enablement, or gated separately, is unconfirmed — flag to whoever holds
// the DHL developer account if this consistently fails.
import { getDhlExpressCredentials, DHL_EXPRESS_API_BASE } from "@/lib/couriers/dhl-ship";
import type { RateQuoteInput, RateQuoteResult } from "@/lib/couriers/rate-quote-types";

export async function getDhlRateQuote(
  input: RateQuoteInput,
  credentials?: { username?: string; password?: string; account_number?: string }
): Promise<RateQuoteResult> {
  try {
    const accountNumber = credentials?.account_number;
    if (!accountNumber) return { ok: false, error: "DHL Account Number not set up (Account Setup tab)." };
    const { username, password } = getDhlExpressCredentials({ username: credentials?.username, password: credentials?.password });

    const params = new URLSearchParams({
      accountNumber,
      originCountryCode: input.originCountryCode,
      originPostalCode: input.originPostalCode,
      destinationCountryCode: input.destCountryCode,
      destinationPostalCode: input.destPostalCode,
      weight: String(input.weightKg),
      length: "10",
      width: "10",
      height: "10",
      plannedShippingDate: new Date().toISOString().slice(0, 10),
      isCustomsDeclarable: String(input.originCountryCode !== input.destCountryCode),
      unitOfMeasurement: "metric",
    });

    const res = await fetch(`${DHL_EXPRESS_API_BASE}/rates?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` },
    });
    const text = await res.text();
    let parsed: { products?: Array<{ totalPrice?: Array<{ price?: number; priceCurrency?: string }> }>; detail?: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: `DHL Rates API returned a non-JSON response (${res.status}).` };
    }
    if (!res.ok) return { ok: false, error: `DHL Rates API: ${parsed.detail || `HTTP ${res.status}`}` };

    const prices = (parsed.products ?? []).flatMap((p) => p.totalPrice ?? []).filter((p) => p.price != null && p.priceCurrency);
    if (prices.length === 0) return { ok: false, error: "DHL Rates API returned no priced product for this route." };
    const cheapest = prices.reduce((min, cur) => ((cur.price as number) < (min.price as number) ? cur : min));
    return { ok: true, amount: cheapest.price as number, currency: cheapest.priceCurrency as string };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "DHL rate quote failed." };
  }
}
