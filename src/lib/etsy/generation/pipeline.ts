// 2026-11-24 — The ten-language generation pipeline, without Next.js, Supabase
// or a network. Everything environment-specific is injected, so the ordering,
// cache reuse, concurrency, partial-failure and retry rules are unit-testable
// and the route stays a thin adapter.
//
// What a run does, in this order:
//   1. Emit `started` (the caller can flush this immediately — the "response
//      starts in about a second" promise is about this event, not completion).
//   2. Reuse a listing whose source hash matches; everything else is queued.
//   3. Research keywords ONCE for the markets that still need them, then hand
//      each language only its own slice. A failed research step degrades the
//      output; it does not fail the run.
//   4. Generate + save the remaining languages in parallel with a bounded
//      worker pool. Each language emits its own completed/failed event the
//      moment it settles, so the UI never waits for the slowest market.
//   5. Image alt text runs alongside generation (one vision call per image
//      returns all ten languages) and is merged into the saved listings.
//
// A failing market is isolated: `mapWithConcurrency` records the error, the
// other nine keep their rows, and the summary lists the failures so the caller
// can retry exactly those codes.

import type { KeywordGroups } from "../ai/schemas";
import type { EtsyLanguage } from "../languages";
import { mapWithConcurrency } from "./concurrency";

export type CachedListing<T> = { listing: T; hasAltText: boolean };

export type GeneratedListing<T> = {
  listing: T;
  score: number | null;
  validationStatus: string;
  provider: string;
  model: string;
  backupUsed: boolean;
  notes: string[];
};

export type AltTextResult = { image: number; altTexts: Record<string, string> };

export type AltTextUpdate = {
  languageCode: string;
  altTexts: Array<{ image: number; text: string }>;
  validationStatus: string;
  score: number | null;
};

export type LanguageRunStatus = "queued" | "running" | "completed" | "cached" | "failed";

export type PipelineEvent<T> =
  | { type: "started"; languageCodes: string[]; startedAt: number; concurrency: number }
  | {
      type: "keywords";
      status: "running" | "completed" | "cached" | "failed";
      languageCodes?: string[];
      provider?: string;
      model?: string;
      durationMs?: number;
      missing?: string[];
      error?: string;
    }
  | {
      type: "language";
      languageCode: string;
      status: LanguageRunStatus;
      durationMs?: number;
      score?: number | null;
      validationStatus?: string;
      provider?: string;
      model?: string;
      backupUsed?: boolean;
      notes?: string[];
      listing?: T;
      error?: string;
    }
  | {
      type: "alt_text";
      status: "running" | "completed" | "failed";
      images?: number;
      done?: number;
      updated?: AltTextUpdate[];
      error?: string;
    }
  | { type: "done"; summary: PipelineSummary };

export type LanguageSummary = {
  languageCode: string;
  status: LanguageRunStatus;
  durationMs: number;
  score?: number | null;
  error?: string;
};

export type PipelineSummary = {
  startedAt: number;
  durationMs: number;
  total: number;
  generated: number;
  cached: number;
  failed: string[];
  keywordSource: "cached" | "researched" | "unavailable";
  languages: LanguageSummary[];
};

