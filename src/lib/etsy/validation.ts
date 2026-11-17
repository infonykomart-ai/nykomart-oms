// 2026-11-17 — Etsy SEO rules as one pure module. Etsy itself enforces these
// limits at listing-upload time, but a listing that breaks them cannot be
// copied in — so the same functions gate: the live character counter, the tag
// validator in the UI, the AI route (which retries a bad generation) and the
// server-side save action. No I/O here, so it is safe in client components and
// covered by src/lib/etsy/validation.test.ts.

export const TITLE_MAX_CHARS = 140;
// Etsy's published rule: "up to 13 tags per listing, each tag up to 20
// characters" (help.etsy.com/hc/en-us/articles/360000336307). The module
// previously allowed 29, which Etsy's listing form rejects outright.
export const TAG_MAX_CHARS = 20;
export const REQUIRED_TAG_COUNT = 13;
export const ALT_TEXT_MAX_CHARS = 250;

/** Character count the way Etsy counts it: spaces and punctuation included. */
export function charCount(value: string): number {
  return [...(value ?? "")].length;
}

/** Parse a comma-separated tag string (or array) into trimmed tag strings. */
export function parseTags(raw: string | string[] | null | undefined): string[] {
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  if (!raw) return [];
  return String(raw)
    .split(/[,\n]/)
    .map((t) => t.trim().replace(/^["'#]+|["']+$/g, "").trim())
    .filter(Boolean);
}

/** One-line Etsy format: comma + space, nothing else. */
export function formatTags(tags: string[]): string {
  return tags.map((t) => t.trim()).filter(Boolean).join(", ");
}

/** Dedupe case-insensitively, keeping the first spelling. */
export function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const key = tag.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(tag.trim());
  }
  return out;
}

/**
 * Clean a raw AI/client tag list into what Etsy will actually accept:
 * trimmed, deduped, over-20-character tags dropped, first 13 kept.
 * Anything dropped is reported so the UI can say why.
 */
export function normalizeTags(raw: string | string[] | null | undefined): {
  tags: string[];
  droppedTooLong: string[];
  droppedDuplicate: number;
  droppedEmpty: number;
} {
  const parsed = parseTags(raw);
  const droppedTooLong: string[] = [];
  const kept: string[] = [];
  const seen = new Set<string>();
  let droppedDuplicate = 0;
  let droppedEmpty = 0;
  for (const tag of parsed) {
    const clean = tag.trim();
    if (!clean) {
      droppedEmpty += 1;
      continue;
    }
    if (charCount(clean) > TAG_MAX_CHARS) {
      droppedTooLong.push(clean);
      continue;
    }
    const key = clean.toLowerCase();
    if (seen.has(key)) {
      droppedDuplicate += 1;
      continue;
    }
    seen.add(key);
    kept.push(clean);
  }
  return {
    tags: kept.slice(0, REQUIRED_TAG_COUNT),
    droppedTooLong,
    droppedDuplicate,
    droppedEmpty,
  };
}

export type TagIssue = { tag: string; problem: "too_long" | "duplicate"; length: number };

export type TagValidation = {
  total: number;
  valid: number;
  invalid: number;
  duplicates: string[];
  tooLong: string[];
  issues: TagIssue[];
  maxTagLength: number;
  /** true only when: exactly 13 tags, each 1–20 chars, no duplicates, one line. */
  pass: boolean;
};

/** Full tag validation for display and saving. */
export function validateTags(raw: string | string[] | null | undefined): TagValidation {
  const tags = parseTags(raw);
  const seen = new Set<string>();
  const issues: TagIssue[] = [];
  const duplicates: string[] = [];
  const tooLong: string[] = [];
  let valid = 0;
  let maxTagLength = 0;
  for (const tag of tags) {
    const length = charCount(tag);
    maxTagLength = Math.max(maxTagLength, length);
    const key = tag.toLowerCase();
    if (length > TAG_MAX_CHARS) {
      tooLong.push(tag);
      issues.push({ tag, problem: "too_long", length });
      continue;
    }
    if (!key) continue;
    if (seen.has(key)) {
      duplicates.push(tag);
      issues.push({ tag, problem: "duplicate", length });
      continue;
    }
    seen.add(key);
    valid += 1;
  }
  return {
    total: tags.length,
    valid,
    invalid: tags.length - valid,
    duplicates,
    tooLong,
    issues,
    maxTagLength,
    pass: tags.length === REQUIRED_TAG_COUNT && valid === REQUIRED_TAG_COUNT && duplicates.length === 0 && tooLong.length === 0,
  };
}

export type TitleValidation = {
  length: number;
  max: number;
  valid: boolean;
  message: string | null;
};

export function validateTitle(title: string | null | undefined): TitleValidation {
  const length = charCount(title ?? "");
  if (!(title ?? "").trim()) return { length, max: TITLE_MAX_CHARS, valid: false, message: "Title is empty." };
  if (length > TITLE_MAX_CHARS) {
    return { length, max: TITLE_MAX_CHARS, valid: false, message: `${length - TITLE_MAX_CHARS} character(s) over the ${TITLE_MAX_CHARS} limit.` };
  }
  return { length, max: TITLE_MAX_CHARS, valid: true, message: null };
}

/**
 * Shorten to the Etsy limit at a word boundary. Used only as a last resort
 * after the AI has already been asked to retry within the limit — it never
 * changes words, it just stops at the last complete word that fits.
 */
export function clampTitle(title: string, max = TITLE_MAX_CHARS): string {
  const clean = (title ?? "").trim();
  if (charCount(clean) <= max) return clean;
  const chars = [...clean];
  const cut = chars.slice(0, max).join("");
  const atSpace = cut.lastIndexOf(" ");
  return (atSpace > max * 0.6 ? cut.slice(0, atSpace) : cut).trim().replace(/[,;:\-–—]$/, "").trim();
}

export type AltTextValidation = {
  length: number;
  max: number;
  valid: boolean;
  message: string | null;
};

/** One image alt text: present and within Etsy's 250-character guidance. */
export function validateAltText(text: string | null | undefined): AltTextValidation {
  const value = (text ?? "").trim();
  const length = charCount(value);
  if (!value) return { length, max: ALT_TEXT_MAX_CHARS, valid: false, message: "Alt text is empty." };
  if (length > ALT_TEXT_MAX_CHARS) {
    return { length, max: ALT_TEXT_MAX_CHARS, valid: false, message: `${length - ALT_TEXT_MAX_CHARS} character(s) over the ${ALT_TEXT_MAX_CHARS} limit.` };
  }
  return { length, max: ALT_TEXT_MAX_CHARS, valid: true, message: null };
}

export type TranslationValidation = {
  title: TitleValidation;
  tags: TagValidation;
  description: { length: number; valid: boolean; message: string | null };
  pass: boolean;
  issues: string[];
};

/** Everything the module checks before a translation is displayed or saved. */
export function validateTranslation(fields: { title?: string; description?: string; tags?: string | string[] }): TranslationValidation {
  const title = validateTitle(fields.title);
  const tags = validateTags(fields.tags);
  const descriptionText = (fields.description ?? "").trim();
  const description = {
    length: descriptionText.length,
    valid: descriptionText.length >= 120,
    message: descriptionText.length === 0 ? "Description is empty." : descriptionText.length < 120 ? "Description looks too short to be a complete listing." : null,
  };
  const issues: string[] = [];
  if (title.message) issues.push(`Title: ${title.message}`);
  if (tags.total !== REQUIRED_TAG_COUNT) issues.push(`Tags: ${tags.total}/${REQUIRED_TAG_COUNT} — exactly ${REQUIRED_TAG_COUNT} are required.`);
  if (tags.tooLong.length > 0) issues.push(`Tags: ${tags.tooLong.length} tag(s) exceed ${TAG_MAX_CHARS} characters.`);
  if (tags.duplicates.length > 0) issues.push(`Tags: ${tags.duplicates.length} duplicate tag(s).`);
  if (description.message) issues.push(`Description: ${description.message}`);
  return { title, tags, description, pass: issues.length === 0, issues };
}
