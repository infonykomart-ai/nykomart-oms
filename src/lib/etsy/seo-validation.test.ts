import { test } from "node:test";
import assert from "node:assert/strict";
import { validateListing, type ListingForValidation } from "./seo-validation";

// German tags (Etsy rule: 13 tags, 20 characters each) that genuinely match the
// German primary keyword — a fixture, not a claim about real search volume.
const TAGS = [
  "jute teppich",
  "handgewebt",
  "naturteppich",
  "wohnzimmer teppich",
  "boho teppich",
  "jute laeufer",
  "handgemacht",
  "boden teppich",
  "grosser teppich",
  "schlafzimmer",
  "flur teppich",
  "deko teppich",
  "nachhaltig",
];

const DESCRIPTION = [
  "Handgefertigter Juteteppich für Ihr Wohnzimmer.",
  "",
  "Material und Verarbeitung",
  "Der Teppich wird aus natürlicher Jute von Hand gewebt. Die strukturierte Oberfläche ist angenehm unter den Füßen.",
  "- Handgewebt",
  "- Natürliche Jute",
  "- Langlebig",
  "",
  "Verfügbare Größen",
  "60x90 cm, 90x150 cm und 120x180 cm. Alle Maße werden von Hand gemessen.",
  "",
  "Pflegehinweise",
  "Regelmäßig absaugen und Feuchtigkeit vermeiden. Bei Bedarf professionell reinigen lassen.",
  "",
  "Wichtige Hinweise",
  "Da jeder Teppich handgefertigt wird, können Farbabweichungen entstehen. Die Maße sind Näherungswerte.",
  "",
  "Dieser Teppich bringt natürliche Wärme in Wohnzimmer, Schlafzimmer und Flur.",
].join("\n");

function base(overrides: Partial<ListingForValidation> = {}): ListingForValidation {
  return {
    languageCode: "de",
    locale: "de-DE",
    title: "Handgewebter Juteteppich für Wohnzimmer und Flur",
    description: DESCRIPTION,
    tags: TAGS,
    altTexts: [{ image: 1, text: "Naturfarbener Juteteppich auf hellem Holzboden im Wohnzimmer" }],
    imageCount: 1,
    keywords: { primary: "jute teppich", secondary: ["naturteppich", "wohnzimmer teppich"] },
    ...overrides,
  };
}

test("a compliant German listing passes every mandatory check", () => {
  const report = validateListing(base());
  assert.equal(report.status, "pass", JSON.stringify(report.errors));
  assert.ok(report.score >= 85, `score ${report.score}`);
  assert.equal(report.maxScore, 100);
});

test("title: 140 characters passes, 141 fails as mandatory", () => {
  const ok = validateListing(base({ title: "a".repeat(140) }));
  assert.notEqual(ok.status, "fail");

  const over = validateListing(base({ title: "a".repeat(141) }));
  assert.equal(over.status, "fail");
  assert.ok(over.errors.some((e) => e.includes("140")));
});

test("title: empty fails", () => {
  const report = validateListing(base({ title: "   " }));
  assert.equal(report.status, "fail");
  assert.ok(report.errors.some((e) => /Title exists/.test(e)));
});

test("title: all-capitals is rejected like Etsy does", () => {
  const report = validateListing(base({ title: "HANDGEWEBTER JUTETEPPICH FÜR WOHNZIMMER UND FLUR" }));
  assert.equal(report.status, "fail");
  assert.ok(report.errors.some((e) => /capitals/i.test(e)));
});

test("tags: exactly 13 pass, 12 and 14 fail", () => {
  assert.equal(validateListing(base()).checks.find((c) => c.id === "tags_count")?.status, "pass");
  const twelve = validateListing(base({ tags: TAGS.slice(0, 12) }));
  assert.equal(twelve.status, "fail");
  const fourteen = validateListing(base({ tags: [...TAGS, "extra tag"] }));
  assert.equal(fourteen.status, "fail");
});

test("tags: 20 characters pass, 21 fail", () => {
  const twenty = validateListing(base({ tags: [...TAGS.slice(0, 12), "z".repeat(20)] }));
  assert.ok(!twenty.errors.some((e) => e.includes("20 characters")));
  const twentyOne = validateListing(base({ tags: [...TAGS.slice(0, 12), "z".repeat(21)] }));
  assert.equal(twentyOne.status, "fail");
  assert.ok(twentyOne.errors.some((e) => e.includes("20 characters")));
});

test("tags: duplicates fail, empty slots fail", () => {
  const duplicate = validateListing(base({ tags: [...TAGS.slice(0, 12), TAGS[0]] }));
  assert.equal(duplicate.status, "fail");
  assert.ok(duplicate.errors.some((e) => /duplicate/i.test(e)));

  const empty = validateListing(base({ tags: [...TAGS.slice(0, 12), "  "] }));
  assert.equal(empty.status, "fail");
});

test("description: empty fails; repeated paragraph fails", () => {
  assert.equal(validateListing(base({ description: "" })).status, "fail");
  const repeated = `${DESCRIPTION}\n\n${DESCRIPTION.split("\n\n")[2]}`;
  const report = validateListing(base({ description: repeated }));
  assert.ok(report.errors.some((e) => /repeated paragraphs/i.test(e)));
});

test("locale must match the language", () => {
  const report = validateListing(base({ locale: "fr-FR" }));
  assert.equal(report.status, "fail");
  assert.ok(report.errors.some((e) => /Locale matches/.test(e)));
});

test("wrong script for Russian and Japanese fails", () => {
  const russian = validateListing(base({ languageCode: "ru", locale: "ru-RU", title: "Handmade jute rug", description: "Handmade jute rug and a rug with a rug and more rug copy that is long enough to look like a listing but is not Russian at all, honestly." }));
  assert.equal(russian.status, "fail");
  assert.ok(russian.errors.some((e) => /Cyrillic/.test(e)));

  const japanese = validateListing(base({ languageCode: "ja", locale: "ja-JP" }));
  assert.equal(japanese.status, "fail");
  assert.ok(japanese.errors.some((e) => /Japanese script/.test(e)));
});

test("unknown language fails", () => {
  const report = validateListing(base({ languageCode: "xx" }));
  assert.equal(report.status, "fail");
  assert.ok(report.errors.some((e) => /Known target language/.test(e)));
});

test("alt text: 250 passes, 251 fails, missing image warns", () => {
  const ok = validateListing(base({ altTexts: [{ image: 1, text: "t".repeat(250) }] }));
  assert.ok(!ok.errors.some((e) => /250/.test(e)));

  const over = validateListing(base({ altTexts: [{ image: 1, text: "t".repeat(251) }] }));
  assert.equal(over.status, "fail");

  const missing = validateListing(base({ altTexts: [], imageCount: 2 }));
  assert.ok(missing.warnings.some((w) => /every image/.test(w)));
  assert.notEqual(missing.status, "fail");
});

test("score is 0-100 and categories add up to the total", () => {
  const report = validateListing(base());
  const categorySum = Object.values(report.categories).reduce((sum, c) => sum + c.score, 0);
  assert.equal(Math.round(categorySum), report.score);
  assert.ok(report.score <= 100 && report.score >= 0);
});

test("untranslated English copy is a warning, never a silent pass into 'clean'", () => {
  const report = validateListing(
    base({
      description: `The rug and the mat, with the texture and the weave. ${DESCRIPTION}`,
    })
  );
  assert.ok(report.warnings.some((w) => /untranslated English/i.test(w)));
  assert.ok(report.checks.some((c) => c.id === "locale_english" && c.status === "warning"));
});