export type PipelineDeps<T> = {
  languages: EtsyLanguage[];
  /** Markets that must be regenerated even when a cached listing exists. */
  forceCodes?: Iterable<string>;
  /** Max AI requests in flight (1–10). */
  concurrency: number;
  emit: (event: PipelineEvent<T>) => void;
  cache: {
    listing: (languageCode: string) => CachedListing<T> | null;
    /** Keyword data from the previous run, or null when the source changed. */
    keywords: Record<string, KeywordGroups> | null;
  };
  /** One research pass for the given markets; may throw. */
  research: (
    languages: EtsyLanguage[]
  ) => Promise<{ groups: Record<string, KeywordGroups>; provider: string; model: string; durationMs: number; missing: string[] }>;
  generate: (language: EtsyLanguage, keywords: KeywordGroups | null) => Promise<GeneratedListing<T>>;
  save: (language: EtsyLanguage, generated: GeneratedListing<T>) => Promise<T>;
  altText?: {
    imageCount: number;
    generate: (imageIndex: number, imageCount: number) => Promise<{ altTexts: Record<string, string>; durationMs: number }>;
    merge: (results: AltTextResult[]) => Promise<AltTextUpdate[]>;
  };
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runGenerationPipeline<T>(deps: PipelineDeps<T>): Promise<PipelineSummary> {
  const startedAt = Date.now();
  const force = new Set([...((deps.forceCodes as Iterable<string> | undefined) ?? [])]);
  const results = new Map<string, LanguageSummary>();

  deps.emit({
    type: "started",
    languageCodes: deps.languages.map((language) => language.code),
    startedAt,
    concurrency: deps.concurrency,
  });

  // 1. Cache check first: a cached market is visible immediately, and only the
  //    rest is queued for work.
  const pending: EtsyLanguage[] = [];
  for (const language of deps.languages) {
    const cached = force.has(language.code) ? null : deps.cache.listing(language.code);
    if (cached) {
      results.set(language.code, { languageCode: language.code, status: "cached", durationMs: 0 });
      deps.emit({ type: "language", languageCode: language.code, status: "cached", listing: cached.listing, durationMs: 0 });
    } else {
      pending.push(language);
    }
  }
  for (const language of pending) {
    results.set(language.code, { languageCode: language.code, status: "queued", durationMs: 0 });
    deps.emit({ type: "language", languageCode: language.code, status: "queued" });
  }

  // 2. One keyword research pass for every market that still needs it.
  let keywords: Record<string, KeywordGroups> | null = deps.cache.keywords;
  let keywordSource: PipelineSummary["keywordSource"] = keywords ? "cached" : "unavailable";

  if (pending.length > 0) {
    const missingKeywords = pending.filter((language) => !keywords?.[language.code]);
    if (keywords && missingKeywords.length === 0) {
      deps.emit({
        type: "keywords",
        status: "cached",
        languageCodes: pending.map((language) => language.code),
        durationMs: 0,
      });
      keywordSource = "cached";
    } else if (missingKeywords.length > 0) {
      deps.emit({
        type: "keywords",
        status: "running",
        languageCodes: missingKeywords.map((language) => language.code),
      });
      try {
        const research = await deps.research(missingKeywords);
        keywords = { ...(keywords ?? {}), ...research.groups };
        keywordSource = "researched";
        deps.emit({
          type: "keywords",
          status: "completed",
          languageCodes: Object.keys(research.groups),
          provider: research.provider,
          model: research.model,
          durationMs: research.durationMs,
          missing: research.missing,
        });
      } catch (error) {
        // Generation still works without local keywords: the prompt falls back
        // to deriving native phrases from the product facts. Report, don't fail.
        keywordSource = keywords ? "cached" : "unavailable";
        deps.emit({ type: "keywords", status: "failed", error: errorMessage(error) });
      }
    }
  }

  // 3. Alt text runs alongside generation: one vision call per image returns
  //    all ten languages, so ten images cost ten calls, not a hundred.
  let altTextPromise: Promise<{ results: AltTextResult[]; failures: string[] }> | null = null;
  if (deps.altText && deps.altText.imageCount > 0) {
    const altText = deps.altText;
    altTextPromise = (async () => {
      deps.emit({ type: "alt_text", status: "running", images: altText.imageCount, done: 0 });
      const indexes = Array.from({ length: altText.imageCount }, (_, index) => index);
      const settled = await mapWithConcurrency(indexes, 3, async (index) => {
        try {
          const result = await altText.generate(index, altText.imageCount);
          return { image: index + 1, altTexts: result.altTexts };
        } catch (error) {
          return { image: index + 1, altTexts: {}, error: errorMessage(error) } as const;
        }
      });
      const results: AltTextResult[] = [];
      const failures: string[] = [];
      settled.forEach((entry, position) => {
        if (entry.ok && Object.keys(entry.value.altTexts).length > 0) {
          results.push({ image: entry.value.image, altTexts: entry.value.altTexts });
        } else {
          const error = entry.ok ? (entry.value as { error?: string }).error ?? "no alt text returned" : errorMessage(entry.error);
          failures.push(`image ${position + 1}: ${error}`);
        }
      });
      return { results, failures };
    })();
  }

  // 4. Generate the remaining markets in parallel; each settles independently.
  const runOne = async (language: EtsyLanguage) => {
    const started = Date.now();
    deps.emit({ type: "language", languageCode: language.code, status: "running" });
    try {
      const generated = await deps.generate(language, keywords?.[language.code] ?? null);
      const saved = await deps.save(language, generated);
      const durationMs = Date.now() - started;
      results.set(language.code, {
        languageCode: language.code,
        status: "completed",
        durationMs,
        score: generated.score,
      });
      deps.emit({
        type: "language",
        languageCode: language.code,
        status: "completed",
        durationMs,
        score: generated.score,
        validationStatus: generated.validationStatus,
        provider: generated.provider,
        model: generated.model,
        backupUsed: generated.backupUsed,
        notes: generated.notes,
        listing: saved,
      });
    } catch (error) {
      const durationMs = Date.now() - started;
      results.set(language.code, {
        languageCode: language.code,
        status: "failed",
        durationMs,
        error: errorMessage(error),
      });
      deps.emit({
        type: "language",
        languageCode: language.code,
        status: "failed",
        durationMs,
        error: errorMessage(error),
      });
    }
  };

  await mapWithConcurrency(pending, deps.concurrency, runOne);

  // 5. Merge alt text into the listings that exist now, and report exactly
  //    which languages changed so the UI can update them in place.
  if (altTextPromise) {
    try {
      const { results: altResults, failures } = await altTextPromise;
      if (altResults.length > 0) {
        const updated = await deps.altText!.merge(altResults);
        deps.emit({ type: "alt_text", status: "completed", images: deps.altText!.imageCount, done: altResults.length, updated });
      }
      if (failures.length > 0) {
        deps.emit({ type: "alt_text", status: "failed", error: failures.join(" | ") });
      }
    } catch (error) {
      deps.emit({ type: "alt_text", status: "failed", error: errorMessage(error) });
    }
  }

  const languages = deps.languages.map(
    (language) => results.get(language.code) ?? { languageCode: language.code, status: "failed" as const, durationMs: 0, error: "not run" }
  );
  const summary: PipelineSummary = {
    startedAt,
    durationMs: Date.now() - startedAt,
    total: deps.languages.length,
    generated: languages.filter((language) => language.status === "completed").length,
    cached: languages.filter((language) => language.status === "cached").length,
    failed: languages.filter((language) => language.status === "failed").map((language) => language.languageCode),
    keywordSource,
    languages,
  };
  deps.emit({ type: "done", summary });
  return summary;
}
