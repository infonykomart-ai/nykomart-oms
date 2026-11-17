import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { ETSY_LANGUAGES } from "@/lib/etsy/languages";
import { loadCompanyAiContext } from "@/lib/etsy/ai/company-ai";
import { RESEARCH_SOURCES } from "@/lib/etsy/research";
import { EtsySeoClient, type SeoListingRecord, type SeoProjectRecord, type SeoUsageSummary } from "./etsy-seo-client";

// 2026-11-18 — Etsy International SEO Generator (page).
// One company-scoped read of projects, listings, research rows, competitor
// analyses, usage totals and settings; every write goes through ./actions.ts or
// a capability-checked API route. Degrades to a setup card naming the SQL file
// when the tables have not been created yet.
export default async function EtsySeoPage() {
  const me = await requireCapability("etsy_seo_generator");
  const supabase = createServiceRoleClientUnchecked();

  const { data: projectRows, error } = await supabase
    .from("etsy_seo_projects")
    .select("*")
    .eq("company_id", me.currentCompanyId)
    .order("updated_at", { ascending: false });

  if (error) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <SetupNotice error={error.message} />
      </main>
    );
  }

  const projectIds = (projectRows ?? []).map((p) => p.id);
  const [listingsResult, keywordsResult, competitorsResult, usageResult, categoriesResult, settingsResult] = await Promise.all([
    projectIds.length
      ? supabase.from("etsy_seo_listings").select("*").in("project_id", projectIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    projectIds.length
      ? supabase.from("etsy_seo_keywords").select("*").in("project_id", projectIds).order("researched_at", { ascending: false })
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    projectIds.length
      ? supabase.from("etsy_seo_competitors").select("*").in("project_id", projectIds).order("researched_at", { ascending: false })
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    supabase.from("etsy_seo_usage_logs").select("provider, status, input_tokens, output_tokens, estimated_cost_usd").eq("company_id", me.currentCompanyId),
    supabase.from("etsy_seo_categories").select("name").eq("company_id", me.currentCompanyId).eq("active", true).order("name"),
    supabase.from("etsy_seo_settings").select("*").eq("company_id", me.currentCompanyId).maybeSingle(),
  ]);

  const listings: SeoListingRecord[] = (listingsResult.data ?? []).map((row) => mapListing(row as Record<string, unknown>));
  const keywords = (keywordsResult.data ?? []).map((row) => ({
    id: row.id as string,
    project_id: row.project_id as string,
    language_code: row.language_code as string,
    keyword: row.keyword as string,
    keyword_type: row.keyword_type as string,
    source: row.source as string,
    verified: !!row.verified,
    search_volume: (row.search_volume as number | null) ?? null,
    competition: (row.competition as number | null) ?? null,
    confidence: row.confidence as string,
  }));
  const competitors = (competitorsResult.data ?? []).map((row) => ({
    id: row.id as string,
    project_id: row.project_id as string,
    competitor_url: (row.competitor_url as string | null) ?? null,
    competitor_title: (row.competitor_title as string | null) ?? null,
    analysis: (row.analysis as Record<string, unknown> | null) ?? null,
    researched_at: row.researched_at as string,
  }));

  const usageRows = usageResult.data ?? [];
  const usage: SeoUsageSummary = {
    requests: usageRows.length,
    failures: usageRows.filter((r) => r.status === "error").length,
    inputTokens: usageRows.reduce((sum, r) => sum + ((r.input_tokens as number | null) ?? 0), 0),
    outputTokens: usageRows.reduce((sum, r) => sum + ((r.output_tokens as number | null) ?? 0), 0),
    costUsd: Math.round(usageRows.reduce((sum, r) => sum + (Number(r.estimated_cost_usd) || 0), 0) * 1_000_000) / 1_000_000,
    unknownCost: usageRows.filter((r) => r.estimated_cost_usd === null || r.estimated_cost_usd === undefined).length,
  };

  const projects: SeoProjectRecord[] = (projectRows ?? []).map((p) => ({
    id: p.id,
    sku: p.sku,
    project_name: p.project_name,
    category: p.category,
    original_title: p.original_title,
    original_description: p.original_description,
    original_tags: p.original_tags,
    product: (p.product as Record<string, string> | null) ?? {},
    images: Array.isArray(p.images) ? (p.images as SeoProjectRecord["images"]) : [],
    status: p.status,
    generation_status: p.generation_status,
    updated_at: p.updated_at,
  }));

  // Provider configuration only (no live health call on page load, which would
  // cost tokens on every visit). The Settings screen runs the real check.
  const ai = await loadCompanyAiContext(supabase, me.currentCompanyId);
  const settingsRow = settingsResult.data as Record<string, unknown> | null;

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-6">
      <header className="mb-5 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 p-6 text-white shadow-sm">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-sky-300">Etsy Export · International SEO</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Etsy International SEO Generator</h1>
        <p className="mt-1 max-w-3xl text-sm text-slate-300">
          One English rug listing → 10 independently researched, locally written Etsy listings with a 140-character title,
          exactly 13 tags of 20 characters or less, a complete description, localized image alt text and a deterministic
          validation report.
        </p>
      </header>

      <EtsySeoClient
        languages={ETSY_LANGUAGES}
        projects={projects}
        initialListings={listings}
        initialKeywords={keywords}
        initialCompetitors={competitors}
        categories={(categoriesResult.data ?? []).map((c) => c.name as string)}
        usage={usage}
        researchSources={RESEARCH_SOURCES}
        providers={{
          gemini: { configured: !!ai.credentials.geminiApiKey, source: ai.sources.gemini, model: ai.settings.primaryModel ?? process.env.GEMINI_MODEL_ID ?? null },
          openrouter: { configured: !!ai.credentials.openRouterApiKey, source: ai.sources.openrouter, model: ai.settings.backupModel ?? process.env.OPENROUTER_MODEL_ID ?? null },
        }}
        settings={{
          backupEnabled: settingsRow?.backup_enabled === undefined ? true : settingsRow.backup_enabled !== false,
          primaryModel: (settingsRow?.primary_model as string | null) ?? null,
          backupModel: (settingsRow?.backup_model as string | null) ?? null,
          researchMode: (settingsRow?.research_mode as string) ?? "ai",
          monthlyBudgetUsd: Number(settingsRow?.monthly_budget_usd ?? 0) || 0,
        }}
      />
    </main>
  );
}

