// 2026-11-24 — The ten-language generation pipeline, offline.
//
// These tests exercise the behaviour the speed work promises, with no network:
//   * one keyword research pass per run, delivered per market,
//   * bounded parallel generation where a finished market does not wait,
//   * partial results kept when one market fails,
//   * retry of exactly the failed/forced codes,
//   * cache reuse when the source hash has not changed,
//   * image alt text generated once per photo and merged into the listings.
//
// What they cannot prove: real provider latency and the real completion time of
// a full run. That needs a live key and is reported separately.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ETSY_LANGUAGES, type EtsyLanguage } from "../languages";
import type { KeywordGroups } from "../ai/schemas";
import { parseMultiLanguageKeywordOutput } from "../ai/schemas";
import { mapWithConcurrency } from "./concurrency";
import { contentHash } from "./source-hash";
import { runGenerationPipeline, type CachedListing, type GeneratedListing, type PipelineEvent } from "./pipeline";

type Row = { title: string; languageCode: string };

function groupsFor(code: string): KeywordGroups {
  return {
    primary: [`${code}-primary`],
    secondary: [`${code}-secondary`],
    longTail: [],
    buyerIntent: [],
    product: [],
    material: [],
    style: [],
    room: [],
    seasonal: [],
    competitor: [],
  };
}

