import { NextResponse } from "next/server";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { ETSY_LANGUAGES, etsyLanguage, type EtsyLanguage } from "@/lib/etsy/languages";
import {
  keywordGroupsFromRows,
  parseListingOutput,
  parseMultiLanguageKeywordOutput,
  type KeywordGroups,
} from "@/lib/etsy/ai/schemas";
import {
  altTextSystemPrompt,
  listingSystemPrompt,
  listingUserPrompt,
  multiLanguageKeywordSystemPrompt,
  multiLanguageKeywordUserPrompt,
} from "@/lib/etsy/ai/prompts";
import { mergeAltTextEntry, parseAltTextBundle } from "@/lib/etsy/ai/alt-text";
import { fetchImageForVision } from "@/lib/etsy/ai/gemini.provider";
import { ProviderError } from "@/lib/etsy/ai/types";
import { diagnosticBody, explainProviderError } from "@/lib/etsy/ai/diagnostics";
import { loadCompanyAiContext, managerConfig, monthlySpendUsd, recordUsage } from "@/lib/etsy/ai/company-ai";
import { validateListing, type AltTextEntry } from "@/lib/etsy/seo-validation";
import { validateAltText } from "@/lib/etsy/validation";
import type { EtsyProductFacts } from "@/lib/etsy/product";
import { recordsFromAiGroups } from "@/lib/etsy/research";
import { contentHash } from "@/lib/etsy/generation/source-hash";
import {
  runGenerationPipeline,
  type AltTextResult,
  type AltTextUpdate,
  type CachedListing,
  type GeneratedListing,
} from "@/lib/etsy/generation/pipeline";
import { jsonError, rateLimit, rateLimited, readJsonBody, requireEtsySeoEmployee, tooLarge } from "@/lib/etsy/api";

// 2026-11-24 — Generate ALL ten markets from one request, streaming results.
//
// Why this route exists: the page used to loop ten single-language requests one
// after another, so completion time was the SUM of ten AI calls and keyword
// research was paid for per market. Here:
//
//   * keyword research runs ONCE for every market and is then distributed,
//   * the ten generations run in parallel with bounded concurrency,
//   * each finished market is streamed to the browser the moment it is saved,
//   * a market's listing/keywords are reused when the English source hash has
//     not changed (no duplicate AI spend),
//   * one failed market never discards the other nine, and the browser can
//     retry exactly the failed codes.
//
// What "fast" honestly means: the HTTP response and the `started` event arrive
// in well under a second, then events stream. Full researched, validated output
// for ten markets still takes as long as the provider needs — nobody can
// promise one second for that. Serverless limits also mean the run ends if the
// function is killed; completed markets are already saved.
export const runtime = "nodejs";
export const maxDuration = 300;

type Body = { projectId?: string; languages?: string[]; force?: boolean };

type ProjectRow = {
  id: string;
  company_id: string;
  project_name: string;
  category: string | null;
  original_title: string;
  original_description: string;
  original_tags: string;
  product: EtsyProductFacts | null;
  images: Array<{ url?: string; storage_path?: string; order?: number; description?: string }> | null;
  source_hash?: string | null;
  generation_status?: string | null;
};

type Supabase = ReturnType<typeof createServiceRoleClientUnchecked>;

