// UPS Rating API — a QUOTE-ONLY call (no shipment/AWB created), built from
// UPS's own published OpenAPI spec (Rating.yaml, UPS-API/api-documentation
// on GitHub), same OAuth2 app and API base as the existing Ship API client
// (ups-ship.ts). Uses the "Shop" request option so ALL of UPS's own
// available services come back in one call, and this returns the cheapest
// of them.
//
// UNVERIFIED against a real UPS account — built from UPS's public OpenAPI
// spec, same "plausible, not confirmed" standard as ups-ship.ts itself.
// Caveat found during research: Rating is a separate API "product" from
// Shipping on UPS's developer portal — if this deployment's UPS app only
// ever had Shipping granted, this call may fail even with a valid token.
import { getUpsAccessToken, UPS_API_BASE } from "@/lib/couriers/ups-ship";
import type { RateQuoteInput, RateQuoteResult } from "@/lib/couriers/rate-quote-types";

export async function getUpsRateQuote(
  input: RateQuoteInput,
  credentials?: { client_id?: string; client_secret?: string; shipper_number?: string }
): Promise<RateQuoteResult> {
  try {
    const accessToken = await getUpsAccessToken({ clientId: credentials?.client_id, clientSecret: credentials?.client_secret });

    const body = {
      RateRequest: {
        Request: { TransactionReference: { CustomerContext: "Rate compare" } },
        Shipment: {
          Shipper: {
            Address: { PostalCode: input.originPostalCode, CountryCode: input.originCountryCode },
            ...(credentials?.shipper_number ? { ShipperNumber: credentials.shipper_number } : {}),
          },
          ShipTo: { Address: { PostalCode: input.destPostalCode, CountryCode: input.destCountryCode } },
          ShipFrom: { Address: { PostalCode: input.originPostalCode, CountryCode: input.originCountryCode } },
          Package: [
            {
              PackagingType: { Code: "02" },
              PackageWeight: { UnitOfMeasurement: { Code: "KGS" }, Weight: String(input.weightKg) },
            },
          ],
        },
      },
    };

    const res = await fetch(`${UPS_API_BASE}/api/rating/v2409/Shop`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: {
      RateResponse?: { RatedShipment?: Array<{ TotalCharges?: { MonetaryValue?: string; CurrencyCode?: string } }> };
      response?: { errors?: Array<{ message?: string }> };
    };
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: `UPS Rating API returned a non-JSON response (${res.status}).` };
    }
    if (!res.ok) {
      const msg = parsed.response?.errors?.map((e) => e.message).filter(Boolean).join("; ") || `HTTP ${res.status}`;
      return { ok: false, error: `UPS Rating API: ${msg}` };
    }

    const rated = parsed.RateResponse?.RatedShipment ?? [];
    const amounts = rated
      .map((r) => ({ amount: Number(r.TotalCharges?.MonetaryValue), currency: r.TotalCharges?.CurrencyCode }))
      .filter((r): r is { amount: number; currency: string } => Number.isFinite(r.amount) && !!r.currency);
    if (amounts.length === 0) return { ok: false, error: "UPS Rating API returned no priced service for this route." };
    const cheapest = amounts.reduce((min, cur) => (cur.amount < min.amount ? cur : min));
    return { ok: true, amount: cheapest.amount, currency: cheapest.currency };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "UPS rate quote failed." };
  }
}