function generatedFor(language: EtsyLanguage, keywords: KeywordGroups | null): GeneratedListing<Row> {
  return {
    listing: { title: `${language.code}:${keywords?.primary[0] ?? "none"}`, languageCode: language.code },
    score: 88,
    validationStatus: "pass",
    provider: "gemini",
    model: "test-model",
    backupUsed: false,
    notes: [],
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("content hash ignores key order and whitespace but tracks real content", () => {
  const base = { projectName: "Rug", category: "Home", title: "Handmade cotton rug", description: "Soft  rug.\n", tags: "rug, cotton" };
  assert.equal(contentHash(base), contentHash({ ...base, description: "Soft rug." }));
  assert.notEqual(contentHash(base), contentHash({ ...base, title: "Handmade wool rug" }));
  assert.notEqual(contentHash(base), contentHash({ ...base, images: [{ url: "https://example.com/a.jpg" }] }));
  assert.equal(
    contentHash({ ...base, images: [{ url: "https://example.com/a.jpg" }] }),
    contentHash({ ...base, images: [{ url: "https://example.com/a.jpg" }] })
  );
});

test("multi-language research parser accepts all ten markets and reports missing ones", () => {
  const reply = Object.fromEntries(
    ETSY_LANGUAGES.map((language) => [
      language.code,
      { primary: [`${language.code} term`], secondary: [`${language.code} secondary`], long_tail: [`${language.code} long`] },
    ])
  );
  const full = parseMultiLanguageKeywordOutput(JSON.stringify({ languages: reply }), ETSY_LANGUAGES.map((l) => l.code));
  assert.equal(full.ok, true);
  if (full.ok) {
    assert.equal(Object.keys(full.groups).length, 10);
    assert.deepEqual(full.missing, []);
    assert.deepEqual(full.groups.de.primary, ["de term"]);
    assert.deepEqual(full.groups.de.longTail, ["de long"]);
  }

  const partial = { ...reply } as Record<string, unknown>;
  delete partial.sv;
  const missing = parseMultiLanguageKeywordOutput(JSON.stringify(partial), ETSY_LANGUAGES.map((l) => l.code));
  assert.equal(missing.ok, true);
  if (missing.ok) assert.deepEqual(missing.missing, ["sv"]);

  const unknown = parseMultiLanguageKeywordOutput(JSON.stringify({ ...reply, xx: { primary: ["nope"] } }), ETSY_LANGUAGES.map((l) => l.code));
  assert.equal(unknown.ok, true);
  if (unknown.ok) assert.equal("xx" in unknown.groups, false);

  const junk = parseMultiLanguageKeywordOutput("not json at all", ["nl"]);
  assert.equal(junk.ok, false);
});

test("mapWithConcurrency keeps input order, isolates errors and respects the limit", async () => {
  let inFlight = 0;
  let peak = 0;
  const settled = await mapWithConcurrency([5, 1, 3, 2, 4], 2, async (value) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await sleep(value * 2);
    inFlight -= 1;
    if (value === 3) throw new Error("boom");
    return value * 10;
  });

  assert.equal(peak, 2);
  assert.deepEqual(settled.map((entry) => (entry.ok ? entry.value : "error")), [50, 10, "error", 20, 40]);
  assert.deepEqual(await mapWithConcurrency([], 4, async () => 1), []);
});

test("one research pass feeds every market and all ten generate in parallel", async () => {
  const events: Array<PipelineEvent<Row>> = [];
  const researchCalls: string[][] = [];
  const generated: string[] = [];
  let inFlight = 0;
  let peak = 0;

  const summary = await runGenerationPipeline<Row>({
    languages: ETSY_LANGUAGES,
    concurrency: 4,
    cache: { listing: () => null, keywords: null },
    research: async (languages) => {
      researchCalls.push(languages.map((language) => language.code));
      return {
        groups: Object.fromEntries(languages.map((language) => [language.code, groupsFor(language.code)])),
        provider: "gemini",
        model: "test-model",
        durationMs: 5,
        missing: [],
      };
    },
    generate: async (language, keywords) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      generated.push(language.code);
      await sleep(language.code === "sv" ? 30 : 5);
      inFlight -= 1;
      return generatedFor(language, keywords);
    },
    save: async (_language, generatedRow) => generatedRow.listing,
    emit: (event) => events.push(event),
  });

  assert.equal(researchCalls.length, 1, "keyword research must run once, not once per language");
  assert.deepEqual(researchCalls[0], ETSY_LANGUAGES.map((language) => language.code));
  assert.equal(generated.length, 10);
  assert.ok(peak > 1, "languages must generate concurrently");
  assert.ok(peak <= 4, "concurrency is a real ceiling");
  assert.equal(summary.generated, 10);
  assert.deepEqual(summary.failed, []);
  assert.equal(summary.keywordSource, "researched");

  // Each language received only its own country's keyword slice.
  const svCompleted = events.find((event) => event.type === "language" && event.languageCode === "sv" && event.status === "completed");
  assert.ok(svCompleted && svCompleted.type === "language");
  assert.equal((svCompleted.listing as Row).title, "sv:sv-primary");

  // Progressive display: a language's completed event arrives before `done`,
  // and the slow market is not required for the fast ones to appear.
  const doneIndex = events.findIndex((event) => event.type === "done");
  const firstCompleted = events.findIndex((event) => event.type === "language" && event.status === "completed");
  assert.ok(firstCompleted > -1 && firstCompleted < doneIndex);
  const completedBeforeDone = events.filter((event) => event.type === "language" && event.status === "completed").length;
  assert.equal(completedBeforeDone, 10);
  assert.equal(events[events.length - 1].type, "done");
});

test("a failing market is isolated and retryable on its own", async () => {
  const events: Array<PipelineEvent<Row>> = [];
  const generated: string[] = [];
  let researchRuns = 0;

  const summary = await runGenerationPipeline<Row>({
    languages: ETSY_LANGUAGES.slice(0, 3),
    concurrency: 3,
    cache: { listing: () => null, keywords: { de: groupsFor("de"), fr: groupsFor("fr"), nl: groupsFor("nl") } },
    research: async () => {
      researchRuns += 1;
      throw new Error("research should have been cached");
    },
    generate: async (language, keywords) => {
      generated.push(language.code);
      if (language.code === "fr") throw new Error("provider timeout");
      return generatedFor(language, keywords);
    },
    save: async (_language, generatedRow) => generatedRow.listing,
    emit: (event) => events.push(event),
  });

  assert.equal(researchRuns, 0);
  assert.deepEqual(generated.sort(), ["de", "fr", "nl"]);
  assert.deepEqual(summary.failed, ["fr"]);
  assert.equal(summary.generated, 2);
  assert.equal(summary.keywordSource, "cached");
  const failure = events.find((event) => event.type === "language" && event.languageCode === "fr" && event.status === "failed");
  assert.ok(failure && failure.type === "language");
  assert.match(failure.error ?? "", /provider timeout/);
});

