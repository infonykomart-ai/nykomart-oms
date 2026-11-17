// 2026-11-18 — Project-level contract (spec §14): a completed project has
// EXACTLY ten localizations, one per market, each with the right locale.
// Pure functions so the rule is testable and reusable by the export and the
// validation route.

import { ETSY_LANGUAGES, etsyLanguage, REQUIRED_LOCALIZATION_COUNT } from "./languages";

export type LocalizationKey = { languageCode: string; locale?: string | null };

export type SetValidation = {
  ok: boolean;
  missing: string[];
  unexpected: string[];
  duplicates: string[];
  localeMismatch: Array<{ languageCode: string; expected: string; got: string }>;
  issues: string[];
};

export function validateLocalizationSet(items: LocalizationKey[]): SetValidation {
  const expected = ETSY_LANGUAGES.map((l) => l.code);
  const seen = new Map<string, number>();
  const localeMismatch: SetValidation["localeMismatch"] = [];

  for (const item of items) {
    seen.set(item.languageCode, (seen.get(item.languageCode) ?? 0) + 1);
    const language = etsyLanguage(item.languageCode);
    if (language && item.locale && item.locale.toLowerCase() !== language.locale.toLowerCase()) {
      localeMismatch.push({ languageCode: item.languageCode, expected: language.locale, got: item.locale });
    }
  }

  const missing = expected.filter((code) => !seen.has(code));
  const unexpected = [...seen.keys()].filter((code) => !expected.includes(code));
  const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([code]) => code);

  const issues: string[] = [];
  if (items.length !== REQUIRED_LOCALIZATION_COUNT) issues.push(`${items.length}/${REQUIRED_LOCALIZATION_COUNT} localizations present.`);
  if (missing.length > 0) issues.push(`Missing language(s): ${missing.join(", ")}.`);
  if (unexpected.length > 0) issues.push(`Unsupported language(s): ${unexpected.join(", ")}.`);
  if (duplicates.length > 0) issues.push(`Duplicate localization(s): ${duplicates.join(", ")}.`);
  for (const mismatch of localeMismatch) {
    issues.push(`${mismatch.languageCode}: locale ${mismatch.got} should be ${mismatch.expected}.`);
  }

  return { ok: issues.length === 0, missing, unexpected, duplicates, localeMismatch, issues };
}
