import { test } from "node:test";
import assert from "node:assert/strict";
import { buildKeywordsCsv, buildListingsCsv, buildProjectJson, completeListingText, csvCell, type ExportListing } from "./export";

const japanese: ExportListing = {
  country: "Japan",
  language: "Japanese",
  languageCode: "ja",
  locale: "ja-JP",
  title: "手織りジュートラグ リビングルーム用",
  description: "手作りのジュートラグです。\n天然素材を使用しています。",
  tags: Array.from({ length: 13 }, (_, i) => `タグ${i + 1}`),
  altTexts: [{ image: 1, text: "明るい木の床に置かれたナチュラル色のジュートラグ" }],
  seoScore: 88,
  validationStatus: "warning",
  validationReport: { errors: [], warnings: ["Alt text — 1/2 images"] },
  provider: "gemini",
  model: "gemini-flash-latest",
  backupUsed: false,
};

const russian: ExportListing = {
  ...japanese,
  country: "Russia",
  language: "Russian",
  languageCode: "ru",
  locale: "ru-RU",
  title: "Джутовый ковер ручной работы",
  description: "Ковер из натурального джута, \"ручная\" работа.\nУход: пылесосить.",
  tags: ["ковер", "джутовый ковер", "ковер в гостиную", "ручная работа", "натуральный ковер", "плетеный ковер", "бохо ковер", "ковер на пол", "декор дома", "ковер 120x180", "ковер из джута", "эко ковер", "большой ковер"],
  altTexts: [],
  validationStatus: "pass",
  seoScore: 94,
  validationReport: { errors: [], warnings: [] },
  provider: "openrouter",
  model: "openai/gpt-x",
  backupUsed: true,
};

const project = {
  id: "11111111-1111-1111-1111-111111111111",
  projectName: "Jute rug",
  sku: "JR-01",
  category: "Jute Rugs",
  originalTitle: "Handmade Jute Rug",
  originalDescription: "Natural jute rug",
  originalTags: "jute rug",
  product: { material: "Jute" },
  images: [{ url: "https://example.com/a.jpg" }],
};

const keywords = [
  {
    keyword: "джутовый ковер",
    languageCode: "ru",
    country: "Russia",
    keywordType: "primary",
    source: "ai",
    verified: false,
    searchVolume: null,
    competition: null,
    confidence: "unknown",
    sourceUrl: null,
    researchedAt: "2026-11-18T00:00:00Z",
  },
  {
    keyword: "jute rug 120x180",
    languageCode: "ru",
    country: "Russia",
    keywordType: "secondary",
    source: "user_file",
    verified: true,
    searchVolume: 1200,
    competition: 0.4,
    confidence: "medium",
    sourceUrl: null,
    researchedAt: "2026-11-18T00:00:00Z",
  },
];

test("csvCell quotes commas, quotes and newlines", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell('with "quotes"'), '"with ""quotes"""');
  assert.equal(csvCell("a,b"), '"a,b"');
  assert.equal(csvCell("line\nbreak"), '"line\nbreak"');
  assert.equal(csvCell(null), "");
});

test("listings CSV keeps Japanese and Russian text and starts with a BOM", () => {
  const csv = buildListingsCsv([japanese, russian]);
  assert.ok(csv.startsWith("\ufeff"));
  assert.ok(csv.includes("手織りジュートラグ リビングルーム用"));
  assert.ok(csv.includes("Джутовый ковер ручной работы"));
  assert.ok(csv.includes('"ковер из джута"') || csv.includes("ковер из джута"));
  // One header row + one row per language.
  assert.equal(csv.trim().split(/\r\n(?=\S)/).length >= 3, true);
});

test("keyword CSV labels unverified AI rows instead of inventing volume", () => {
  const csv = buildKeywordsCsv(keywords);
  assert.ok(csv.includes("AI Suggested – Search Volume Not Verified"));
  assert.ok(csv.includes("Verified"));
  assert.ok(csv.includes("1200"));
});

test("project JSON contains ten-slot localizations and per-language metadata", () => {
  const json = buildProjectJson({ project, listings: [japanese, russian], keywords, competitors: [] });
  assert.equal((json.localizations as unknown[]).length, 2);
  const first = (json.localizations as Array<Record<string, unknown>>)[0] as {
    tags: Array<{ character_count: number }>;
    title: { character_count: number };
    validation: { status: string };
  };
  assert.equal(first.tags.length, 13);
  assert.equal(first.tags[0].character_count, 3);
  assert.ok(first.title.character_count > 0);
  assert.equal(first.validation.status, "warning");
  const research = json.research as { verified_keywords: number; ai_suggested_keywords: number };
  assert.equal(research.verified_keywords, 1);
  assert.equal(research.ai_suggested_keywords, 1);
  const meta = json.ai_metadata as { fallback_used: boolean };
  assert.equal(meta.fallback_used, true);
});

test("complete listing text is copy-ready in Etsy order", () => {
  const text = completeListingText(japanese);
  assert.ok(text.indexOf("TITLE") < text.indexOf("TAGS"));
  assert.ok(text.indexOf("TAGS") < text.indexOf("DESCRIPTION"));
  assert.ok(text.includes("13/13"));
});
