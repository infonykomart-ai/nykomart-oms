import { test } from "node:test";
import assert from "node:assert/strict";
import { ETSY_LANGUAGES } from "./languages";
import { validateLocalizationSet } from "./project-set";

const all = ETSY_LANGUAGES.map((l) => ({ languageCode: l.code, locale: l.locale }));

test("ten localizations with the right locales pass", () => {
  const result = validateLocalizationSet(all);
  assert.equal(result.ok, true, result.issues.join(" "));
  assert.equal(all.length, 10);
});

test("a missing language fails and names it", () => {
  const result = validateLocalizationSet(all.filter((l) => l.languageCode !== "ja"));
  assert.equal(result.ok, false);
  assert.deepEqual(result.missing, ["ja"]);
  assert.ok(result.issues.some((i) => i.includes("9/10")));
});

test("a duplicate language fails", () => {
  const result = validateLocalizationSet([...all, { languageCode: "de", locale: "de-DE" }]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.duplicates, ["de"]);
});

test("an unsupported language fails", () => {
  const result = validateLocalizationSet([...all, { languageCode: "en", locale: "en-US" }]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.unexpected, ["en"]);
});

test("an incorrect locale mapping fails", () => {
  const wrong = all.map((l) => (l.languageCode === "de" ? { languageCode: "de", locale: "fr-FR" } : l));
  const result = validateLocalizationSet(wrong);
  assert.equal(result.ok, false);
  assert.equal(result.localeMismatch.length, 1);
  assert.equal(result.localeMismatch[0].expected, "de-DE");
});
