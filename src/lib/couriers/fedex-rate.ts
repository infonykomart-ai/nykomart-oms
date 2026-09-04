// FedEx Rate API v1 — a QUOTE-ONLY call (no shipment/AWB created), built
// from FedEx's publicly documented Rate API (developer.fedex.com/api/en-
// us/catalog/rate.html), same OAuth2 app and same API base as the existing
// Ship API client (fedex-ship.ts) — see fedex-auth.ts's header comment on
// why the same client credentials cover multiple FedEx API products.
//
// UNVERIFIED against a real FedEx account — built from FedEx's public
// docs/samples, same "plausible, not confirmed" standard as fedex-ship.ts
// itself (2026-09-01) and the Delhivery/Shiprocket label integrations
// (2026-09-03, §27). One real caveat found during research: the Rate API
// is a SEPARATE product toggle on FedEx's developer portal from the Ship
// API — if this deployment's FedEx developer project only ever enabled
// Ship (and Track), this call may 401/403 even though the OAuth token
// itself is issued fine (same client_id/secret). That is a portal-side
// enablement question for whoever holds the FedEx developer account, not
// a bug in this code.
import { getFedexAccessToken, FEDEX_API_BASE } from "@/lib/couriers/fedex-auth";
import type { RateQuoteInput, RateQuoteResult } from "@/lib/couriers/rate-quote-types";

export async function getFedexRateQuote(
  input: RateQuoteInput,
  credentials?: { client_id?: string; client_secret?: string; account_number?: string }
): Promise<RateQuoteResult> {
  try {
    const accountNumber = credentials?.account_number;
    if (!accountNumber) return { ok: false, error: "FedEx Account Number not set up (Account Setup tab)." };

    const accessToken = await getFedexAccessToken({ clientId: credentials?.client_id, clientSecret: credentials?.client_secret });

    const body = {
      accountNumber: { value: accountNumber },
      rateRequestControlParameters: { returnTransitTimes: false },
      requestedShipment: {
        shipper: { address: { postalCode: input.originPostalCode, countryCode: input.originCountryCode } },
        recipient: { address: { postalCode: input.destPostalCode, countryCode: input.destCountryCode } },
        pickupType: "USE_SCHEDULED_PICKUP",
        rateRequestType: ["ACCOUNT", "LIST"],
        requestedPackageLineItems: [{ weight: { units: "KG", value: input.weightKg } }],
      },
    };

    const res = await fetch(`${FEDEX_API_BASE}/rate/v1/rates/quotes`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "X-locale": "en_US" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: {
      output?: { rateReplyDetails?: Array<{ ratedShipmentDetails?: Array<{ totalNetCharge?: { amount?: number; currency?: string } }> }> };
      errors?: Array<{ message?: string }>;
    };
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: `FedEx Rate API returned a non-JSON response (${res.status}).` };
    }
    if (!res.ok) {
      const msg = parsed.errors?.map((e) => e.message).filter(Boolean).join("; ") || `HTTP ${res.status}`;
      return { ok: false, error: `FedEx Rate API: ${msg}` };
    }

    const details = parsed.output?.rateReplyDetails ?? [];
    const charge = details.flatMap((d) => d.ratedShipmentDetails ?? []).map((r) => r.totalNetCharge).find((c) => c?.amount != null);
    if (!charge?.amount || !charge.currency) return { ok: false, error: "FedEx Rate API returned no priced rate for this route." };
    return { ok: true, amount: charge.amount, currency: charge.currency };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "FedEx rate quote failed." };
  }
}
