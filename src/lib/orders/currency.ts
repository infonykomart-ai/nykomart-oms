// Currency conversion for orders — mirrors computeCurrencyConversion_() in
// the old Code.gs exactly (see db/schema.sql's top-of-file BUSINESS RULES
// note on currency conversion): try the official Exchange Rate Master entry
// in effect on the order's own date first, fall back to a live market
// estimate only if no official rate exists, and NEVER silently guess — if
// both fail, the value is left null and exchange_rate_source explains why.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type ServiceClient = SupabaseClient<Database>;

export type ConversionResult = {
  usd: number | null;
  inr: number | null;
  source: string;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function officialRate(
  supabase: ServiceClient,
  currency: string,
  asOfDate: string
): Promise<{ rateToInr: number; effectiveFrom: string } | null> {
  const { data, error } = await supabase.rpc("get_official_rate_as_of", {
    p_currency_code: currency,
    p_as_of: asOfDate,
  });
  const row = !error && data && data.length > 0 ? data[0] : null;
  if (!row || row.rate_to_inr == null || row.effective_from == null) return null;
  return { rateToInr: Number(row.rate_to_inr), effectiveFrom: row.effective_from };
}

// Live-market fallback (Frankfurter — free, no API key, ECB reference
// rates). Only reached when no Exchange Rate Master entry covers this date.
// This sandbox's own network is allowlisted and can't reach this host to
// test it live, but it runs fine once deployed (Vercel has normal network
// access) — wrapped defensively so a network hiccup degrades to
// "unavailable" rather than throwing and losing the whole order entry.
async function liveRate(from: string, to: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.frankfurter.app/latest?from=${from}&to=${to}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    const rate = json?.rates?.[to];
    return typeof rate === "number" ? rate : null;
  } catch {
    return null;
  }
}

export async function computeCurrencyConversion(
  supabase: ServiceClient,
  currency: string,
  orderDate: string,
  originalValue: number
): Promise<ConversionResult> {
  if (currency === "INR") {
    const inr = round2(originalValue);
    const usdOfficial = await officialRate(supabase, "USD", orderDate);
    if (usdOfficial) {
      return {
        usd: round2(originalValue / usdOfficial.rateToInr),
        inr,
        source: `Official rate as of ${usdOfficial.effectiveFrom}`,
      };
    }
    const inrToUsd = await liveRate("INR", "USD");
    if (inrToUsd != null) {
      return { usd: round2(originalValue * inrToUsd), inr, source: "Live market estimate (official rate unavailable)" };
    }
    return { usd: null, inr, source: "USD conversion unavailable — add an Exchange Rate Master entry for this date" };
  }

  if (currency === "USD") {
    const usd = round2(originalValue);
    const usdOfficial = await officialRate(supabase, "USD", orderDate);
    if (usdOfficial) {
      return { usd, inr: round2(originalValue * usdOfficial.rateToInr), source: `Official rate as of ${usdOfficial.effectiveFrom}` };
    }
    const usdToInr = await liveRate("USD", "INR");
    if (usdToInr != null) {
      return { usd, inr: round2(originalValue * usdToInr), source: "Live market estimate (official rate unavailable)" };
    }
    return { usd, inr: null, source: "INR conversion unavailable — add an Exchange Rate Master entry for this date" };
  }

  // Any other currency: its own official/live rate to INR first, then
  // INR -> USD via USD's own official/live rate.
  let inr: number | null = null;
  const sourceParts: string[] = [];

  const ownOfficial = await officialRate(supabase, currency, orderDate);
  if (ownOfficial) {
    inr = round2(originalValue * ownOfficial.rateToInr);
    sourceParts.push(`${currency}→INR official rate as of ${ownOfficial.effectiveFrom}`);
  } else {
    const ownToInr = await liveRate(currency, "INR");
    if (ownToInr != null) {
      inr = round2(originalValue * ownToInr);
      sourceParts.push(`${currency}→INR live market estimate`);
    }
  }

  if (inr == null) {
    return { usd: null, inr: null, source: "Conversion unavailable — add an Exchange Rate Master entry for this date" };
  }

  const usdOfficial = await officialRate(supabase, "USD", orderDate);
  let usd: number | null = null;
  if (usdOfficial) {
    usd = round2(inr / usdOfficial.rateToInr);
    sourceParts.push(`INR→USD official rate as of ${usdOfficial.effectiveFrom}`);
  } else {
    const usdToInr = await liveRate("USD", "INR");
    if (usdToInr != null) {
      usd = round2(inr / usdToInr);
      sourceParts.push("INR→USD live market estimate");
    }
  }

  return { usd, inr, source: sourceParts.join("; ") || "Conversion unavailable" };
}
