import { NextResponse } from "next/server";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { etsyLanguage } from "@/lib/etsy/languages";
import { validateListing } from "@/lib/etsy/seo-validation";
import { jsonError, readJsonBody, requireEtsySeoEmployee } from "@/lib/etsy/api";

// 2026-11-18 — Deterministic revalidation. No AI, no tokens, no cost.
// Runs after a manual edit ("Revalidate") and after alt-text changes; the
// result is what the dashboard counts as completed vs needing correction.
export const maxDuration = 30;

type Body = { projectId?: string; listingId?: string };

export async function POST(request: Request) {
  const auth = await requireEtsySeoEmployee();
  if ("response" in auth) return auth.response;
  const me = auth.employee;

  const parsedBody = await readJsonBody<Body>(request);
  if ("response" in parsedBody) return parsedBody.response;
  const { projectId, listingId } = parsedBody.body;
  if (!projectId && !listingId) return jsonError("projectId or listingId is required.", 400);

  const supabase = createServiceRoleClientUnchecked();

  let query = supabase.from("etsy_seo_listings").select("*").in("company_id", me.companyIds);
  if (listingId) query = query.eq("id", listingId);
  else query = query.eq("project_id", projectId!);
  const { data: listings, error } = await query;
  if (error) return jsonError(error.message, 500);
  if (!listings || listings.length === 0) return jsonError("No listings found to validate.", 404);

  const projectIds = [...new Set(listings.map((l) => l.project_id as string))];
  const { data: projects } = await supabase
    .from("etsy_seo_projects")
    .select("id, original_title, images")
    .in("id", projectIds);
  const projectById = new Map((projects ?? []).map((p) => [p.id as string, p]));

  const reports = [];
  for (const listing of listings) {
    const language = etsyLanguage(listing.language_code as string);
    if (!language) continue;
    const project = projectById.get(listing.project_id as string);
    const images = Array.isArray(project?.images) ? (project!.images as unknown[]) : [];
    const report = validateListing({
      languageCode: language.code,
      locale: language.locale,
      title: listing.title ?? "",
      description: listing.description ?? "",
      tags: (listing.tags as string[] | null) ?? [],
      altTexts: (listing.alt_texts as Array<{ image: number; text: string }> | null) ?? [],
      imageCount: images.length,
      keywords: { primary: listing.primary_keyword ?? undefined, secondary: (listing.secondary_keywords as string[] | null) ?? [] },
      sourceTitle: project?.original_title ?? undefined,
    });

    await supabase
      .from("etsy_seo_listings")
      .update({
        validation_status: report.status,
        seo_score: report.score,
        validation_report: report,
        updated_at: new Date().toISOString(),
      })
      .eq("id", listing.id);

    reports.push({ listingId: listing.id, languageCode: language.code, status: report.status, score: report.score, report });
  }

  // Project-level summary: validated only when every language passes.
  for (const id of projectIds) {
    const projectReports = reports.filter((r) => listings.find((l) => l.id === r.listingId)?.project_id === id);
    const status = projectReports.length === 0 ? "draft" : projectReports.every((r) => r.status === "pass") ? "validated" : "generated";
    await supabase.from("etsy_seo_projects").update({ status, updated_at: new Date().toISOString() }).eq("id", id);
  }

  return NextResponse.json({
    ok: true,
    validated: reports.length,
    summary: {
      pass: reports.filter((r) => r.status === "pass").length,
      warning: reports.filter((r) => r.status === "warning").length,
      fail: reports.filter((r) => r.status === "fail").length,
    },
    reports,
  });
}