function mapListing(row: Record<string, unknown>): SeoListingRecord {
  return {
    id: row.id as string,
    project_id: row.project_id as string,
    country: row.country as string,
    language_code: row.language_code as string,
    language_name: row.language_name as string,
    locale: row.locale as string,
    title: (row.title as string) ?? "",
    description: (row.description as string) ?? "",
    tags: (row.tags as string[] | null) ?? [],
    alt_texts: (row.alt_texts as Array<{ image: number; text: string }> | null) ?? [],
    seo_score: (row.seo_score as number | null) ?? null,
    validation_status: (row.validation_status as string) ?? "pending",
    validation_report: (row.validation_report as SeoListingRecord["validation_report"]) ?? null,
    primary_keyword: (row.primary_keyword as string | null) ?? null,
    secondary_keywords: (row.secondary_keywords as string[] | null) ?? [],
    provider: (row.provider as string | null) ?? null,
    model: (row.model as string | null) ?? null,
    backup_used: !!row.backup_used,
    version: (row.version as number) ?? 1,
    edited_manually: !!row.edited_manually,
    updated_at: row.updated_at as string,
  };
}

function SetupNotice({ error }: { error: string }) {
  const missing = /does not exist|schema cache|relation/i.test(error);
  return (
    <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
      <h2 className="font-bold">The Etsy SEO Generator is not set up yet</h2>
      {missing ? (
        <p className="mt-1">
          Run <code className="rounded bg-white px-1">db/2026-11-18-etsy-seo-generator.sql</code> in Supabase (SQL editor),
          then reload this page. Nothing else in the OMS is affected until then.
        </p>
      ) : (
        <p className="mt-1">Database error: {error}</p>
      )}
    </section>
  );
}
