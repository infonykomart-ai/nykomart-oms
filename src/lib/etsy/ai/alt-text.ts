// 2026-11-18 — Alt-text vision bundle parsing, extracted from the route so it
// can be tested without Next.js, Supabase or an API key.
//
// The alt-text route sends ONE photo to the vision model and asks for all ten
// languages back in a single call. The model is untrusted input: the reply may
// be fenced, may use `code` instead of `language_code`, may return a language
// we did not ask for, and may overrun Etsy's 250 characters. This module turns
// that reply into a validated map, and reports missing languages so the
// provider manager can ask again instead of saving a silent blank.

import { extractJsonObject } from "./schemas";
import { ALT_TEXT_MAX_CHARS } from "../validation";

export type AltTextBundle = {
  /** language code → alt text, only for the languages that were requested. */
  altTexts: Record<string, string>;
  /** Codes whose text had to be cut at a word boundary to fit 250 chars. */
  truncated: string[];
};

export type AltTextBundleResult = { ok: true; data: AltTextBundle } | { ok: false; issues: string[] };

type RawEntry = { language_code?: string; code?: string; text?: string };

/** Cut to the Etsy limit without splitting a word. */
export function clampAltText(text: string, max = ALT_TEXT_MAX_CHARS): string {
  const clean = (text ?? "").trim();
  const chars = [...clean];
  if (chars.length <= max) return clean;
  const cut = chars.slice(0, max).join("");
  const atSpace = cut.lastIndexOf(" ");
  return (atSpace > max * 0.6 ? cut.slice(0, atSpace) : cut).trim();
}

function rawEntries(raw: unknown): RawEntry[] {
  if (!raw || typeof raw !== "object") return [];
  const obj = raw as { alt_texts?: unknown; altTexts?: unknown };
  const list = Array.isArray(obj.alt_texts) ? obj.alt_texts : Array.isArray(obj.altTexts) ? obj.altTexts : [];
  return list as RawEntry[];
}

/**
 * Parse `{"alt_texts":[{"language_code":"nl","text":"…"}, …]}`.
 * Missing/empty languages are issues (the AI gets one repair pass); unknown
 * languages are dropped rather than stored under a code nobody will read.
 */
export function parseAltTextBundle(text: string, expected: string[]): AltTextBundleResult {
  const wanted = expected.map((code) => code.trim().toLowerCase());
  const altTexts: Record<string, string> = {};
  const truncated: string[] = [];

  for (const entry of rawEntries(extractJsonObject(text))) {
    const code = String(entry?.language_code ?? entry?.code ?? "").trim().toLowerCase();
    const value = String(entry?.text ?? "").trim();
    if (!code || !value || !wanted.includes(code)) continue;
    const clamped = clampAltText(value);
    if (clamped !== value) truncated.push(code);
    altTexts[code] = clamped;
  }

  const missing = wanted.filter((code) => !altTexts[code]);
  if (missing.length > 0) {
    return { ok: false, issues: [`missing alt text for: ${missing.join(", ")}`] };
  }
  return { ok: true, data: { altTexts, truncated } };
}

/**
 * Put one image's alt text into a listing's existing list: replace the entry
 * for that image number, keep the rest, stay ordered by image number.
 */
export function mergeAltTextEntry(
  existing: Array<{ image: number; text: string }> | null | undefined,
  imageNumber: number,
  text: string
): Array<{ image: number; text: string }> {
  const kept = (existing ?? []).filter((entry) => entry.image !== imageNumber);
  return [...kept, { image: imageNumber, text: clampAltText(text) }].sort((a, b) => a.image - b.image);
}
