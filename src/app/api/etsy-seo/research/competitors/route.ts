import { NextResponse } from "next/server";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { ETSY_LANGUAGES, etsyLanguage } from "@/lib/etsy/languages";
import { competitorSystemPrompt, competitorUserPrompt } from "@/lib/etsy/ai/prompts";
import { parseCompetitorOutput } from "@/lib/etsy/ai/schemas";
import { ProviderError } from "@/lib/etsy/ai/types";
import { loadCompanyAiContext, managerConfig, recordUsage } from "@/lib/etsy/ai/company-ai";
import type { EtsyProductFacts } from "@/lib/etsy/product";
import { jsonError, rateLimit, rateLimited, readJsonBody, requireEtsySeoEmployee, tooLarge } from "@/lib/etsy/api";

// 2026-11-18 — Competitor analysis from information the user supplies.
//
// We never scrape a competitor page or claim private metrics: the model gets
// the URL/title/tags/keywords the user already has and returns patterns,
// gaps and differentiation ideas. The prompt forbids verbatim copying.
export const maxDuration = 60;

type Body = {
  projectId?: string;
  languageCode?: string;
  competitorUrl?: string;
  competitorTitle?: string;
  competitorTags?: string;
  competitorKeywords?: string;
};

export async function POST(request: Request) {
  const auth = await requireEtsySeoEmployee();
  if ("response" in auth) return auth.response;
  const me = auth.employee;

  if (tooLarge(request, 32 * 1024)) return jsonError("Request body is too large.", 413);
  const limit = rateLimit(`etsy-seo-competitor:${me.id}`, 30, 60_000);
  if (!limit.ok) return rateLimited(limit.retryAfterSeconds);

  const parsedBody = await readJsonBody<Body>(request);
  if ("response" in parsedBody) return parsedBody.response;
  const body = parsedBody.body;

  const projectId = body.projectId;
  if (!projectId) return jsonError("projectId is required.", 400);
  if (!body.competitorUrl && !body.competitorTitle) {
    return jsonError("Provide a competitor URL or title.", 400);
  }
  if (body.competitorUrl && !/^https?:\/\//i.test(body.competitorUrl)) {
    return jsonError("Competitor URL must start with http:// or https://.", 400);
  }

  const supabase = createServiceRoleClientUnchecked();
  const { data: project } = await supabase
    .from("etsy_seo_projects")
    .select("id, company_id, original_title, product")
    .eq("id", projectId)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (!project) return jsonError("Project not found in your company.", 404);

  // Language only shapes the analysis wording; a missing code falls back to
  // the first supported market rather than crashing.
  const targetLanguage = etsyLanguage(body.languageCode ?? "") ?? ETSY_LANGUAGES[0];
  const context = await loadCompanyAiContext(supabase, project.company_id);
  if (!context.credentials.geminiApiKey && !context.credentials.openRouterApiKey) {
    return jsonError("No AI provider is configured.", 503, { code: "provider_not_configured" });
  }

  try {
    const result = await context.manager.generateStructured({
      operation: "competitor",
      system: competitorSystemPrompt(),
      prompt: competitorUserPrompt({
        language: targetLanguage,
        facts: (project.product ?? {}) as EtsyProductFacts,
        competitorUrl: body.competitorUrl,
        competitorTitle: body.competitorTitle,
        competitorTags: body.competitorTags,
        competitorKeywords: body.competitorKeywords,
        englishTitle: project.original_title,
      }),
      temperature: 0.5,
      maxOutputTokens: 2048,
      config: managerConfig(context.settings),
      parse: (text) => parseCompetitorOutput(text),
      onAttempt: (log) => recordUsage(supabase, { companyId: project.company_id, projectId: project.id, employeeId: me.id }, log),
    });

    const { data: saved, error } = await supabase
      .from("etsy_seo_competitors")
      .insert({
        project_id: project.id,
        company_id: project.company_id,
        competitor_url: body.competitorUrl ?? null,
        competitor_title: body.competitorTitle ?? null,
        competitor_keywords: body.competitorKeywords ? body.competitorKeywords.split(",").map((k) => k.trim()).filter(Boolean) : [],
        analysis: result.data,
        source: "user_provided",
      })
      .select("*")
      .single();
    if (error) return jsonError(error.message, 500);

    return NextResponse.json({
      ok: true,
      competitor: saved,
      analysis: result.data,
      provider: result.provider,
      model: result.model,
      backupUsed: result.backupUsed,
      disclaimer: "Patterns only — no sales, conversion, ad or ranking data is known or claimed.",
    });
  } catch (error) {
    if (error instanceof ProviderError) return jsonError(error.message, 502, { code: "provider_failed" });
    console.error("etsy-seo competitor error:", error);
    return jsonError("Competitor analysis failed.", 500);
  }
}
