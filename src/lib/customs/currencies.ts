// Currency support for the Indian Customs rate module.
//
// The four currencies the module ships with are listed first; every other
// currency CBIC currently notifies is kept here so the register can grow
// without a schema change (customs_exchange_rates.currency_code is an FK to
// the existing `currencies` table). Adding a currency = adding an entry here
// (or inserting the row into `currencies` and extending this list).
import type { SupportedCurrency } from "./types";

export const SUPPORTED_CURRENCIES: SupportedCurrency[] = [
  { code: "USD", name: "US Dollar", unit: 1 },
  { code: "EUR", name: "Euro", unit: 1 },
  { code: "GBP", name: "British Pound Sterling", unit: 1 },
  { code: "AED", name: "UAE Dirham", unit: 1 },
  // Currencies the CBIC notifications quote per 100 units.
  { code: "JPY", name: "Japanese Yen", unit: 100 },
  { code: "KRW", name: "Korean Won", unit: 100 },
  // Remaining currencies routinely published by CBIC, per 1 unit.
  { code: "AUD", name: "Australian Dollar", unit: 1 },
  { code: "CAD", name: "Canadian Dollar", unit: 1 },
  { code: "CHF", name: "Swiss Franc", unit: 1 },
  { code: "CNY", name: "Chinese Yuan", unit: 1 },
  { code: "HKD", name: "Hong Kong Dollar", unit: 1 },
  { code: "SGD", name: "Singapore Dollar", unit: 1 },
  { code: "NZD", name: "New Zealand Dollar", unit: 1 },
  { code: "SAR", name: "Saudi Riyal", unit: 1 },
  { code: "QAR", name: "Qatari Riyal", unit: 1 },
  { code: "KWD", name: "Kuwaiti Dinar", unit: 1 },
  { code: "BHD", name: "Bahraini Dinar", unit: 1 },
  { code: "OMR", name: "Omani Rial", unit: 1 },
  { code: "SEK", name: "Swedish Krona", unit: 1 },
  { code: "DKK", name: "Danish Krone", unit: 1 },
  { code: "NOK", name: "Norwegian Krone", unit: 1 },
  { code: "ZAR", name: "South African Rand", unit: 1 },
  { code: "TRY", name: "Turkish Lira", unit: 1 },
  { code: "THB", name: "Thai Baht", unit: 1 },
  { code: "MYR", name: "Malaysian Ringgit", unit: 1 },
  { code: "IDR", name: "Indonesian Rupiah", unit: 1 },
  { code: "PHP", name: "Philippine Peso", unit: 1 },
  { code: "TWD", name: "Taiwan Dollar", unit: 1 },
  { code: "LKR", name: "Sri Lankan Rupee", unit: 1 },
  { code: "BDT", name: "Bangladeshi Taka", unit: 1 },
  { code: "NPR", name: "Nepalese Rupee", unit: 1 },
  { code: "PKR", name: "Pakistani Rupee", unit: 1 },
  { code: "EGP", name: "Egyptian Pound", unit: 1 },
  { code: "KES", name: "Kenyan Shilling", unit: 1 },
  { code: "NGN", name: "Nigerian Naira", unit: 1 },
  { code: "RUB", name: "Russian Ruble", unit: 1 },
  { code: "BRL", name: "Brazilian Real", unit: 1 },
  { code: "MXN", name: "Mexican Peso", unit: 1 },
  { code: "ILS", name: "Israeli Shekel", unit: 1 },
];

const BY_CODE = new Map(SUPPORTED_CURRENCIES.map((c) => [c.code, c]));
const BY_NAME = new Map(SUPPORTED_CURRENCIES.map((c) => [normalizeName(c.name), c]));

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ")
    .replace(/\s*\(\s*\d+\s*\)\s*$/, "")
    .trim();
}

