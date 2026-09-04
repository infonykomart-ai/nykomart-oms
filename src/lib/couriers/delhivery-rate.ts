// Delhivery Invoice/Charges Estimator — a QUOTE-ONLY call (no shipment/AWB
// created), same `Authorization: Token <DELHIVERY_API_TOKEN>` header as
// the existing Shipment-creation client (delhivery-ship.ts). Delhivery is
// India-domestic only in this app (see delhivery-ship.ts), so this quote
// is only meaningful for an India-to-India route.
//
// UNVERIFIED against a real Delhivery account — built from Delhivery's own
// readme.io docs, but two sources disagreed on what the `md` query param
// means (payment mode E/S vs. service-type Express/Surface) and neither
// showed a populated example response, so `md=E` and the `total_amount`
// response field below are a best guess flagged explicitly, not a
// confirmed shape. Delhivery's own docs describe the results as
// "approximated values only" even when working correctly.
import { getDelhiveryApiToken } from "@/lib/couriers/delhivery-ship";
import type { RateQuoteInput, RateQuoteResult } from "@/lib/couriers/rate-quote-types";

const DELHIVERY_API_BASE = process.env.DELHIVERY_API_BASE_URL || "https://track.delhivery.com";

export async function getDelhiveryRateQuote(input: RateQuoteInput, credentials?: { api_token?: string }): Promise<RateQuoteResult> {
  try {
    const token = getDelhiveryApiToken(credentials?.api_token);

    const params = new URLSearchParams({
      md: "E", // prepaid, per Delhivery's docs — see header comment on ambiguity
      ss: "Delivered",
      o_pin: input.originPostalCode,
      d_pin: input.destPostalCode,
      cgm: String(Math.round(input.weightKg * 1000)), // grams
    });

    const res = await fetch(`${DELHIVERY_API_BASE}/api/kinko/v1/invoice/charges/.json?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: `Token ${token}` },
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, error: `Delhivery Charges Estimator failed ${res.status}: ${text.slice(0, 300)}` };

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: "Delhivery Charges Estimator returned a non-JSON response." };
    }
    // Response nesting was never confirmed against a real populated
    // example (see header comment) — probe a few plausible shapes rather
    // than assume one, and fail honestly if none match.
    const row = Array.isArray(parsed) ? parsed[0] : parsed;
    const amount = (row as { total_amount?: number; charge?: number })?.total_amount ?? (row as { charge?: number })?.charge;
    if (amount == null || !Number.isFinite(Number(amount))) {
      return { ok: false, error: "Delhivery Charges Estimator returned an unrecognized response shape." };
    }
    return { ok: true, amount: Number(amount), currency: "INR" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Delhivery rate quote failed." };
  }
}
