// 2026-10-15b — live FX rates for the Amazon Country-wise ad spend view:
// "TOTAL BUDGET KITNA HUA ... PERFECT CALCULATION SE ACTUAL CONVERSION KE
// HISAB SE JO DAILY BASIS PAR UPDATE HO AUTOMATICLLY GOOGLE SE".
//
// How it stays current WITHOUT a cron job: every reader that needs a rate
// calls loadFxSnapshot(); if the cached snapshot is missing or older than
// 12 hours it pulls a fresh one from the provider and writes it back, so the
// numbers are at most a day old on any screen that is actually opened. A
// refresh that fails NEVER breaks the page — the (possibly older) cached
// values are returned with `stale: true` and the UI says so.
//
// Provider: https://open.er-api.com/v6/latest/USD — keyless, updates once a
// day, and returns the provider's own last/next update stamps, which is what
// lets the UI print exactly when the market rate moved. Rates are cached with
// base USD (that is the free endpoint's base); any cross rate is derived:
// 1 GBP in INR = usdToInr / usdToGbp.
//
// IMPORTANT — this is NOT the customs/legal rate. exchange_rates (master, with
// CBIC notification no., entered by Finance) stays the only source for invoice
// and valuation maths; see db/2026-10-15b-fx-rate-cache.sql.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export const FX_BASE_CURRENCY = "USD";
/** What the UI prints as the rate source. */
export const FX_SOURCE_LABEL = "live market rates (open.er-api.com)";
/** Refresh threshold — the provider itself only updates once a day. */
export const FX_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const FX_ENDPOINT = "https://open.er-api.com/v6/latest/USD";
const FX_TIMEOUT_MS = 8000;

export type FxSnapshot = {
  /** Units of each requested currency that 1 USD buys. */
  perUsd: Record<string, number>;
  /** 1 USD in INR — the currency this app's books are kept in. */
  usdToInr: number | null;
  /** 1 unit of each requested currency in INR (derived cross rate). */
  toInr: Record<string, number>;
  source: string;
  /** When this app last pulled the rates. */
  fetchedAt: string | null;
  /** The provider's own "rates last changed" stamp. */
  marketUpdatedAt: string | null;
  /** true when the live refresh failed and cached values are being shown. */
  stale: boolean;
  /** Set when the refresh attempt failed (surfaced in the UI as a note). */
  warning: string | null;
};

export const EMPTY_FX: FxSnapshot = {
  perUsd: {},
  usdToInr: null,
  toInr: {},
  source: FX_SOURCE_LABEL,
  fetchedAt: null,
  marketUpdatedAt: null,
  stale: true,
  warning: "No exchange rates available yet — press Refresh rates.",
};

type RateRow = { quote_currency: string; rate: number; fetched_at: string; market_updated_at: string | null; source: string };

function snapshotFromRows(rows: RateRow[], currencies: string[], stale: boolean, warning: string | null): FxSnapshot {
  const perUsd: Record<string, number> = { USD: 1 };
  let fetchedAt: string | null = null;
  let marketUpdatedAt: string | null = null;
  let source = FX_SOURCE_LABEL;
  for (const row of rows) {
    perUsd[row.quote_currency] = Number(row.rate);
    // The newest row wins for the "as of" stamps — every row is written by the
    // same refresh, but a partial/failed write must not move the date backwards.
    if (!fetchedAt || row.fetched_at > fetchedAt) fetchedAt = row.fetched_at;
    if (row.market_updated_at && (!marketUpdatedAt || row.market_updated_at > marketUpdatedAt)) {
      marketUpdatedAt = row.market_updated_at;
    }
    if (row.source) source = row.source;
  }
  const usdToInr = perUsd.INR ?? null;
  const toInr: Record<string, number> = {};
  if (usdToInr) {
    for (const code of currencies) {
      const perUsdFor = perUsd[code];
      if (perUsdFor) toInr[code] = usdToInr / perUsdFor;
    }
  }
  return { perUsd, usdToInr, toInr, source, fetchedAt, marketUpdatedAt, stale, warning };
}

