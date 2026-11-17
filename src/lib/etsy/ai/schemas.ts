// 2026-11-18 — Strict parsers for every AI JSON shape used by the generator.
//
// The model is treated as untrusted input: fences are stripped, the outermost
// object is located, and every field is type-checked. A reply that fails here
// triggers a repair prompt (and eventually the fallback provider) instead of
// writing half-empty content to the database. No silent field removal.

import { clampTitle, charCount, normalizeTags, parseTags, REQUIRED_TAG_COUNT, TAG_MAX_CHARS, TITLE_MAX_CHARS } from "../validation";
import type { AltTextEntry } from "../seo-validation";

export type ParseResult<T> = { ok: true; data: T } | { ok: false; issues: string[] };

const ALT_MAX = 250;

/** Extract the first balanced JSON object from a possibly-fenced/chatty reply. */
export function extractJsonObject(text: string): unknown | null {
  const cleaned = (text ?? "").replace(/```json/gi, "```").replace(/```/g, "").trim();
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === "string" ? v.trim() : "")).filter(Boolean);
}

export type ListingOutput = {
  title: string;
  description: string;
  tags: string[];
  primaryKeyword: string;
  secondaryKeywords: string[];
  altTexts: AltTextEntry[];
  /** Non-fatal adjustments the UI should mention (clamped/dropped tags). */
  notes: string[];
};

export type ListingField = "all" | "title" | "description" | "tags" | "alt_text";

/**
 * Parse + deterministically fix one generated listing.
 * Hard rules (13 tags, tag length, title length) produce issues → the manager
 * asks the model again rather than silently shipping a broken listing.
 */
export function parseListingOutput(
  text: string,
  options: { field: ListingField; imageCount: number }
): ParseResult<ListingOutput> {
  const raw = extractJsonObject(text);
  if (!raw || typeof raw !== "object") return { ok: false, issues: ["The reply was not a JSON object."] };
  const obj = raw as Record<string, unknown>;
  const issues: string[] = [];
  const notes: string[] = [];

  let title = "";
  if (options.field === "all" || options.field === "title") {
    title = asString(obj.title);
    if (!title) issues.push("title is empty");
    else if (charCount(title) > TITLE_MAX_CHARS) {
      const clamped = clampTitle(title);
      notes.push(`Title shortened from ${charCount(title)} to ${charCount(clamped)} characters.`);
      title = clamped;
    }
  }

  let description = "";
  if (options.field === "all" || options.field === "description") {
    description = asString(obj.description);
    if (!description) issues.push("description is empty");
    else if (description.length < 200) issues.push(`description is only ${description.length} characters — write the complete listing`);
  }

  let tags: string[] = [];
  if (options.field === "all" || options.field === "tags") {
    const rawTags = Array.isArray(obj.tags) ? obj.tags : parseTags(asString(obj.tags));
    const normalized = normalizeTags(rawTags as string[]);
    tags = normalized.tags;
    if (normalized.droppedTooLong.length > 0) {
      notes.push(`Dropped ${normalized.droppedTooLong.length} tag(s) over ${TAG_MAX_CHARS} characters.`);
    }
    if (normalized.droppedDuplicate > 0) notes.push(`Dropped ${normalized.droppedDuplicate} duplicate tag(s).`);
    if (tags.length !== REQUIRED_TAG_COUNT) {
      issues.push(
        `exactly ${REQUIRED_TAG_COUNT} tags are required but the reply produced ${tags.length} usable tag(s)` +
          (normalized.droppedTooLong.length ? ` — ${normalized.droppedTooLong.length} were over ${TAG_MAX_CHARS} characters` : "")
      );
    }
    const over = tags.filter((t) => charCount(t) > TAG_MAX_CHARS);
    if (over.length > 0) issues.push(`${over.length} tag(s) exceed ${TAG_MAX_CHARS} characters`);
  }

  const altTexts: AltTextEntry[] = [];
  if (options.field === "all" || options.field === "alt_text") {
    const list = Array.isArray(obj.alt_texts) ? obj.alt_texts : Array.isArray(obj.altTexts) ? (obj.altTexts as unknown[]) : [];
    list.forEach((entry, index) => {
      const item = (entry ?? {}) as Record<string, unknown>;
      const image = Number(item.image ?? item.image_number ?? index + 1);
      let value = asString(item.text ?? item.alt_text);
      if (!value) return;
      if (value.length > ALT_MAX) {
        value = value.slice(0, ALT_MAX).replace(/\s+\S*$/, "").trim();
        notes.push(`Alt text for image ${image} shortened to ${ALT_MAX} characters.`);
      }
      altTexts.push({ image: Number.isFinite(image) ? image : index + 1, text: value });
    });
    if (options.imageCount > 0 && altTexts.length !== options.imageCount) {
      issues.push(`${options.imageCount} image(s) uploaded but ${altTexts.length} alt text(s) returned`);
    }
  }

  if (issues.length > 0) return { ok: false, issues };

  return {
    ok: true,
    data: {
      title,
      description,
      tags,
      primaryKeyword: asString(obj.primary_keyword ?? obj.primaryKeyword),
      secondaryKeywords: asStringArray(obj.secondary_keywords ?? obj.secondaryKeywords),
      altTexts,
      notes,
    },
  };
}

