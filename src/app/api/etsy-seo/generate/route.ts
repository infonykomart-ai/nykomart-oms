import { NextResponse } from "next/server";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { ETSY_LANGUAGES, etsyLanguage } from "@/lib/etsy/languages";
import { parseListingOutput, type KeywordGroups, type ListingField } from "@/lib/etsy/ai/schemas";
import { listingSystemPrompt, listingUserPrompt } from "@/lib/etsy/ai/prompts";
import { ProviderError } from "@/lib/etsy/ai/types";
import { loadCompanyAiContext, managerConfig, monthlySpendUsd, recordUsage } from "@/lib/etsy/ai/company-ai";
import { validateListing } from "@/lib/etsy/seo-validation";
import { PRODUCT_FIELDS, type EtsyProductFacts } from "@/lib/etsy/product";
import { jsonError, rateLimit, rateLimited, readJsonBody, requireEtsySeoEmployee, tooLarge } from "@/lib/etsy/api";

// 2026-11-18 — Generate ONE language (title/description/tags or all three).
//
// One language per request is deliberate for the same reason as the sibling
// module: "Generate all 10" is a client loop, so one slow or failing market
// never loses the other nine and progress is visible per language. The provider
// fallback, retries, usage logging and deterministic validation all happen here
// server-side — the browser never sees an API key and never decides "valid".
export const maxDuration = 60;

type Body = {
  projectId?: string;
  languageCode?: string;
  field?: ListingField;
  instructions?: string;
};

const FIELDS: ListingField[] = ["all", "title", "description", "tags"];

function keywordGroupsFromRows(rows: Array<{ keyword: string; keyword_type: string }>): KeywordGroups {
  const groups: KeywordGroups = {
    primary: [],
    secondary: [],
    longTail: [],
    buyerIntent: [],
    product: [],
    material: [],
    style: [],
    room: [],
    seasonal: [],
    competitor: [],
  };
  const map: Record<string, keyof KeywordGroups> = {
    primary: "primary",
    secondary: "secondary",
    long_tail: "longTail",
    buyer_intent: "buyerIntent",
    product: "product",
    material: "material",
    style: "style",
    room: "room",
    seasonal: "seasonal",
    competitor: "competitor",
  };
  for (const row of rows) {
    const key = map[row.keyword_type];
    if (key) groups[key].push(row.keyword);
  }
  return groups;
}

