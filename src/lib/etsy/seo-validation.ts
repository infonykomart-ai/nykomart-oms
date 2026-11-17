// 2026-11-18 — Deterministic SEO validation for the Etsy International SEO
// Generator. NO AI is involved: every check below is a plain function, so the
// same listing always produces the same report and the AI can never mark its
// own homework. This is what decides pass / warning / fail and the 0–100 score
// shown in the UI, the validation report table and the export sheet.
//
// The score is OUR quality heuristic. It is NOT Etsy's ranking score and the UI
// says so — never present it as a promise of search placement.

import { charCount, REQUIRED_TAG_COUNT, TAG_MAX_CHARS, TITLE_MAX_CHARS } from "./validation";
import { etsyLanguage } from "./languages";

export type CheckStatus = "pass" | "warning" | "fail";

export type ScoreCategory = "title" | "keywords" | "tags" | "description" | "localization" | "alt_text" | "duplicates";

export const SCORE_WEIGHTS: Record<ScoreCategory, number> = {
  title: 20,
  keywords: 20,
  tags: 20,
  description: 15,
  localization: 10,
  alt_text: 10,
  duplicates: 5,
};

export type SeoCheck = {
  id: string;
  category: ScoreCategory;
  label: string;
  status: CheckStatus;
  detail?: string;
  /** Mandatory checks turn the whole report into "fail" when they fail. */
  mandatory?: boolean;
};

export type ValidationReport = {
  status: CheckStatus;
  score: number;
  maxScore: 100;
  categories: Record<ScoreCategory, { score: number; max: number }>;
  checks: SeoCheck[];
  errors: string[];
  warnings: string[];
  passed: string[];
  validatedAt: string;
};

export type AltTextEntry = { image: number; text: string };

export type ListingForValidation = {
  languageCode: string;
  /** Optional: defaults to the language's own locale from languages.ts. */
  locale?: string;
  title: string;
  description: string;
  tags: string[];
  altTexts?: AltTextEntry[];
  /** Number of uploaded images the alt text must cover. */
  imageCount?: number;
  keywords?: { primary?: string; secondary?: string[] };
  /** English source, used only to spot untranslated copy. */
  sourceTitle?: string;
};

const ENGLISH_ONLY_WORDS = [
  "the",
  "and",
  "with",
  "your",
  "this",
  "that",
  "from",
  "handmade",
  "beautiful",
  "perfect",
  "gift",
  "these",
  "which",
];

const STOPWORDS = new Set([
  "the", "and", "for", "with", "your", "this", "that", "from", "are", "was",
  "you", "our", "all", "any", "can", "has", "have", "into", "its", "not",
  "of", "on", "or", "to", "is", "it", "in", "a", "an", "as", "at", "by",
]);

function words(text: string): string[] {
  return (text ?? "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function paragraphs(text: string): string[] {
  return (text ?? "")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 40);
}

/** Longest run of words repeated inside one description (copy-paste detection). */
function repeatedParagraph(description: string): string | null {
  const seen = new Map<string, number>();
  for (const p of paragraphs(description)) {
    const key = p.toLowerCase().replace(/\s+/g, " ");
    const count = (seen.get(key) ?? 0) + 1;
    if (count > 1) return p.slice(0, 80);
    seen.set(key, count);
  }
  return null;
}

/** How many times the phrase repeats, case-insensitive, as whole words. */
function phraseCount(haystack: string, phrase: string): number {
  const needle = phrase.trim().toLowerCase();
  if (!needle) return 0;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = haystack.toLowerCase().match(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, "gu"));
  return matches?.length ?? 0;
}

/**
 * Letters+digits only, lowercased. German/Dutch/Swedish compound words mean a
 * keyword like "jute teppich" legitimately appears as "Juteteppich", so keyword
 * presence is also checked against this compact form instead of failing on a
 * space that the language does not use.
 */