/** Extra spellings that appear in CBIC notifications and ICEGATE screens. */
const NAME_ALIASES: Record<string, string> = {
  "us dollar": "USD",
  "u s dollar": "USD",
  "usd": "USD",
  "dollar": "USD",
  "euro": "EUR",
  "pound sterling": "GBP",
  "sterling pound": "GBP",
  "british pound": "GBP",
  "great britain pound": "GBP",
  "uae dirham": "AED",
  "u a e dirham": "AED",
  "dirham": "AED",
  "japanese yen": "JPY",
  "yen": "JPY",
  "korean won": "KRW",
  "won": "KRW",
  "chinese yuan": "CNY",
  "chinese renminbi": "CNY",
  "renminbi": "CNY",
  "saudi riyal": "SAR",
  "saudi arabian riyal": "SAR",
  "qatari riyal": "QAR",
  "kuwaiti dinar": "KWD",
  "bahraini dinar": "BHD",
  "omani rial": "OMR",
  "hong kong dollar": "HKD",
  "singapore dollar": "SGD",
  "new zealand dollar": "NZD",
  "australian dollar": "AUD",
  "canadian dollar": "CAD",
  "swiss franc": "CHF",
  "south african rand": "ZAR",
  "sri lankan rupee": "LKR",
  "bangladesh taka": "BDT",
  "bangladeshi taka": "BDT",
  "nepalese rupee": "NPR",
  "nepal rupee": "NPR",
  "pakistani rupee": "PKR",
  "turkish lira": "TRY",
  "russian rouble": "RUB",
  "russian ruble": "RUB",
  "thai baht": "THB",
  "malaysian ringgit": "MYR",
  "indonesian rupiah": "IDR",
  "philippine peso": "PHP",
  "taiwan dollar": "TWD",
  "danish krone": "DKK",
  "danish kroner": "DKK",
  "norwegian krone": "NOK",
  "norwegian kroner": "NOK",
  "swedish krona": "SEK",
  "swedish kroner": "SEK",
  "egyptian pound": "EGP",
  "kenyan shilling": "KES",
  "nigerian naira": "NGN",
  "brazilian real": "BRL",
  "mexican peso": "MXN",
  "israeli shekel": "ILS",
};

/**
 * Resolves a currency code from an ISO code, a CBIC currency name, or a name
 * carrying its quote unit ("Japanese Yen (100)"). Returns null for anything
 * this module does not support — the caller must treat that as invalid rather
 * than guessing.
 */
export function resolveCurrency(raw: string): { currency: SupportedCurrency; unitFromName: number | null } | null {
  const input = String(raw ?? "").trim();
  if (!input) return null;

  const unitMatch = input.match(/\(\s*(\d+)\s*\)/);
  const unitFromName = unitMatch ? Number(unitMatch[1]) : null;

  const codeCandidate = input.toUpperCase().replace(/\s+/g, " ").trim();
  if (/^[A-Z]{3}$/.test(codeCandidate)) {
    const byCode = BY_CODE.get(codeCandidate);
    return byCode ? { currency: byCode, unitFromName } : null;
  }

  const key = normalizeName(input);
  const alias = NAME_ALIASES[key];
  if (alias) {
    const byCode = BY_CODE.get(alias);
    if (byCode) return { currency: byCode, unitFromName };
  }
  const byName = BY_NAME.get(key);
  return byName ? { currency: byName, unitFromName } : null;
}

export function isSupportedCurrency(code: string): boolean {
  return BY_CODE.has(String(code ?? "").toUpperCase());
}

export function currencyInfo(code: string): SupportedCurrency | null {
  return BY_CODE.get(String(code ?? "").toUpperCase()) ?? null;
}

/** The four currencies the module's "Current Rates" section always shows. */
export const PRIMARY_CURRENCY_CODES = ["USD", "EUR", "GBP", "AED"] as const;

export function supportedCurrencyCodes(): string[] {
  return SUPPORTED_CURRENCIES.map((c) => c.code);
}
