import { test } from "node:test";
import assert from "node:assert/strict";
import { etsyLanguage } from "./languages";
import { mergeKeywordRecords, parseKeywordFile, recordsFromAiGroups, UNVERIFIED_LABEL } from "./research";

const de = etsyLanguage("de")!;

test("parseKeywordFile marks a row with a real volume as verified", () => {
  const rows = parseKeywordFile("keyword,volume,competition\njute teppich,1900,0.35\nnaturteppich", de);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].keyword, "jute teppich");
  assert.equal(rows[0].verified, true);
  assert.equal(rows[0].searchVolume, 1900);
  assert.equal(rows[0].competition, 0.35);
  assert.equal(rows[0].source, "user_file");

  assert.equal(rows[1].verified, false);
  assert.equal(rows[1].searchVolume, null);
});

test("parseKeywordFile ignores a header row and blank lines", () => {
  const rows = parseKeywordFile("Keyword\n\nwohnzimmer teppich\n", de);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].keyword, "wohnzimmer teppich");
});

test("AI suggestions are always unverified and carry no invented metrics", () => {
  const rows = recordsFromAiGroups({ primary: ["jute teppich"], longTail: ["jute teppich wohnzimmer"] }, de);
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.verified, false);
    assert.equal(row.searchVolume, null);
    assert.equal(row.competition, null);
    assert.equal(row.source, "ai");
  }
  assert.equal(rows[0].keywordType, "primary");
  assert.equal(rows[1].keywordType, "long_tail");
  assert.match(UNVERIFIED_LABEL, /Not Verified/);
});

test("mergeKeywordRecords prefers the verified record for the same keyword", () => {
  const ai = recordsFromAiGroups({ primary: ["jute teppich"] }, de);
  const file = parseKeywordFile("jute teppich,1500,0.3", de);
  const merged = mergeKeywordRecords([...ai, ...file]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].verified, true);
  assert.equal(merged[0].searchVolume, 1500);
});

test("keywords are scoped to the market's language and country", () => {
  const rows = recordsFromAiGroups({ primary: ["jute teppich"] }, de);
  assert.equal(rows[0].languageCode, "de");
  assert.equal(rows[0].country, "Germany");
});
