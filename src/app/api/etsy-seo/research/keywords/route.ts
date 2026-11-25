import { NextResponse } from "next/server";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { etsyLanguage } from "@/lib/etsy/languages";
import { keywordSystemPrompt, keywordUserPrompt } from "@/lib/etsy/ai/prompts";
import { parseKeywordOutput } from "@/lib/etsy/ai/schemas";
import { ProviderError } from "@/lib/etsy/ai/types";
import { loadCompanyAiContext, managerConfig, recordUsage } from "@/lib/etsy/ai/company-ai";
import { mergeKeywordRecords, parseKeywordFile, recordsFromAiGroups, UNVERIFIED_LABEL, type KeywordRecord } from "@/lib/etsy/research";
import type { EtsyProductFacts } from "@/lib/etsy/product";
import { jsonError, rateLimit, rateLimited, readJsonBody, requireEtsySeoEmployee, tooLarge } from "@/lib/etsy/api";

// 2026-11-18 — Keyword research for ONE market.
//
// Two honest inputs:
//   * AI suggestions — native-language phrases, always verified=false and
//     labelled "AI Suggested – Search Volume Not Verified".
//   * An optional uploaded file with real volumes/competition the user owns —
//     those rows are verified=true and attributed to the file.
// Nothing here invents a number: if no adapter measured it, the metric is null.
export const maxDuration = 60;

type Body = { projectId?: string; languageCode?: string; fileText?: string };

export async function POST(request: Request) {
  const auth = await requireEtsySeoEmployee();
  if ("response" in auth) return auth.response;
  const me = auth.employee;

  if (tooLarge(request, 512 * 1024)) return jsonError("Keyword file is too large (max 512 KB).", 413);
  const limit = rateLimit(`etsy-seo-research:${me.id}`, 40, 60_000);
  if (!limit.ok) return rateLimited(limit.retryAfterSeconds);

  const parsedBody = await readJsonBody<Body>(request);
  if ("response" in parsedBody) return parsedBody.response;
  const { projectId, languageCode, fileText } = parsedBody.body;

  const language = etsyLanguage(languageCode ?? "");
  if (!language) return jsonError("Unknown language.", 400);
  if (!projectId) return jsonError("projectId is required.", 400);

  const supabase = createServiceRoleClientUnchecked();
  const { data: project } = await supabase
    .from("etsy_seo_projects")
    .select("id, company_id, project_name, original_title, product")
    .eq("id", projectId)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (!project) return jsonError("Project not found in your company.", 404);

  const context = await loadCompanyAiContext(supabase, project.company_id);
  if (!context.credentials.geminiApiKey && !context.credentials.openRouterApiKey) {
    return jsonError("No AI provider is configured.", 503, { code: "provider_not_configured" });
  }

  const facts = (project.product ?? {}) as EtsyProductFacts;

  try {
    const result = await context.manager.generateStructured({
      operation: "research",
      system: keywordSystemPrompt(),
      prompt: keywordUserPrompt({ language, facts, englishTitle: project.original_title }),
      temperature: 0.7,
      maxOutputTokens: 2048,
      config: managerConfig(context.settings),
      parse: (text) => parseKeywordOutput(text),
      onAttempt: (log) => recordUsage(supabase, { companyId: project.company_id, projectId: project.id, employeeId: me.id, languageCode: language.code }, log),
    });

    let records: KeywordRecord[] = recordsFromAiGroups(result.data as unknown as Record<string, string[]>, language);
    if (fileText?.trim()) {
      records = mergeKeywordRecords([...records, ...parseKeywordFile(fileText, language)]);
    }

    // Replace only this market's AI/file rows — competitor-derived rows stay.
    await supabase
      .from("etsy_seo_keywords")
      .delete()
      .eq("project_id", project.id)
      .eq("language_code", language.code)
      .in("source", ["ai", "user_file"]);

    if (records.length > 0) {
      const { error } = await supabase.from("etsy_seo_keywords").insert(
        records.map((r) => ({
          project_id: project.id,
          company_id: project.company_id,
          country: r.country,
          language_code: r.languageCode,
          keyword: r.keyword,
          keyword_type: r.keywordType,
          source: r.source,
          verified: r.verified,
          search_volume: r.searchVolume,
          competition: r.competition,
          trend_data: r.trend,
          confidence: r.confidence,
          source_url: r.sourceUrl,
          researched_at: r.researchedAt,
        }))
      );
      if (error) return jsonError(error.message, 500);
    }

    return NextResponse.json({
      ok: true,
      language: { code: language.code, name: language.name, country: language.country, locale: language.locale },
      total: records.length,
      verified: records.filter((r) => r.verified).length,
      aiSuggested: records.filter((r) => !r.verified).length,
      dataLabel: UNVERIFIED_LABEL,
      provider: result.provider,
      model: result.model,
      backupUsed: result.backupUsed,
      keywords: records,
    });
  } catch (error) {
    if (error instanceof ProviderError) return jsonError(error.message, 502, { code: "provider_failed" });
    console.error("etsy-seo research error:", error);
    return jsonError("Keyword research failed.", 500);
  }
}
