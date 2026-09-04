// Shiprocket "Check Courier Serviceability & Rates" — a QUOTE-ONLY call
// (no shipment/AWB created), reuses the same email/password login as the
// existing Shipment-creation client (shiprocket-ship.ts). India-domestic
// only in this app (see shiprocket-ship.ts).
//
// Shiprocket itself aggregates several logistics partners under one
// account (its own Delhivery/Xpressbees/Ecom Express/etc relationships —
// NOT the same as this app's own separate Delhivery integration) and this
// serviceability endpoint returns one row PER PARTNER with its own rate.
// For this app's "compare 6 couriers" view, Shiprocket is presented as ONE
// row (consistent with how it appears everywhere else in this app) — this
// returns Shiprocket's cheapest available partner rate as "Shiprocket"'s
// quote, plus which partner it was, for context.
//
// UNVERIFIED against a real Shiprocket account — built from Shiprocket's
// public Postman workspace + a corroborating public integration example,
// the highest-confidence of this round's new rate-quote files, but still
// never called with real credentials from this app.
import { shiprocketLogin, SHIPROCKET_API_BASE } from "@/lib/couriers/shiprocket-ship";
import type { RateQuoteInput, RateQuoteResult } from "@/lib/couriers/rate-quote-types";

export async function getShiprocketRateQuote(
  input: RateQuoteInput,
  credentials?: { email?: string; password?: string }
): Promise<RateQuoteResult> {
  try {
    const token = await shiprocketLogin({ email: credentials?.email, password: credentials?.password });

    const params = new URLSearchParams({
      pickup_postcode: input.originPostalCode,
      delivery_postcode: input.destPostalCode,
      weight: String(input.weightKg),
      cod: "0",
    });

    const res = await fetch(`${SHIPROCKET_API_BASE}/courier/serviceability/?${params.toString()}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    let parsed: { data?: { available_courier_companies?: Array<{ courier_name?: string; rate?: number; freight_charge?: number }> }; message?: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, error: `Shiprocket Serviceability API returned a non-JSON response (${res.status}).` };
    }
    if (!res.ok) return { ok: false, error: `Shiprocket Serviceability API: ${parsed.message || `HTTP ${res.status}`}` };

    const options = (parsed.data?.available_courier_companies ?? [])
      .map((c) => ({ name: c.courier_name, price: c.rate ?? c.freight_charge }))
      .filter((c): c is { name: string; price: number } => c.price != null && Number.isFinite(c.price));
    if (options.length === 0) return { ok: false, error: "Shiprocket returned no serviceable courier partner for this route." };
    const cheapest = options.reduce((min, cur) => (cur.price < min.price ? cur : min));
    return { ok: true, amount: cheapest.price, currency: "INR" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Shiprocket rate quote failed." };
  }
}