export async function POST(request: Request) {
  const auth = await requireEtsySeoEmployee();
  if ("response" in auth) return auth.response;
  const me = auth.employee;

  if (tooLarge(request, 64 * 1024)) return jsonError("Request body is too large.", 413);
  const limit = rateLimit(`etsy-seo-generate:${me.id}`, 40, 60_000);
  if (!limit.ok) return rateLimited(limit.retryAfterSeconds);

  const parsedBody = await readJsonBody<Body>(request);
  if ("response" in parsedBody) return parsedBody.response;
  const body = parsedBody.body;

  const language = etsyLanguage(body.languageCode ?? "");
  if (!language) {
    return jsonError(`Unknown language. Expected one of: ${ETSY_LANGUAGES.map((l) => l.code).join(", ")}.`, 400);
  }
  const field = body.field ?? "all";
  if (!FIELDS.includes(field)) return jsonError("field must be one of all, title, description, tags.", 400);
  if (!body.projectId) return jsonError("projectId is required.", 400);

  const supabase = createServiceRoleClientUnchecked();

  const { data: project, error: projectError } = await supabase
    .from("etsy_seo_projects")
    .select("id, company_id, sku, project_name, category, original_title, original_description, original_tags, product, images")
    .eq("id", body.projectId)
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
  if (!project) return jsonError("Project not found in your company.", 404);
  if (!project.original_title?.trim()) return jsonError("Add the English product title before generating.", 400);

  const [{ data: keywordRows }, { data: competitors }, { data: existing }] = await Promise.all([
    supabase.from("etsy_seo_keywords").select("keyword, keyword_type").eq("project_id", project.id).eq("language_code", language.code),
    supabase.from("etsy_seo_competitors").select("competitor_title, analysis").eq("project_id", project.id).limit(5),
    supabase.from("etsy_seo_listings").select("*").eq("project_id", project.id).eq("language_code", language.code).maybeSingle(),
  ]);

  const context = await loadCompanyAiContext(supabase, project.company_id);
  if (context.settings.monthlyBudgetUsd > 0) {
    const spent = await monthlySpendUsd(supabase, project.company_id);
    if (spent >= context.settings.monthlyBudgetUsd) {
      return jsonError(
        `The monthly AI budget ($${context.settings.monthlyBudgetUsd.toFixed(2)}) is used up — raise it in Settings or wait for next month.`,
        402,
        { code: "budget_exhausted" }
      );
    }
  }
  if (!context.credentials.geminiApiKey && !context.credentials.openRouterApiKey) {
    return jsonError(
      "No AI provider is configured. Add GEMINI_API_KEY (or an OpenRouter key) in Settings, or ask an Admin to set the server environment variable.",
      503,
      { code: "provider_not_configured" }
    );
  }

  const product = (project.product ?? {}) as EtsyProductFacts;
  const facts: EtsyProductFacts = { ...product };
  if (!facts.productName) facts.productName = project.project_name;
  if (!facts.category) facts.category = project.category ?? undefined;

  const competitorNotes =
    (competitors ?? [])
      .map((c) => {
        const analysis = c.analysis as { keyword_gaps?: string[]; differentiation?: string[] } | null;
        const parts = [c.competitor_title, analysis?.keyword_gaps?.join(", "), analysis?.differentiation?.join(", ")].filter(Boolean);
        return parts.length ? parts.join(" · ") : null;
      })
      .filter(Boolean)
      .join("\n") || null;

  const images = Array.isArray(project.images) ? (project.images as Array<{ description?: string }>) : [];

  try {
    const result = await context.manager.generateStructured({
      operation: field === "all" ? "listing" : field,
      system: listingSystemPrompt(),
      prompt: listingUserPrompt({
        language,
        facts,
        englishTitle: project.original_title,
        englishDescription: project.original_description || undefined,
        englishTags: project.original_tags || undefined,
        keywords: keywordRows?.length ? keywordGroupsFromRows(keywordRows) : null,
        competitorNotes,
        imageCount: 0, // alt text is generated separately, with the actual photo
        field,
        previousIssues: body.instructions ? [body.instructions] : undefined,
      }),
      temperature: 0.6,
      config: managerConfig(context.settings),
      parse: (text) => parseListingOutput(text, { field, imageCount: 0 }),
      onAttempt: (log) => recordUsage(supabase, { companyId: project.company_id, projectId: project.id, employeeId: me.id }, log),
    });

    const generated = result.data;
    const previous = existing ?? null;
    const merged = {
      title: field === "all" || field === "title" ? generated.title : (previous?.title ?? ""),
      description: field === "all" || field === "description" ? generated.description : (previous?.description ?? ""),
      tags: field === "all" || field === "tags" ? generated.tags : ((previous?.tags as string[] | null) ?? []),
    };
    const primaryKeyword = generated.primaryKeyword || (previous?.primary_keyword as string | null) || null;
    const secondaryKeywords =
      generated.secondaryKeywords.length > 0 ? generated.secondaryKeywords : ((previous?.secondary_keywords as string[] | null) ?? []);

    const report = validateListing({
      languageCode: language.code,
      locale: language.locale,
      title: merged.title,
      description: merged.description,
      tags: merged.tags,
      altTexts: (previous?.alt_texts as Array<{ image: number; text: string }> | null) ?? [],
      imageCount: images.length,
      keywords: { primary: primaryKeyword ?? undefined, secondary: secondaryKeywords },
      sourceTitle: project.original_title,
    });

    const version = (previous?.version ?? 0) + 1;
    if (previous) {
      await supabase.from("etsy_seo_listing_versions").insert({
        listing_id: previous.id,
        company_id: project.company_id,
        version: previous.version ?? 1,
        title: previous.title ?? "",
        description: previous.description ?? "",
        tags: previous.tags ?? [],
        alt_texts: previous.alt_texts ?? [],
        seo_score: previous.seo_score ?? null,
        reason: "regenerated",
        created_by_employee_id: me.id,
      });
    }

    const row = {
      project_id: project.id,
      company_id: project.company_id,
      country: language.country,
      language_code: language.code,
      language_name: language.name,
      locale: language.locale,
      title: merged.title,
      description: merged.description,
      tags: merged.tags,
      alt_texts: (previous?.alt_texts as unknown[] | null) ?? [],
      seo_score: report.score,
      validation_status: report.status,
      validation_report: report,
      primary_keyword: primaryKeyword,
      secondary_keywords: secondaryKeywords,
      provider: result.provider,
      model: result.model,
      backup_used: result.backupUsed,
      version,
      edited_manually: false,
      updated_at: new Date().toISOString(),
    };

    const { data: saved, error: saveError } = await supabase
      .from("etsy_seo_listings")
      .upsert(row, { onConflict: "project_id,language_code" })
      .select("*")
      .single();
    if (saveError) return jsonError(saveError.message, 500);

    await supabase
      .from("etsy_seo_projects")
      .update({ status: report.status === "pass" ? "validated" : "generated", generation_status: "completed", updated_at: new Date().toISOString() })
      .eq("id", project.id);

    return NextResponse.json({
      ok: true,
      listing: saved,
      report,
      provider: result.provider,
      model: result.model,
      backupUsed: result.backupUsed,
      latencyMs: result.latencyMs,
      notes: generated.notes,
      languageName: language.name,
    });
  } catch (error) {
    if (error instanceof ProviderError) {
      const status = error.options.kind === "rate_limit" ? 429 : error.options.kind === "auth" ? 503 : 502;
      return jsonError(error.message, status, { code: "provider_failed" });
    }
    console.error("etsy-seo generate error:", error);
    return jsonError("Generation failed — no output was saved. Try again.", 500);
  }
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    route: "/api/etsy-seo/generate",
    method: "POST",
    body: { projectId: "uuid", languageCode: "nl|fr|de|it|ja|pl|pt|ru|es|sv", field: "all|title|description|tags" },
    languages: ETSY_LANGUAGES.map((l) => ({ code: l.code, name: l.name, locale: l.locale, country: l.country })),
    productFields: PRODUCT_FIELDS.map((f) => f.key),
  });
}