test("cache serves unchanged markets and a retry regenerates only the failures", async () => {
  const generated: string[] = [];
  const cachedRow: Row = { title: "cached de", languageCode: "de" };
  const cache: Record<string, CachedListing<Row>> = { de: { listing: cachedRow, hasAltText: true } };
  const events: Array<PipelineEvent<Row>> = [];

  const summary = await runGenerationPipeline<Row>({
    languages: ETSY_LANGUAGES.slice(0, 3),
    // A failed language is force-regenerated; the other cached market is reused.
    forceCodes: ["fr"],
    concurrency: 2,
    cache: {
      listing: (code) => cache[code] ?? null,
      keywords: { de: groupsFor("de"), fr: groupsFor("fr"), nl: groupsFor("nl") },
    },
    research: async () => {
      throw new Error("must not research");
    },
    generate: async (language, keywords) => {
      generated.push(language.code);
      return generatedFor(language, keywords);
    },
    save: async (_language, generatedRow) => generatedRow.listing,
    emit: (event) => events.push(event),
  });

  assert.deepEqual(generated.sort(), ["fr", "nl"]);
  assert.equal(summary.cached, 1);
  assert.equal(summary.generated, 2);
  const cachedEvent = events.find((event) => event.type === "language" && event.languageCode === "de" && event.status === "cached");
  assert.ok(cachedEvent && cachedEvent.type === "language");
  assert.deepEqual(cachedEvent.listing, cachedRow);
});

test("a failed research pass degrades to facts-only generation instead of failing the run", async () => {
  const captured: Array<KeywordGroups | null> = [];
  const summary = await runGenerationPipeline<Row>({
    languages: ETSY_LANGUAGES.slice(0, 2),
    concurrency: 2,
    cache: { listing: () => null, keywords: null },
    research: async () => {
      throw new Error("rate limited");
    },
    generate: async (language, keywords) => {
      captured.push(keywords);
      return generatedFor(language, keywords);
    },
    save: async (_language, generatedRow) => generatedRow.listing,
    emit: () => {},
  });

  assert.deepEqual(captured, [null, null]);
  assert.equal(summary.keywordSource, "unavailable");
  assert.equal(summary.generated, 2);
});

test("alt text is written once per photo for all ten languages and merged after saving", async () => {
  const events: Array<PipelineEvent<Row>> = [];
  const mergeCalls: Array<Array<{ image: number; altTexts: Record<string, string> }>> = [];
  let visionCalls = 0;

  await runGenerationPipeline<Row>({
    languages: ETSY_LANGUAGES.slice(0, 2),
    concurrency: 2,
    cache: { listing: () => null, keywords: { de: groupsFor("de"), fr: groupsFor("fr") } },
    research: async () => {
      throw new Error("cached");
    },
    generate: async (language, keywords) => generatedFor(language, keywords),
    save: async (_language, generatedRow) => generatedRow.listing,
    altText: {
      imageCount: 2,
      generate: async (imageIndex) => {
        visionCalls += 1;
        return { altTexts: { de: `de image ${imageIndex + 1}`, fr: `fr image ${imageIndex + 1}` }, durationMs: 1 };
      },
      merge: async (results) => {
        mergeCalls.push(results.map((entry) => ({ image: entry.image, altTexts: entry.altTexts })));
        return [
          { languageCode: "de", altTexts: [{ image: 1, text: "de image 1" }], validationStatus: "pass", score: 90 },
        ];
      },
    },
    emit: (event) => events.push(event),
  });

  assert.equal(visionCalls, 2, "one vision call per image, not per image × language");
  assert.equal(mergeCalls.length, 1);
  assert.deepEqual(mergeCalls[0].map((entry) => entry.image), [1, 2]);
  const altEvent = events.find((event) => event.type === "alt_text" && event.status === "completed");
  assert.ok(altEvent && altEvent.type === "alt_text");
  assert.equal(altEvent.updated?.[0].languageCode, "de");
});
