// 2026-11-17 — Etsy multilingual translation module: the ten target markets.
// One list, imported by the page, the client tabs, the Gemini route and the
// save validator, so a language can never be labelled differently in two
// places (a mismatch here would silently create two rows for one language).

export type EtsyLanguage = {
  /** Stored on etsy_product_translations.language_code. */
  code: string;
  /** English name — the tab label. */
  name: string;
  /** Name in its own language, shown as a subtitle on the tab. */
  native: string;
  /** Flag emoji for the tab strip. */
  flag: string;
  /** Which Etsy marketplace the SEO keywords should target. */
  market: string;
  /** Primary target country, as stored on etsy_seo_listings.country. */
  country: string;
  /** BCP-47 locale used for language checks and exports. */
  locale: string;
};

export const ETSY_LANGUAGES: EtsyLanguage[] = [
  { code: "nl", name: "Dutch", native: "Nederlands", flag: "🇳🇱", market: "the Netherlands / Belgium (Dutch-speaking)", country: "Netherlands", locale: "nl-NL" },
  { code: "fr", name: "French", native: "Français", flag: "🇫🇷", market: "France / Belgium / Canada (French-speaking)", country: "France", locale: "fr-FR" },
  { code: "de", name: "German", native: "Deutsch", flag: "🇩🇪", market: "Germany / Austria / Switzerland", country: "Germany", locale: "de-DE" },
  { code: "it", name: "Italian", native: "Italiano", flag: "🇮🇹", market: "Italy", country: "Italy", locale: "it-IT" },
  { code: "ja", name: "Japanese", native: "日本語", flag: "🇯🇵", market: "Japan", country: "Japan", locale: "ja-JP" },
  { code: "pl", name: "Polish", native: "Polski", flag: "🇵🇱", market: "Poland", country: "Poland", locale: "pl-PL" },
  { code: "pt", name: "Portuguese", native: "Português", flag: "🇵🇹", market: "Portugal / Brazil", country: "Portugal", locale: "pt-PT" },
  { code: "ru", name: "Russian", native: "Русский", flag: "🇷🇺", market: "Russia", country: "Russia", locale: "ru-RU" },
  { code: "es", name: "Spanish", native: "Español", flag: "🇪🇸", market: "Spain / Latin America", country: "Spain", locale: "es-ES" },
  { code: "sv", name: "Swedish", native: "Svenska", flag: "🇸🇪", market: "Sweden", country: "Sweden", locale: "sv-SE" },
];

export const ETSY_LANGUAGE_CODES = ETSY_LANGUAGES.map((l) => l.code);

export function etsyLanguage(code: string): EtsyLanguage | undefined {
  return ETSY_LANGUAGES.find((l) => l.code === code);
}

/** Project-level contract: ten localizations, one per market, no duplicates. */
export const REQUIRED_LOCALIZATION_COUNT = ETSY_LANGUAGES.length;

export function etsyLanguageByLocale(locale: string): EtsyLanguage | undefined {
  return ETSY_LANGUAGES.find((l) => l.locale.toLowerCase() === locale.toLowerCase());
}

/** Language names in the order the spec lists them. */
export const ETSY_LANGUAGE_NAMES = ETSY_LANGUAGES.map((l) => l.name);