function compact(text: string): string {
  return (text ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** True when the phrase appears as-is or as part of a written compound. */
function containsPhrase(haystack: string, phrase: string): boolean {
  if (!phrase.trim()) return false;
  if (haystack.toLowerCase().includes(phrase.trim().toLowerCase())) return true;
  const needle = compact(phrase);
  return needle.length >= 4 && compact(haystack).includes(needle);
}

function scriptRatio(text: string, re: RegExp): number {
  const letters = [...text].filter((ch) => /\p{L}/u.test(ch));
  if (letters.length === 0) return 0;
  return letters.filter((ch) => re.test(ch)).length / letters.length;
}

export function expectedLocale(languageCode: string): string | null {
  return etsyLanguage(languageCode)?.locale ?? null;
}

/**
 * Language/script sanity: Japanese must actually contain kana/kanji, Russian
 * Cyrillic, and the Latin-script languages must not be mostly Cyrillic/CJK
 * (which is what an accidental wrong-language save looks like).
 */
function languageCheck(languageCode: string, title: string, description: string, tags: string[]): SeoCheck {
  const sample = `${title}\n${description}\n${tags.join(" ")}`;
  if (!sample.trim()) {
    return { id: "locale_empty", category: "localization", label: "Localized copy exists", status: "fail", mandatory: true, detail: "Nothing to check — the listing is empty." };
  }
  if (languageCode === "ja") {
    const ratio = scriptRatio(sample, /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/u);
    return ratio >= 0.2
      ? { id: "locale_script", category: "localization", label: "Japanese script present", status: "pass" }
      : { id: "locale_script", category: "localization", label: "Japanese script present", status: "fail", mandatory: true, detail: `Only ${Math.round(ratio * 100)}% kana/kanji — this does not look like Japanese.` };
  }
  if (languageCode === "ru") {
    const ratio = scriptRatio(sample, /[\u0400-\u04ff]/u);
    return ratio >= 0.5
      ? { id: "locale_script", category: "localization", label: "Cyrillic script present", status: "pass" }
      : { id: "locale_script", category: "localization", label: "Cyrillic script present", status: "fail", mandatory: true, detail: `Only ${Math.round(ratio * 100)}% Cyrillic — this does not look like Russian.` };
  }
  const cjk = scriptRatio(sample, /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\u0400-\u04ff]/u);
  if (cjk > 0.2) {
    return { id: "locale_script", category: "localization", label: "Correct script for this language", status: "fail", mandatory: true, detail: "The copy contains mostly non-Latin script for a Latin-script language." };
  }
  return { id: "locale_script", category: "localization", label: "Correct script for this language", status: "pass" };
}

/** Untranslated English copy detector — warning only (brand names are fine). */
function untranslatedEnglish(languageCode: string, text: string): SeoCheck {
  if (languageCode === "en") return { id: "locale_english", category: "localization", label: "No untranslated English copy", status: "pass" };
  const hits = ENGLISH_ONLY_WORDS.filter((w) => phraseCount(text, w) >= 2);
  if (hits.length === 0) return { id: "locale_english", category: "localization", label: "No untranslated English copy", status: "pass" };
  return {
    id: "locale_english",
    category: "localization",
    label: "No untranslated English copy",
    status: "warning",
    detail: `English word(s) used repeatedly: ${hits.slice(0, 5).join(", ")}. Brand names are fine — otherwise localize them.`,
  };
}

function titleChecks(input: ListingForValidation): SeoCheck[] {
  const title = (input.title ?? "").trim();
  const length = charCount(title);
  const checks: SeoCheck[] = [];
  checks.push(
    title
      ? { id: "title_present", category: "title", label: "Title exists", status: "pass", mandatory: true }
      : { id: "title_present", category: "title", label: "Title exists", status: "fail", mandatory: true, detail: "The title is empty." }
  );
  if (title) {
    checks.push(
      length <= TITLE_MAX_CHARS
        ? { id: "title_length", category: "title", label: `Title within ${TITLE_MAX_CHARS} characters`, status: "pass", detail: `${length}/${TITLE_MAX_CHARS}` }
        : { id: "title_length", category: "title", label: `Title within ${TITLE_MAX_CHARS} characters`, status: "fail", mandatory: true, detail: `${length}/${TITLE_MAX_CHARS} — ${length - TITLE_MAX_CHARS} over.` }
    );
    const capitalWords = title.split(/\s+/).filter((w) => w.length > 2 && w === w.toUpperCase() && /\p{L}/u.test(w));
    checks.push(
      capitalWords.length >= Math.max(3, Math.ceil(words(title).length * 0.6))
        ? { id: "title_case", category: "title", label: "Not written in all capitals", status: "fail", mandatory: true, detail: "Etsy rejects titles written in all capitals." }
        : capitalWords.length > 3
          ? { id: "title_case", category: "title", label: "Not written in all capitals", status: "warning", detail: `${capitalWords.length} words in capitals.` }
          : { id: "title_case", category: "title", label: "Not written in all capitals", status: "pass" }
    );

    const counts = new Map<string, number>();
    for (const w of words(title)) {
      if (STOPWORDS.has(w) || w.length < 4) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    const repeated = [...counts.entries()].filter(([, n]) => n > 2).map(([w]) => w);
    checks.push(
      repeated.length === 0
        ? { id: "title_repetition", category: "title", label: "No excessive word repetition", status: "pass" }
        : { id: "title_repetition", category: "duplicates", label: "No excessive word repetition", status: "warning", detail: `Repeated: ${repeated.join(", ")}.` }
    );

    const punctuation = (["%", ":", "&", "+"] as const).filter((ch) => (title.match(new RegExp(`\\${ch}`, "g")) ?? []).length > 1);
    checks.push(
      punctuation.length === 0
        ? { id: "title_punctuation", category: "title", label: "No unnecessary punctuation", status: "pass" }
        : { id: "title_punctuation", category: "title", label: "No unnecessary punctuation", status: "fail", mandatory: true, detail: `Etsy allows each of % : & + only once — repeated: ${punctuation.join(" ")}.` }
    );

    const first = words(title)[0] ?? "";
    if (!first) {
      checks.push({ id: "title_primary_front", category: "title", label: "Primary keyword near the start", status: "warning", detail: "No readable words in the title." });
    }
  }
  return checks;
}

function tagChecks(input: ListingForValidation): SeoCheck[] {
  const tags = (input.tags ?? []).map((t) => String(t));
  const cleaned = tags.map((t) => t.trim()).filter(Boolean);
  const checks: SeoCheck[] = [];
  checks.push(
    cleaned.length === REQUIRED_TAG_COUNT
      ? { id: "tags_count", category: "tags", label: `Exactly ${REQUIRED_TAG_COUNT} tags`, status: "pass", detail: `${cleaned.length}` }
      : { id: "tags_count", category: "tags", label: `Exactly ${REQUIRED_TAG_COUNT} tags`, status: "fail", mandatory: true, detail: `${cleaned.length}/${REQUIRED_TAG_COUNT}` }
  );
  const tooLong = cleaned.filter((t) => charCount(t) > TAG_MAX_CHARS);
  checks.push(
    tooLong.length === 0
      ? { id: "tags_length", category: "tags", label: `Every tag within ${TAG_MAX_CHARS} characters`, status: "pass", detail: cleaned.length ? `longest ${Math.max(...cleaned.map((t) => charCount(t)))}` : undefined }
      : { id: "tags_length", category: "tags", label: `Every tag within ${TAG_MAX_CHARS} characters`, status: "fail", mandatory: true, detail: `${tooLong.length} too long: ${tooLong.slice(0, 3).join(" | ")}` }
  );
  const keys = cleaned.map((t) => t.toLowerCase());
  const duplicates = keys.filter((k, i) => keys.indexOf(k) !== i);
  checks.push(
    duplicates.length === 0
      ? { id: "tags_duplicates", category: "tags", label: "No duplicate tags", status: "pass" }
      : { id: "tags_duplicates", category: "tags", label: "No duplicate tags", status: "fail", mandatory: true, detail: `${[...new Set(duplicates)].join(", ")}` }
  );
  checks.push(
    cleaned.length === tags.length
      ? { id: "tags_empty", category: "tags", label: "No empty tags", status: "pass" }
      : { id: "tags_empty", category: "tags", label: "No empty tags", status: "fail", mandatory: true, detail: `${tags.length - cleaned.length} empty tag slot(s).` }
  );
  return checks;
}

function descriptionChecks(input: ListingForValidation): SeoCheck[] {
  const text = (input.description ?? "").trim();
  const checks: SeoCheck[] = [];
  checks.push(
    text
      ? { id: "desc_present", category: "description", label: "Description exists", status: "pass", mandatory: true }
      : { id: "desc_present", category: "description", label: "Description exists", status: "fail", mandatory: true, detail: "The description is empty." }
  );
  if (text) {
    checks.push(
      text.length >= 400
        ? { id: "desc_length", category: "description", label: "Description is complete (400+ characters)", status: "pass", detail: `${text.length} characters` }
        : { id: "desc_length", category: "description", label: "Description is complete (400+ characters)", status: "warning", detail: `Only ${text.length} characters — most complete listings are longer.` }
    );
    const hasHeadings = /\n/.test(text) && (text.match(/^[^\n]{3,60}$/gm) ?? []).length >= 2;
    checks.push(
      hasHeadings
        ? { id: "desc_sections", category: "description", label: "Readable sections", status: "pass" }
        : { id: "desc_sections", category: "description", label: "Readable sections", status: "warning", detail: "Add short headings/line breaks so the listing is scannable." }
    );
    const repeated = repeatedParagraph(text);
    checks.push(
      repeated
        ? { id: "desc_repeat", category: "duplicates", label: "No repeated paragraphs", status: "fail", mandatory: true, detail: `Repeated paragraph starting: "${repeated}…"` }
        : { id: "desc_repeat", category: "duplicates", label: "No repeated paragraphs", status: "pass" }
    );
  }
  return checks;
}

function keywordChecks(input: ListingForValidation): SeoCheck[] {
  const desc = (input.description ?? "").toLowerCase();
  const tagText = (input.tags ?? []).join(" ").toLowerCase();
  const primary = (input.keywords?.primary ?? "").trim();
  const secondary = (input.keywords?.secondary ?? []).filter(Boolean);
  const checks: SeoCheck[] = [];

  if (!primary) {
    checks.push({ id: "kw_primary", category: "keywords", label: "Primary keyword chosen", status: "warning", detail: "No primary keyword recorded for this language." });
  } else {
    checks.push(
      containsPhrase(input.title ?? "", primary)
        ? { id: "kw_primary", category: "keywords", label: "Primary keyword in the title", status: "pass" }
        : { id: "kw_primary", category: "keywords", label: "Primary keyword in the title", status: "warning", detail: `"${primary}" is not in the title.` }
    );
  }

  const primaryCore = primary.split(/\s+/).filter((w) => w.length > 3);
  const covered = primaryCore.filter((w) => tagText.includes(w)).length;
  checks.push(
    primaryCore.length === 0
      ? { id: "kw_tags", category: "keywords", label: "Primary keyword covered by tags", status: "warning", detail: "Nothing to match." }
      : covered >= Math.min(2, primaryCore.length)
        ? { id: "kw_tags", category: "keywords", label: "Primary keyword covered by tags", status: "pass" }
        : { id: "kw_tags", category: "keywords", label: "Primary keyword covered by tags", status: "warning", detail: `Only ${covered}/${primaryCore.length} keywords from "${primary}" appear in the tags.` }
  );

  const usedSecondary = secondary.filter((k) => tagText.includes(k.toLowerCase()) || desc.includes(k.toLowerCase()));
  checks.push(
    secondary.length === 0
      ? { id: "kw_secondary", category: "keywords", label: "Secondary keywords used", status: "warning", detail: "No secondary keywords recorded." }
      : usedSecondary.length >= Math.ceil(secondary.length / 2)
        ? { id: "kw_secondary", category: "keywords", label: "Secondary keywords used", status: "pass", detail: `${usedSecondary.length}/${secondary.length}` }
        : { id: "kw_secondary", category: "keywords", label: "Secondary keywords used", status: "warning", detail: `Only ${usedSecondary.length}/${secondary.length} secondary keywords appear in the copy.` }
  );
  return checks;
}

function altTextChecks(input: ListingForValidation): SeoCheck[] {
  const entries = input.altTexts ?? [];
  const expected = input.imageCount ?? entries.length;
  const checks: SeoCheck[] = [];
  checks.push(
    expected === 0
      ? { id: "alt_required", category: "alt_text", label: "Alt text for every image", status: "warning", detail: "No images uploaded for this project." }
      : entries.length === expected
        ? { id: "alt_required", category: "alt_text", label: "Alt text for every image", status: "pass", detail: `${entries.length}/${expected}` }
        : { id: "alt_required", category: "alt_text", label: "Alt text for every image", status: "warning", detail: `${entries.length}/${expected} images have alt text.` }
  );
  const bad = entries.filter((e) => !e.text.trim() || charCount(e.text) > 250);
  checks.push(
    bad.length === 0
      ? { id: "alt_length", category: "alt_text", label: "Alt text present and within 250 characters", status: entries.length ? "pass" : "warning" }
      : { id: "alt_length", category: "alt_text", label: "Alt text present and within 250 characters", status: "fail", mandatory: true, detail: `${bad.length} alt text(s) empty or too long.` }
  );
  const stuffed = entries.filter((e) => {
    const ws = words(e.text);
    if (ws.length < 6) return false;
    const unique = new Set(ws).size;
    return unique / ws.length < 0.4;
  });
  checks.push(
    stuffed.length === 0
      ? { id: "alt_stuffing", category: "alt_text", label: "No keyword-stuffed alt text", status: "pass" }
      : { id: "alt_stuffing", category: "alt_text", label: "No keyword-stuffed alt text", status: "warning", detail: `${stuffed.length} alt text(s) repeat words too heavily.` }
  );
  return checks;
}

function stuffingChecks(input: ListingForValidation): SeoCheck[] {
  const desc = (input.description ?? "").toLowerCase();
  const primary = (input.keywords?.primary ?? "").trim().toLowerCase();
  const checks: SeoCheck[] = [];
  if (primary) {
    // A compound-only match ("Juteteppich" for "jute teppich") counts as one
    // mention, not as stuffing.
    const exact = phraseCount(desc, primary);
    const occurrences = exact > 0 ? exact : containsPhrase(input.description ?? "", primary) ? 1 : 0;
    const limit = 8;
    checks.push(
      occurrences === 0
        ? { id: "stuffing_primary", category: "duplicates", label: "Primary keyword not stuffed", status: "warning", detail: `"${primary}" does not appear in the description.` }
        : occurrences <= limit
          ? { id: "stuffing_primary", category: "duplicates", label: "Primary keyword not stuffed", status: "pass", detail: `${occurrences} mention(s)` }
          : { id: "stuffing_primary", category: "duplicates", label: "Primary keyword not stuffed", status: "warning", detail: `"${primary}" appears ${occurrences} times — keyword stuffing.` }
    );
  }
  const close = (input.tags ?? []).filter((t, i, arr) => arr.findIndex((x) => x.toLowerCase() === t.toLowerCase()) !== i);
  checks.push(
    close.length === 0
      ? { id: "stuffing_tags", category: "duplicates", label: "No repeated tag phrases", status: "pass" }
      : { id: "stuffing_tags", category: "duplicates", label: "No repeated tag phrases", status: "warning", detail: `${close.length} repeated tag(s).` }
  );
  return checks;
}

/**
 * Run every deterministic rule and score the result. `mandatory` checks that
 * fail make the overall status "fail" — a listing is never marked validated
 * while a hard Etsy limit or a missing field is broken.
 */
export function validateListing(input: ListingForValidation): ValidationReport {
  const language = etsyLanguage(input.languageCode);
  const checks: SeoCheck[] = [];

  if (!language) {
    checks.push({ id: "locale_known", category: "localization", label: "Known target language", status: "fail", mandatory: true, detail: `"${input.languageCode}" is not one of the ten supported languages.` });
  } else {
    const locale = input.locale ?? language.locale;
    checks.push(
      locale === language.locale
        ? { id: "locale_match", category: "localization", label: "Locale matches the language", status: "pass", detail: locale }
        : { id: "locale_match", category: "localization", label: "Locale matches the language", status: "fail", mandatory: true, detail: `${locale} does not belong to ${language.name} (${language.locale}).` }
    );
    checks.push(languageCheck(language.code, input.title ?? "", input.description ?? "", input.tags ?? []));
    checks.push(untranslatedEnglish(language.code, `${input.title ?? ""}\n${input.description ?? ""}\n${(input.tags ?? []).join(" ")}`));
  }

  checks.push(...titleChecks(input), ...tagChecks(input), ...descriptionChecks(input), ...keywordChecks(input), ...altTextChecks(input), ...stuffingChecks(input));

  // Category scoring: each check carries its category's weight split evenly.
  const byCategory = new Map<ScoreCategory, SeoCheck[]>();
  for (const check of checks) {
    const list = byCategory.get(check.category) ?? [];
    list.push(check);
    byCategory.set(check.category, list);
  }

  const categories = {} as Record<ScoreCategory, { score: number; max: number }>;
  let total = 0;
  for (const category of Object.keys(SCORE_WEIGHTS) as ScoreCategory[]) {
    const max = SCORE_WEIGHTS[category];
    const list = byCategory.get(category) ?? [];
    if (list.length === 0) {
      categories[category] = { score: max, max };
      total += max;
      continue;
    }
    const per = max / list.length;
    const score = list.reduce((sum, c) => sum + (c.status === "pass" ? per : c.status === "warning" ? per * 0.5 : 0), 0);
    const rounded = Math.round(score * 10) / 10;
    categories[category] = { score: rounded, max };
    total += rounded;
  }

  const errors = checks.filter((c) => c.status === "fail").map((c) => `${c.label} — ${c.detail ?? "failed"}`);
  const warnings = checks.filter((c) => c.status === "warning").map((c) => `${c.label} — ${c.detail ?? "needs attention"}`);
  const passed = checks.filter((c) => c.status === "pass").map((c) => c.label);
  const failedMandatory = checks.some((c) => c.mandatory && c.status === "fail");

  return {
    status: failedMandatory ? "fail" : warnings.length > 0 ? "warning" : "pass",
    score: Math.max(0, Math.min(100, Math.round(total))),
    maxScore: 100,
    categories,
    checks,
    errors,
    warnings,
    passed,
    validatedAt: new Date().toISOString(),
  };
}