export type KeywordGroups = {
  primary: string[];
  secondary: string[];
  longTail: string[];
  buyerIntent: string[];
  product: string[];
  material: string[];
  style: string[];
  room: string[];
  seasonal: string[];
  competitor: string[];
};

const KEYWORD_KEYS: Array<[keyof KeywordGroups, string[]]> = [
  ["primary", ["primary", "primary_keywords"]],
  ["secondary", ["secondary", "secondary_keywords"]],
  ["longTail", ["long_tail", "longTail", "long_tail_keywords"]],
  ["buyerIntent", ["buyer_intent", "buyerIntent", "buyer_intent_keywords"]],
  ["product", ["product", "product_keywords"]],
  ["material", ["material", "material_keywords"]],
  ["style", ["style", "style_keywords"]],
  ["room", ["room", ["room_keywords"]].flat()],
  ["seasonal", ["seasonal", ["seasonal_keywords"]].flat()],
  ["competitor", ["competitor", ["competitor_keywords"]].flat()],
];

export function parseKeywordOutput(text: string): ParseResult<KeywordGroups> {
  const raw = extractJsonObject(text);
  if (!raw || typeof raw !== "object") return { ok: false, issues: ["The reply was not a JSON object."] };
  const obj = raw as Record<string, unknown>;
  const out: KeywordGroups = {
    primary: [],
    secondary: [],
    longTail: [],
    buyerIntent: [],
    product: [],
    material: [],
    style: [],
    room: [],
    seasonal: [],
    competitor: [],
  };
  for (const [target, aliases] of KEYWORD_KEYS) {
    for (const alias of aliases) {
      const values = asStringArray(obj[alias]);
      if (values.length > 0) {
        out[target] = values;
        break;
      }
    }
  }
  const total = Object.values(out).reduce((sum, list) => sum + list.length, 0);
  if (total === 0) return { ok: false, issues: ["No keyword lists were returned."] };
  if (out.primary.length === 0) return { ok: false, issues: ["primary keyword list is empty"] };
  return { ok: true, data: out };
}

export type CompetitorAnalysisOutput = {
  keywordOpportunities: string[];
  terminology: string[];
  titleStructure: string;
  longTail: string[];
  keywordGaps: string[];
  differentiation: string[];
  notes: string;
};

export function parseCompetitorOutput(text: string): ParseResult<CompetitorAnalysisOutput> {
  const raw = extractJsonObject(text);
  if (!raw || typeof raw !== "object") return { ok: false, issues: ["The reply was not a JSON object."] };
  const obj = raw as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const key of keys) {
      const values = asStringArray(obj[key]);
      if (values.length > 0) return values;
    }
    return [];
  };
  const data: CompetitorAnalysisOutput = {
    keywordOpportunities: pick("keyword_opportunities", "opportunities"),
    terminology: pick("terminology", "product_terminology"),
    titleStructure: asString(obj.title_structure),
    longTail: pick("long_tail", "long_tail_keywords"),
    keywordGaps: pick("keyword_gaps", "gaps"),
    differentiation: pick("differentiation", "differentiation_opportunities"),
    notes: asString(obj.notes),
  };
  if (data.keywordOpportunities.length === 0 && data.differentiation.length === 0 && !data.titleStructure) {
    return { ok: false, issues: ["The analysis was empty."] };
  }
  return { ok: true, data };
}

/** Alt text is a single string — the vision call's whole output. */
export function parseAltTextOutput(text: string): ParseResult<string> {
  const raw = extractJsonObject(text);
  if (raw && typeof raw === "object") {
    const value = asString((raw as Record<string, unknown>).alt_text ?? (raw as Record<string, unknown>).text);
    if (value) return { ok: true, data: value.slice(0, ALT_MAX) };
  }
  const plain = (text ?? "").trim().replace(/^["']|["']$/g, "");
  if (plain && plain.length <= ALT_MAX) return { ok: true, data: plain };
  return { ok: false, issues: ["No usable alt text was returned."] };
}