/** Concurrency for the language workers; overridable for slow provider tiers. */
function generationConcurrency(): number {
  const raw = Number(process.env.ETSY_SEO_CONCURRENCY ?? 4);
  if (!Number.isFinite(raw)) return 4;
  return Math.min(10, Math.max(1, Math.round(raw)));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Stream Server-Sent Events. The pipeline is NOT aborted when the browser goes
 * away: the work continues and every finished market is still saved, which is
 * what lets a user leave the page and come back to completed rows.
 */
function eventStream(run: (emit: (event: unknown) => void) => Promise<void>): Response {
  const encoder = new TextEncoder();
  let open = true;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          open = false;
        }
      };
      const emit = (event: unknown) => write(`data: ${JSON.stringify(event)}\n\n`);

      // Flush headers immediately: the request is accepted before any AI call.
      write(": connected\n\n");
      const heartbeat = setInterval(() => write(": keep-alive\n\n"), 15_000);

      void run(emit)
        .catch((error) => emit({ type: "error", error: errorMessage(error) }))
        .finally(() => {
          clearInterval(heartbeat);
          if (!open) return;
          open = false;
          try {
            controller.close();
          } catch {
            /* already closed by the client */
          }
        });
    },
    cancel() {
      open = false;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(request: Request) {
  const auth = await requireEtsySeoEmployee();
  if ("response" in auth) return auth.response;
  const me = auth.employee;

  if (tooLarge(request, 64 * 1024)) return jsonError("Request body is too large.", 413);
  // A full run is one request; allow a generous per-minute budget for retries.
  const limit = rateLimit(`etsy-seo-generate-all:${me.id}`, 10, 60_000);
  if (!limit.ok) return rateLimited(limit.retryAfterSeconds);

  const parsedBody = await readJsonBody<Body>(request);
  if ("response" in parsedBody) return parsedBody.response;
  const { projectId, languages: requestedLanguages, force } = parsedBody.body;
  if (!projectId) return jsonError("projectId is required.", 400);

  const only = Array.isArray(requestedLanguages) ? requestedLanguages.map((code) => String(code)) : null;
  const unknown = only?.filter((code) => !etsyLanguage(code));
  if (unknown && unknown.length > 0) {
    return jsonError(`Unknown language code(s): ${unknown.join(", ")}. Expected: ${ETSY_LANGUAGES.map((l) => l.code).join(", ")}.`, 400);
  }
  const targets: EtsyLanguage[] = only && only.length > 0
    ? ETSY_LANGUAGES.filter((language) => only.includes(language.code))
    : ETSY_LANGUAGES;

  const supabase = createServiceRoleClientUnchecked();

  const { data: projectData, error: projectError } = await supabase
    .from("etsy_seo_projects")
    .select("*")
    .eq("id", projectId)
    .in("company_id", me.companyIds)
    .maybeSingle();

  if (projectError) {
    return jsonError(
      /does not exist|schema cache|relation/i.test(projectError.message)
        ? "The Etsy SEO tables are missing — run db/2026-11-18-etsy-seo-generator.sql in Supabase first."
        : projectError.message,
      500
    );
  }
  if (!projectData) return jsonError("Project not found in your company.", 404);
  const project = projectData as unknown as ProjectRow;
  if (!project.original_title?.trim()) return jsonError("Add the English product title before generating.", 400);

  return eventStream(async (emit) => {
    const context = await loadCompanyAiContext(supabase, project.company_id);
    if (!context.credentials.geminiApiKey && !context.credentials.openRouterApiKey) {
      const diagnostic = explainProviderError(
        new ProviderError("GEMINI_API_KEY is not configured.", { provider: "gemini", retryable: false, kind: "auth" }),
        "gemini"
      );
      emit({ type: "error", ...diagnosticBody(diagnostic), code: "provider_not_configured" });
      return;
    }
    if (context.settings.monthlyBudgetUsd > 0) {
      const spent = await monthlySpendUsd(supabase, project.company_id);
      if (spent >= context.settings.monthlyBudgetUsd) {
        emit({
          type: "error",
          code: "budget_exhausted",
          error: `The monthly AI budget ($${context.settings.monthlyBudgetUsd.toFixed(2)}) is used up — raise it in Settings or wait for next month.`,
        });
        return;
      }
    }

    const facts: EtsyProductFacts = { ...(project.product ?? {}) };
    if (!facts.productName) facts.productName = project.project_name;
    if (!facts.category) facts.category = project.category ?? undefined;
    const images = Array.isArray(project.images) ? project.images.filter((image) => !!image?.url) : [];
    const hash = contentHash({
      projectName: project.project_name,
      category: project.category,
      title: project.original_title,
      description: project.original_description,
      tags: project.original_tags,
      product: facts as Record<string, unknown>,
      images,
    });

    // Existing rows: served as cache when the source hash still matches.
    const { data: existingRows } = await supabase.from("etsy_seo_listings").select("*").eq("project_id", project.id);
    const existingByCode = new Map<string, Record<string, unknown>>();
    for (const row of existingRows ?? []) existingByCode.set(row.language_code as string, row as Record<string, unknown>);

    const { data: competitorRows } = await supabase
      .from("etsy_seo_competitors")
      .select("competitor_title, analysis")
      .eq("project_id", project.id)
      .limit(5);
    const competitorNotes = (competitorRows ?? [])
      .map((row) => {
        const analysis = row.analysis as { keyword_gaps?: string[]; differentiation?: string[] } | null;
        const parts = [row.competitor_title, analysis?.keyword_gaps?.join(", "), analysis?.differentiation?.join(", ")].filter(Boolean);
        return parts.length > 0 ? parts.join(" · ") : null;
      })
      .filter(Boolean)
      .join("\n") || null;

    // Keyword cache: the project hash records which English source the stored
    // rows were researched from. No hash column (migration not applied) means
    // no reuse — never stale keywords.
    let keywordCache: Record<string, KeywordGroups> | null = null;
    if (project.source_hash && project.source_hash === hash) {
      const { data: keywordRows } = await supabase
        .from("etsy_seo_keywords")
        .select("language_code, keyword, keyword_type, source")
        .eq("project_id", project.id);
      const byLanguage = new Map<string, Array<{ keyword: string; keyword_type: string }>>();
      for (const row of keywordRows ?? []) {
        const code = row.language_code as string;
        const list = byLanguage.get(code) ?? [];
        list.push({ keyword: row.keyword as string, keyword_type: row.keyword_type as string });
        byLanguage.set(code, list);
      }
      const groups: Record<string, KeywordGroups> = {};
      for (const [code, rows] of byLanguage) {
        const parsed = keywordGroupsFromRows(rows);
        if (Object.values(parsed).some((list) => list.length > 0)) groups[code] = parsed;
      }
      if (Object.keys(groups).length > 0) keywordCache = groups;
    }

    const forceCodes = new Set<string>((force ? targets.map((language) => language.code) : only ?? []));

    const cache = {
      keywords: keywordCache,
      listing: (code: string): CachedListing<Record<string, unknown>> | null => {
        if (forceCodes.has(code)) return null;
        const row = existingByCode.get(code);
        if (!row) return null;
        if (project.source_hash !== hash || row.source_hash !== hash) return null;
        const tags = Array.isArray(row.tags) ? (row.tags as unknown[]) : [];
        if (!row.title || !row.description || tags.length !== 13) return null;
        return { listing: row, hasAltText: (Array.isArray(row.alt_texts) ? (row.alt_texts as unknown[]) : []).length >= images.length };
      },
    };

    // Job bookkeeping: current_step holds per-language state so a returning tab
    // can render real progress instead of an empty table.
    const progress: Record<string, string> = {};
    for (const language of ETSY_LANGUAGES) progress[language.code] = "queued";
    const { data: jobRow } = await supabase
      .from("etsy_seo_jobs")
      .insert({
        project_id: project.id,
        company_id: project.company_id,
        status: "running",
        current_step: JSON.stringify(progress),
        progress: 0,
        languages_total: targets.length,
        languages_done: 0,
      })
      .select("id")
      .single();
    const jobId = (jobRow?.id as string | undefined) ?? null;

    // Mark the project as running so a tab that is closed and reopened knows to
    // poll GET for real per-language state instead of showing an empty table.
    await supabase
      .from("etsy_seo_projects")
      .update({ generation_status: "running", updated_at: new Date().toISOString() })
      .eq("id", project.id);

    const persistJob = async (patch: Record<string, unknown>) => {
      if (!jobId) return;
      try {
        await supabase.from("etsy_seo_jobs").update({ ...patch, current_step: JSON.stringify(progress) }).eq("id", jobId);
      } catch {
        /* job bookkeeping must never fail a generation */
      }
    };

    const usageContext = { companyId: project.company_id, projectId: project.id, employeeId: me.id };

    /** One AI call: shared, country-specific keyword research for all markets. */
    const research = async (languages: EtsyLanguage[]) => {
      const startedAt = Date.now();
      const call = async (markets: EtsyLanguage[]) => {
        const result = await context.manager.generateStructured({
          operation: "research_shared",
          system: multiLanguageKeywordSystemPrompt(),
          prompt: multiLanguageKeywordUserPrompt({
            languages: markets,
            facts,
            englishTitle: project.original_title,
            englishDescription: project.original_description || undefined,
          }),
          temperature: 0.7,
          maxOutputTokens: 4096,
          config: managerConfig(context.settings),
          parse: (text) => {
            const parsed = parseMultiLanguageKeywordOutput(text, markets.map((language) => language.code));
            if (!parsed.ok) return { ok: false, issues: parsed.issues };
            return { ok: true, data: parsed.groups };
          },
          onAttempt: (log) => recordUsage(supabase, usageContext, log),
        });
        return result;
      };

      const first = await call(languages);
      let groups: Record<string, KeywordGroups> = { ...first.data };
      let missing = languages.map((language) => language.code).filter((code) => !groups[code]);
      let provider = first.provider;
      let model = first.model;

      // Only the markets the first reply missed are asked for again — never all.
      if (missing.length > 0) {
        try {
          const retry = await call(languages.filter((language) => missing.includes(language.code)));
          groups = { ...groups, ...retry.data };
          missing = languages.map((language) => language.code).filter((code) => !groups[code]);
          provider = retry.provider;
          model = retry.model;
        } catch {
          /* keep the partial research; those markets generate without it */
        }
      }

      // Persist the research for the next run (cache) — replace only AI/file rows.
      for (const language of languages) {
        const languageGroups = groups[language.code];
        if (!languageGroups) continue;
        const records = recordsFromAiGroups(languageGroups as unknown as Record<string, string[]>, language);
        await supabase
          .from("etsy_seo_keywords")
          .delete()
          .eq("project_id", project.id)
          .eq("language_code", language.code)
          .in("source", ["ai", "user_file"]);
        if (records.length > 0) {
          await supabase.from("etsy_seo_keywords").insert(
            records.map((record) => ({
              project_id: project.id,
              company_id: project.company_id,
              country: record.country,
              language_code: record.languageCode,
              keyword: record.keyword,
              keyword_type: record.keywordType,
              source: record.source,
              verified: record.verified,
              search_volume: record.searchVolume,
              competition: record.competition,
              trend_data: record.trend,
              confidence: record.confidence,
              source_url: record.sourceUrl,
              researched_at: record.researchedAt,
            }))
          );
        }
      }

      return { groups, provider, model, durationMs: Date.now() - startedAt, missing };
    };

    /** One AI call per market: title + description + exactly 13 tags. */
    const generate = async (
      language: EtsyLanguage,
      keywords: KeywordGroups | null
    ): Promise<GeneratedListing<Record<string, unknown>>> => {
      const result = await context.manager.generateStructured({
        operation: "listing",
        system: listingSystemPrompt(),
        prompt: listingUserPrompt({
          language,
          facts,
          englishTitle: project.original_title,
          englishDescription: project.original_description || undefined,
          englishTags: project.original_tags || undefined,
          keywords,
          competitorNotes,
          imageCount: 0, // alt text is generated from the photos, separately
          field: "all",
        }),
        temperature: 0.6,
        config: managerConfig(context.settings),
        parse: (text) => parseListingOutput(text, { field: "all", imageCount: 0 }),
        onAttempt: (log) => recordUsage(supabase, usageContext, log),
      });

      const generated = result.data;
      const previous = existingByCode.get(language.code) ?? null;
      const previousAltTexts = (previous?.alt_texts as AltTextEntry[] | null) ?? [];
      const primaryKeyword = generated.primaryKeyword || null;
      const secondaryKeywords = generated.secondaryKeywords;
      const report = validateListing({
        languageCode: language.code,
        locale: language.locale,
        title: generated.title,
        description: generated.description,
        tags: generated.tags,
        altTexts: previousAltTexts,
        imageCount: images.length,
        keywords: { primary: primaryKeyword ?? undefined, secondary: secondaryKeywords },
        sourceTitle: project.original_title,
      });

      return {
        listing: {
          project_id: project.id,
          company_id: project.company_id,
          country: language.country,
          language_code: language.code,
          language_name: language.name,
          locale: language.locale,
          title: generated.title,
          description: generated.description,
          tags: generated.tags,
          alt_texts: previousAltTexts,
          seo_score: report.score,
          validation_status: report.status,
          validation_report: report,
          primary_keyword: primaryKeyword,
          secondary_keywords: secondaryKeywords,
          provider: result.provider,
          model: result.model,
          backup_used: result.backupUsed,
          version: ((previous?.version as number | undefined) ?? 0) + 1,
          edited_manually: false,
          source_hash: hash,
          updated_at: new Date().toISOString(),
        },
        score: report.score,
        validationStatus: report.status,
        provider: result.provider,
        model: result.model,
        backupUsed: result.backupUsed,
        notes: generated.notes,
      };
    };

    /** Save one market, keeping the previous text as a version. */
    const save = async (language: EtsyLanguage, generated: GeneratedListing<Record<string, unknown>>) => {
      const previous = existingByCode.get(language.code) ?? null;
      if (previous?.id) {
        await supabase.from("etsy_seo_listing_versions").insert({
          listing_id: previous.id,
          company_id: project.company_id,
          version: (previous.version as number | undefined) ?? 1,
          title: (previous.title as string | undefined) ?? "",
          description: (previous.description as string | undefined) ?? "",
          tags: previous.tags ?? [],
          alt_texts: previous.alt_texts ?? [],
          seo_score: (previous.seo_score as number | undefined) ?? null,
          reason: "generated_parallel",
          created_by_employee_id: me.id,
        });
      }

      let { data: saved, error } = await supabase
        .from("etsy_seo_listings")
        .upsert(generated.listing, { onConflict: "project_id,language_code" })
        .select("*")
        .single();
      if (error && /source_hash/i.test(error.message)) {
        const withoutHash = { ...generated.listing };
        delete withoutHash.source_hash;
        ({ data: saved, error } = await supabase
          .from("etsy_seo_listings")
          .upsert(withoutHash, { onConflict: "project_id,language_code" })
          .select("*")
          .single());
      }
      if (error) throw new Error(error.message);
      if (saved) existingByCode.set(language.code, saved as Record<string, unknown>);
      return (saved ?? generated.listing) as Record<string, unknown>;
    };

    /** One vision call per photo → all ten languages. */
    const generateAltText = async (imageIndex: number) => {
      const image = images[imageIndex];
      if (!image?.url) throw new Error("this image has no URL");
      const vision = await fetchImageForVision(image.url);
      const expected = ETSY_LANGUAGES.map((language) => language.code);
      const result = await context.manager.generateStructured({
        operation: "alt_text",
        system: altTextSystemPrompt(),
        prompt:
          `Generate the alt text for this product photo in ALL ten languages.\n` +
          `Product: ${project.original_title}\n${image.description ? `Visible content: ${image.description}\n` : ""}` +
          `Languages: ${ETSY_LANGUAGES.map((language) => `${language.code} (${language.name})`).join(", ")}.\n` +
          `Return ONLY JSON: {"alt_texts":[{"language_code":"nl","text":"…"} … all ten …]}`,
        images: [vision],
        temperature: 0.3,
        config: managerConfig(context.settings),
        parse: (text) => parseAltTextBundle(text, expected),
        onAttempt: (log) => recordUsage(supabase, usageContext, log),
      });
      return { altTexts: result.data.altTexts, durationMs: result.latencyMs };
    };

    /** Merge image alt text into every saved listing and revalidate it. */
    const mergeAltTexts = async (results: AltTextResult[]): Promise<AltTextUpdate[]> => {
      const { data: rows } = await supabase.from("etsy_seo_listings").select("*").eq("project_id", project.id);
      const updates: AltTextUpdate[] = [];
      for (const row of rows ?? []) {
        const code = row.language_code as string;
        const language = etsyLanguage(code);
        if (!language) continue;
        let altTexts = ((row.alt_texts as AltTextEntry[] | null) ?? []).slice();
        let changed = false;
        for (const entry of results) {
          const text = entry.altTexts[code];
          if (!text) continue;
          const check = validateAltText(text);
          altTexts = mergeAltTextEntry(altTexts, entry.image, check.valid ? text : text.slice(0, 250));
          changed = true;
        }
        if (!changed) continue;
        const report = validateListing({
          languageCode: code,
          locale: language.locale,
          title: (row.title as string | undefined) ?? "",
          description: (row.description as string | undefined) ?? "",
          tags: (row.tags as string[] | null) ?? [],
          altTexts,
          imageCount: images.length,
          keywords: {
            primary: (row.primary_keyword as string | null) ?? undefined,
            secondary: (row.secondary_keywords as string[] | null) ?? [],
          },
          sourceTitle: project.original_title,
        });
        await supabase
          .from("etsy_seo_listings")
          .update({
            alt_texts: altTexts,
            validation_status: report.status,
            seo_score: report.score,
            validation_report: report,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        existingByCode.set(code, { ...(row as Record<string, unknown>), alt_texts: altTexts });
        updates.push({ languageCode: code, altTexts, validationStatus: report.status, score: report.score });
      }
      return updates;
    };

    // Alt text is needed only for a saved listing that does not have one text per
    // photo yet. A forced regeneration keeps the previous alt texts (generate()
    // carries them over), so forcing alone must NOT trigger another vision pass.
    const anyListingMissingAltText = images.length > 0 && ETSY_LANGUAGES.some((language) => {
      const row = existingByCode.get(language.code);
      const count = Array.isArray(row?.alt_texts) ? (row!.alt_texts as unknown[]).length : 0;
      return count < images.length;
    });

    let summary: Awaited<ReturnType<typeof runGenerationPipeline>> | null = null;
    try {
      summary = await runGenerationPipeline<Record<string, unknown>>({
        languages: targets,
        forceCodes,
        concurrency: generationConcurrency(),
        cache,
        research,
        generate,
        save,
        altText: anyListingMissingAltText
          ? { imageCount: images.length, generate: generateAltText, merge: mergeAltTexts }
          : undefined,
        emit: (event) => {
          if (event.type === "language") {
            progress[event.languageCode] = event.status === "completed" || event.status === "cached" ? "completed" : event.status;
            const done = Object.values(progress).filter((status) => status === "completed").length;
            void persistJob({ languages_done: done, progress: targets.length === 0 ? 0 : Math.round((done / targets.length) * 100) });
          }
          emit(event);
        },
      });
    } catch (error) {
      await persistJob({ status: "failed", error_message: errorMessage(error), completed_at: new Date().toISOString() });
      // A crashed run must not leave the project flagged `running`, or every
      // reload would resume-poll a run that is no longer alive.
      await supabase
        .from("etsy_seo_projects")
        .update({ generation_status: "failed", updated_at: new Date().toISOString() })
        .eq("id", project.id);
      throw error;
    }

    const finished = summary.generated + summary.cached > 0;
    const jobStatus = summary.failed.length === 0 ? "completed" : finished ? "partial" : "failed";
    await persistJob({
      status: jobStatus,
      languages_done: summary.generated + summary.cached,
      progress: targets.length === 0 ? 0 : Math.round(((summary.generated + summary.cached) / targets.length) * 100),
      completed_at: new Date().toISOString(),
      error_message: summary.failed.length > 0 ? `Not generated: ${summary.failed.join(", ")}` : null,
    });

    // Stamp the source hash only after a run that produced rows, so the next run
    // can reuse them. A missing column (migration not applied) is ignored.
    const projectPatch: Record<string, unknown> = {
      status: summary.failed.length === 0 ? "validated" : finished ? "generated" : "failed",
      generation_status: summary.failed.length === 0 ? "completed" : finished ? "partial" : "failed",
      updated_at: new Date().toISOString(),
    };
    if (finished) projectPatch.source_hash = hash;
    let projectUpdate = await supabase.from("etsy_seo_projects").update(projectPatch).eq("id", project.id);
    if (projectUpdate.error && /source_hash/i.test(projectUpdate.error.message)) {
      // Migration not applied: keep the status write, drop only the hash column.
      const { source_hash: _unusedHash, ...withoutHash } = projectPatch;
      projectUpdate = await supabase.from("etsy_seo_projects").update(withoutHash).eq("id", project.id);
    }
  });
}

/**
 * Status for a run in progress (or the last one), used when the user returns to
 * the page: completed markets come from the database, queued/processing from the
 * job row. `stalled` is a report, not a cancellation — the client stops polling.
 */
export async function GET(request: Request) {
  const auth = await requireEtsySeoEmployee();
  if ("response" in auth) return auth.response;
  const me = auth.employee;

  const projectId = new URL(request.url).searchParams.get("projectId");
  if (!projectId) return jsonError("projectId is required.", 400);

  const supabase: Supabase = createServiceRoleClientUnchecked();
  const { data: project } = await supabase
    .from("etsy_seo_projects")
    .select("id, generation_status")
    .eq("id", projectId)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (!project) return jsonError("Project not found in your company.", 404);

  const [{ data: job }, { data: listings }] = await Promise.all([
    supabase
      .from("etsy_seo_jobs")
      .select("status, current_step, progress, languages_total, languages_done, error_message, started_at, completed_at")
      .eq("project_id", projectId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("etsy_seo_listings").select("language_code, validation_status, seo_score, updated_at").eq("project_id", projectId),
  ]);

  let steps: Record<string, string> = {};
  if (job?.current_step) {
    try {
      const parsed = JSON.parse(job.current_step as string) as Record<string, string>;
      if (parsed && typeof parsed === "object") steps = parsed;
    } catch {
      /* legacy/plain text step — per-language state falls back to the rows */
    }
  }

  const saved = new Map((listings ?? []).map((row) => [row.language_code as string, row]));
  const startedAt = (job?.started_at as string | null) ?? null;
  const stalled = job?.status === "running" && !!startedAt && Date.now() - new Date(startedAt).getTime() > 10 * 60 * 1000;

  return NextResponse.json({
    ok: true,
    job: job
      ? {
          status: stalled ? "stalled" : (job.status as string),
          progress: (job.progress as number | null) ?? 0,
          languagesTotal: (job.languages_total as number | null) ?? ETSY_LANGUAGES.length,
          languagesDone: (job.languages_done as number | null) ?? 0,
          error: (job.error_message as string | null) ?? null,
          startedAt,
          completedAt: (job.completed_at as string | null) ?? null,
        }
      : null,
    languages: ETSY_LANGUAGES.map((language) => {
      const row = saved.get(language.code);
      const step = steps[language.code];
      const status = row ? "completed" : step === "running" || step === "failed" ? step : "queued";
      return {
        languageCode: language.code,
        status,
        validationStatus: (row?.validation_status as string | undefined) ?? null,
        score: (row?.seo_score as number | null) ?? null,
        updatedAt: (row?.updated_at as string | undefined) ?? null,
      };
    }),
  });
}