async function fetchLiveRates(): Promise<{ rates: Record<string, number>; marketUpdatedAt: string | null } | null> {
  try {
    const res = await fetch(FX_ENDPOINT, {
      cache: "no-store",
      signal: AbortSignal.timeout(FX_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      result?: string;
      rates?: Record<string, number>;
      time_last_update_unix?: number;
    };
    if (json.result !== "success" || !json.rates || typeof json.rates !== "object") return null;
    const marketUpdatedAt =
      typeof json.time_last_update_unix === "number" ? new Date(json.time_last_update_unix * 1000).toISOString() : null;
    return { rates: json.rates, marketUpdatedAt };
  } catch {
    return null; // network/timeout/parse — the caller falls back to the cache
  }
}

/**
 * Rates-to-INR snapshot for the given currencies (INR is always included).
 * Reads the cache, refreshes it when stale (or when `force` is set), and never
 * throws: a failed refresh degrades to whatever is cached.
 */
export async function loadFxSnapshot(
  supabase: SupabaseClient<Database>,
  currencies: string[],
  opts: { force?: boolean } = {}
): Promise<FxSnapshot> {
  const wanted = Array.from(new Set(["INR", ...currencies.map((c) => c.toUpperCase())]));
  const { data } = await supabase
    .from("fx_rate_cache")
    .select("quote_currency, rate, fetched_at, market_updated_at, source")
    .eq("base_currency", FX_BASE_CURRENCY)
    .in("quote_currency", wanted);

  const rows = (data ?? []) as RateRow[];
  const newest = rows.reduce<string | null>((acc, r) => (!acc || r.fetched_at > acc ? r.fetched_at : acc), null);
  const ageMs = newest ? Date.now() - new Date(newest).getTime() : Number.POSITIVE_INFINITY;
  const needsRefresh = opts.force === true || ageMs > FX_MAX_AGE_MS || rows.length < wanted.length;

  if (!needsRefresh) return snapshotFromRows(rows, wanted, false, null);

  const live = await fetchLiveRates();
  if (!live) {
    const snapshot = snapshotFromRows(rows, wanted, true, "Live rates could not be fetched just now — showing the last saved rates.");
    return rows.length > 0 ? snapshot : { ...EMPTY_FX, warning: snapshot.warning };
  }

  const fetchedAt = new Date().toISOString();
  const writes = wanted
    .filter((code) => typeof live.rates[code] === "number" && live.rates[code] > 0)
    .map((code) => ({
      base_currency: FX_BASE_CURRENCY,
      quote_currency: code,
      rate: live.rates[code],
      source: FX_SOURCE_LABEL,
      market_updated_at: live.marketUpdatedAt,
      fetched_at: fetchedAt,
    }));

  if (writes.length > 0) {
    // Best-effort: a write failure (e.g. the migration has not been run yet)
    // must not break the page — we still show the freshly fetched numbers.
    await supabase.from("fx_rate_cache").upsert(writes, { onConflict: "base_currency,quote_currency" });
  }

  const fresh = snapshotFromRows(
    writes.map((w) => ({
      quote_currency: w.quote_currency,
      rate: w.rate,
      fetched_at: w.fetched_at,
      market_updated_at: w.market_updated_at,
      source: w.source,
    })),
    wanted,
    false,
    null
  );
  return fresh.usdToInr ? fresh : { ...fresh, warning: "The rate provider did not return an INR rate." };
}

/** The 1-USD-in-INR number formatted for display, e.g. "₹95.25". */
export function formatUsdToInr(snapshot: FxSnapshot | null | undefined): string {
  if (!snapshot?.usdToInr) return "—";
  return `₹${snapshot.usdToInr.toFixed(2)}`;
}
