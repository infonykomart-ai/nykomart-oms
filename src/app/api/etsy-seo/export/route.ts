import { NextResponse } from "next/server";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { buildKeywordsCsv, buildListingsCsv, buildProjectJson, buildWorkbook, type ExportListing } from "@/lib/etsy/export";
import { jsonError, requireEtsySeoEmployee } from "@/lib/etsy/api";

// 2026-11-18 — Export Center: JSON, CSV (all ten languages) and Excel.
// Everything is generated from the stored rows, so what the user downloads is
// exactly what they validated — no re-generation, no third-party service.
export const maxDuration = 60;

function safeName(value: string): string {
  return (value || "etsy-project").replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "etsy-project";
}

export async function GET(request: Request) {
  const auth = await requireEtsySeoEmployee();
  if ("response" in auth) return auth.response;
  const me = auth.employee;

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const format = (url.searchParams.get("format") ?? "json").toLowerCase();
  if (!projectId) return jsonError("projectId is required.", 400);

  const supabase = createServiceRoleClientUnchecked();
  const { data: project } = await supabase
    .from("etsy_seo_projects")
    .select("*")
    .eq("id", projectId)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (!project) return jsonError("Project not found in your company.", 404);

  const [{ data: listingRows }, { data: keywordRows }, { data: competitorRows }] = await Promise.all([
    supabase.from("etsy_seo_listings").select("*").eq("project_id", project.id).order("language_code"),
    supabase.from("etsy_seo_keywords").select("*").eq("project_id", project.id).order("language_code"),
    supabase.from("etsy_seo_competitors").select("*").eq("project_id", project.id),
  ]);

  const listings: ExportListing[] = (listingRows ?? []).map((row) => ({
    country: row.country,
    language: row.language_name,
    languageCode: row.language_code,
    locale: row.locale,
    title: row.title ?? "",
    description: row.description ?? "",
    tags: (row.tags as string[] | null) ?? [],
    altTexts: (row.alt_texts as Array<{ image: number; text: string }> | null) ?? [],
    seoScore: row.seo_score ?? null,
    validationStatus: row.validation_status ?? "pending",
    validationReport: row.validation_report as { errors?: string[]; warnings?: string[] } | null,
    provider: row.provider ?? null,
    model: row.model ?? null,
    backupUsed: !!row.backup_used,
  }));

  const keywords = (keywordRows ?? []).map((k) => ({
    keyword: k.keyword,
    languageCode: k.language_code,
    country: k.country,
    keywordType: k.keyword_type,
    source: k.source,
    verified: !!k.verified,
    searchVolume: k.search_volume ?? null,
    competition: k.competition === null || k.competition === undefined ? null : Number(k.competition),
    confidence: k.confidence,
    sourceUrl: k.source_url ?? null,
    researchedAt: k.researched_at,
  }));

  const competitors = (competitorRows ?? []).map((c) => ({
    competitorUrl: c.competitor_url ?? null,
    competitorTitle: c.competitor_title ?? null,
    analysis: c.analysis,
    researchedAt: c.researched_at,
  }));

  const exportProject = {
    id: project.id,
    projectName: project.project_name,
    sku: project.sku ?? null,
    category: project.category ?? null,
    originalTitle: project.original_title ?? "",
    originalDescription: project.original_description ?? "",
    originalTags: project.original_tags ?? "",
    product: project.product ?? {},
    images: Array.isArray(project.images) ? project.images : [],
    createdAt: project.created_at,
    updatedAt: project.updated_at,
  };

  const base = safeName(project.sku || project.project_name);

  if (format === "json") {
    const payload = buildProjectJson({ project: exportProject, listings, keywords, competitors });
    return new NextResponse(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}.json"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (format === "csv" || format === "keywords") {
    const csv = format === "keywords" ? buildKeywordsCsv(keywords) : buildListingsCsv(listings);
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${base}-${format === "keywords" ? "keywords" : "listings"}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  if (format === "xlsx" || format === "excel") {
    const buffer = buildWorkbook({ project: exportProject, listings, keywords, competitors });
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${base}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return jsonError("format must be json, csv, keywords, or xlsx.", 400);
}
