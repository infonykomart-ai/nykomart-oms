// 2026-10-15 — "AMAZON ME ALAG ALAG COUNTRY KE HISAB SE BUDGT & SPEND HOTA
// HAI TO USKA MERE HISAB SE COUNTRY SECTION OR BAN JAYE JO SIRF AMAZON PAR
// WORK KARE": Amazon runs one ad account per marketplace country, so an
// Amazon store's daily Budget/Spend is entered per country (see
// db/2026-10-15-ad-spend-amazon-country.sql for the column) while Etsy /
// eBay / Website stores keep the single per-day row they always had.
//
// One source of truth for the 12 countries the user listed, their ad-
// statement currency (which is how the marketplace statement data is keyed
// — see marketplace-fees.ts), and the two lookups the page needs:
//   * isAmazonStore(name)        — which stores get the Country field
//   * amazonCodeForCountry(label) — buyer country on an order → the Amazon
//                                  country bucket it belongs to, so a
//                                  country's SALES and its SPEND land on
//                                  the same row.
// Order-side country labels are normalized with daily-sheet-stats.ts's
// canonicalCountry() FIRST (that's the alias table that already merges
// "USA"/"United States"/"u.s.a."), so this file only needs the canonical
// spellings plus the "United States of America"-style long forms.

export type AmazonCountry = {
  /** Amazon marketplace country code — stored in store_ad_spend.country_code. */
  code: string;
  /** Display label used in the Country dropdown and the Country-wise table. */
  label: string;
  /** The ad/settlement statement currency for that marketplace. */
  currency: string;
};

// Order exactly as the user listed them.
export const AMAZON_COUNTRIES: AmazonCountry[] = [
  { code: "US", label: "USA (United States)", currency: "USD" },
  { code: "CA", label: "Canada", currency: "CAD" },
  { code: "MX", label: "Mexico", currency: "MXN" },
  { code: "AU", label: "Australia", currency: "AUD" },
  { code: "GB", label: "UK (United Kingdom)", currency: "GBP" },
  { code: "DE", label: "Germany", currency: "EUR" },
  { code: "IT", label: "Italy", currency: "EUR" },
  { code: "JP", label: "Japan", currency: "JPY" },
  { code: "FR", label: "France", currency: "EUR" },
  { code: "ES", label: "Spain", currency: "EUR" },
  { code: "IN", label: "India", currency: "INR" },
  { code: "AE", label: "UAE", currency: "AED" },
];

export const AMAZON_COUNTRY_CODES: string[] = AMAZON_COUNTRIES.map((c) => c.code);

/** Every currency an Amazon marketplace ad account can be billed in
 *  (2026-10-15b) — the set whose live rates the Country section converts at.
 *  This is exactly the Amazon country list's own currencies, so the two can
 *  never drift apart. */
export const AMAZON_CURRENCIES: string[] = Array.from(new Set(AMAZON_COUNTRIES.map((c) => c.currency)));

const BY_CODE = new Map(AMAZON_COUNTRIES.map((c) => [c.code, c]));

export function amazonCountryByCode(code: string | null | undefined): AmazonCountry | undefined {
  return code ? BY_CODE.get(code.toUpperCase()) : undefined;
}

/** What to print for a stored country_code — the marketplace's label, or the
 *  raw code if the row predates the list (never blank for a real code). */
export function amazonCountryLabel(code: string | null | undefined): string {
  if (!code) return "";
  return amazonCountryByCode(code)?.label ?? code;
}

export function amazonCurrencyForCountry(code: string | null | undefined): string | null {
  return amazonCountryByCode(code)?.currency ?? null;
}

/**
 * Canonical buyer-country label → Amazon country code. Keyed lower-case and
 * only with unambiguous spellings (same conservative rule as
 * daily-sheet-stats.ts's COUNTRY_ALIASES) — anything else returns "" and
 * lands in the Country-wise table's "Other" bucket rather than being
 * guessed into the wrong marketplace.
 */
const CODE_BY_CANONICAL_LABEL: Record<string, string> = {
  "united states": "US",
  "united states of america": "US",
  usa: "US",
  "u.s.a.": "US",
  canada: "CA",
  mexico: "MX",
  australia: "AU",
  "united kingdom": "GB",
  uk: "GB",
  england: "GB",
  germany: "DE",
  italy: "IT",
  japan: "JP",
  france: "FR",
  spain: "ES",
  india: "IN",
  "united arab emirates": "AE",
  uae: "AE",
};

export function amazonCodeForCountryLabel(label: string | null | undefined): string {
  const key = (label ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!key || key === "—") return "";
  return CODE_BY_CANONICAL_LABEL[key] ?? "";
}

/**
 * Which store rows are Amazon — same `/amazon/i.test(name)` convention the
 * Orders module already uses (see orders/new/page.tsx's storeIsAmazon), kept
 * here as well so the Ad Spend module has one named helper instead of an
 * inline regex at each call site.
 */
export function isAmazonStore(name: string | null | undefined): boolean {
  return /amazon/i.test(name ?? "");
}
