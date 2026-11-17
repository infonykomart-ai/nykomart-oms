import { test } from "node:test";
import assert from "node:assert/strict";
import {
  charCount,
  clampTitle,
  dedupeTags,
  formatTags,
  normalizeTags,
  parseTags,
  REQUIRED_TAG_COUNT,
  TAG_MAX_CHARS,
  TITLE_MAX_CHARS,
  validateTags,
  validateTitle,
  validateTranslation,
} from "./validation";

const THIRTEEN = [
  "jute rug", "handmade rug", "area rug", "living room rug", "natural rug",
  "jute carpet", "boho rug", "farmhouse rug", "woven rug", "floor rug",
  "home decor", "eco friendly rug", "large rug",
];

test("charCount counts spaces and punctuation", () => {
  assert.equal(charCount("jute rug"), 8);
  assert.equal(charCount("a, b!"), 5);
  assert.equal(charCount(""), 0);
});

test("parseTags accepts comma and newline separated input and strips quotes", () => {
  assert.deepEqual(parseTags('"jute rug", handmade rug\narea rug'), ["jute rug", "handmade rug", "area rug"]);
  assert.deepEqual(parseTags([" one ", "two"]), ["one", "two"]);
});

test("formatTags prints exactly one comma-separated line", () => {
  const line = formatTags(THIRTEEN);
  assert.ok(!line.includes("\n"));
  assert.equal(line.split(", ").length, REQUIRED_TAG_COUNT);
});

test("dedupeTags is case-insensitive and keeps the first spelling", () => {
  assert.deepEqual(dedupeTags(["Jute Rug", "jute rug", "Area Rug"]), ["Jute Rug", "Area Rug"]);
});

test("normalizeTags drops over-long and duplicate tags, keeps 13", () => {
  const long = "x".repeat(TAG_MAX_CHARS + 1);
  const result = normalizeTags([...THIRTEEN, "jute rug", long, THIRTEEN[0].toUpperCase()]);
  assert.equal(result.tags.length, REQUIRED_TAG_COUNT);
  assert.deepEqual(result.droppedTooLong, [long]);
  assert.equal(result.droppedDuplicate, 2);
});

test("validateTags passes exactly 13 valid unique tags", () => {
  const v = validateTags(formatTags(THIRTEEN));
  assert.equal(v.total, 13);
  assert.equal(v.valid, 13);
  assert.equal(v.invalid, 0);
  assert.equal(v.pass, true);
  assert.ok(v.maxTagLength <= TAG_MAX_CHARS);
});

test("validateTags fails on 12 tags, duplicates and over-length tags", () => {
  assert.equal(validateTags(formatTags(THIRTEEN.slice(0, 12))).pass, false);

  const withDuplicate = [...THIRTEEN.slice(0, 12), THIRTEEN[0]];
  const dup = validateTags(formatTags(withDuplicate));
  assert.equal(dup.pass, false);
  assert.equal(dup.duplicates.length, 1);
  assert.equal(dup.valid, 12);

  const over = [...THIRTEEN.slice(0, 12), "y".repeat(TAG_MAX_CHARS + 1)];
  const tooLong = validateTags(formatTags(over));
  assert.equal(tooLong.pass, false);
  assert.equal(tooLong.tooLong.length, 1);
  assert.equal(tooLong.invalid, 1);
});

test("validateTags counts a 29-character tag as valid and 30 as invalid", () => {
  const ok = validateTags([...THIRTEEN.slice(0, 12), "z".repeat(TAG_MAX_CHARS)]);
  assert.equal(ok.pass, true);
  const bad = validateTags([...THIRTEEN.slice(0, 12), "z".repeat(TAG_MAX_CHARS + 1)]);
  assert.equal(bad.pass, false);
});

test("validateTitle enforces the 140-character limit including spaces", () => {
  const short = validateTitle("Handmade Natural Jute Rug for Living Room");
  assert.equal(short.valid, true);
  assert.equal(short.length, 41);

  const exact = validateTitle("a".repeat(TITLE_MAX_CHARS));
  assert.equal(exact.valid, true);

  const over = validateTitle("a".repeat(TITLE_MAX_CHARS + 1));
  assert.equal(over.valid, false);
  assert.match(over.message ?? "", /1 character/);

  assert.equal(validateTitle("   ").valid, false);
});

test("clampTitle shortens at a word boundary without exceeding the limit", () => {
  const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
  const clamped = clampTitle(long);
  assert.ok(charCount(clamped) <= TITLE_MAX_CHARS);
  assert.ok(clamped.endsWith("word") || /word\d+$/.test(clamped));
  assert.ok(!/\s$/.test(clamped));
});

test("validateTranslation reports every failing field", () => {
  const bad = validateTranslation({ title: "x".repeat(200), description: "short", tags: ["one"] });
  assert.equal(bad.pass, false);
  assert.equal(bad.issues.length, 3);

  const good = validateTranslation({
    title: "Handgefertigter Juteteppich für das Wohnzimmer",
    description: "Ein handgefertigter Teppich aus natürlicher Jute. ".repeat(4),
    tags: THIRTEEN,
  });
  assert.equal(good.pass, true, JSON.stringify(good.issues));
});
