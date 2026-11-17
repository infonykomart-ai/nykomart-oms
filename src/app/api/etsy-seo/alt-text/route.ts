import { NextResponse } from "next/server";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { ETSY_LANGUAGES, etsyLanguage } from "@/lib/etsy/languages";
import { extractJsonObject } from "@/lib/etsy/ai/schemas";
import { altTextSystemPrompt } from "@/lib/etsy/ai/prompts";
import { fetchImageForVision } from "@/lib/etsy/ai/gemini.provider";
import { ProviderError } from "@/lib/etsy/ai/types";
import { loadCompanyAiContext, managerConfig, recordUsage } from "@/lib/etsy/ai/company-ai";
import { validateAltText } from "@/lib/etsy/validation";
import { validateListing } from "@/lib/etsy/seo-validation";
import { jsonError, rateLimit, rateLimited, readJsonBody, requireEtsySeoEmployee, tooLarge } from "@/lib/etsy/api";

// 2026-11-18 — Image alt text for every market, from the actual photo.
//
// One vision call per image returns all ten languages (the spec's output table
// is image → 10 alt texts), so ten images cost ten calls instead of a hundred.
// Alt text describes only what is visible; the deterministic validator still
// enforces 250 characters and checks it whenever the listing is revalidated.
export const maxDuration = 60;

type Body = { projectId?: string; imageIndex?: number };

type AltBundle = { alt_texts?: Array<{ language_code?: string; code?: string; text?: string }> };

function parseBundle(text: string, expected: string[]): { ok: true; data: Record<string, string> } | { ok: false; issues: string[] } {
  const raw = extractJsonObject(text) as AltBundle | null;
  const list = Array.isArray(raw?.alt_texts) ? raw!.alt_texts! : Array.isArray((raw as unknown as { altTexts?: unknown }).altTexts) ? ((raw as unknown as { altTexts: AltBundle["alt_texts"] }).altTexts ?? []) : [];
  const out: Record<string, string> = {};
  for (const entry of list) {
    const code = (entry.language_code ?? entry.code ?? "").trim().toLowerCase();
    const value = (entry.text ?? "").trim();
    if (!code || !value || !expected.includes(code)) continue;
    out[code] = value.slice(0, 250).replace(/\s+\S*$/, "").trim();
  }
  const missing = expected.filter((code) => !out[code]);
  if (missing.length > 0) return { ok: false, issues: [`missing alt text for: ${missing.join(", ")}`] };
  return { ok: true, data: out };
}

export async function POST(request: Request) {
  const auth = await requireEtsySeoEmployee();
  if ("response" in auth) return auth.response;
  const me = auth.employee;

  if (tooLarge(request, 16 * 1024)) return jsonError("Request body is too large.", 413);
  const limit = rateLimit(`etsy-seo-alt:${me.id}`, 30, 60_000);
  if (!limit.ok) return rateLimited(limit.retryAfterSeconds);

  const parsedBody = await readJsonBody<Body>(request);
  if ("response" in parsedBody) return parsedBody.response;
  const { projectId, imageIndex } = parsedBody.body;
  if (!projectId) return jsonError("projectId is required.", 400);

  const supabase = createServiceRoleClientUnchecked();
  const { data: project } = await supabase
    .from("etsy_seo_projects")
    .select("id, company_id, project_name, original_title, product, images")
    .eq("id", projectId)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (!project) return jsonError("Project not found in your company.", 404);

  const images = Array.isArray(project.images) ? (project.images as Array<{ url?: string; order?: number; description?: string }>) : [];
  if (images.length === 0) return jsonError("Upload at least one product image first.", 400);

  const index = typeof imageIndex === "number" ? imageIndex : 0;
  const image = images[index];
  if (!image?.url) return jsonError("That image has no URL.", 400);

  const context = await loadCompanyAiContext(supabase, project.company_id);
  if (!context.credentials.geminiApiKey && !context.credentials.openRouterApiKey) {
    return jsonError("No AI provider is configured.", 503, { code: "provider_not_configured" });
  }

  try {
    const vision = await fetchImageForVision(image.url);
    const expected = ETSY_LANGUAGES.map((l) => l.code);
    const result = await context.manager.generateStructured({
      operation: "alt_text",
      system: altTextSystemPrompt(),
      prompt:
        `Generate the alt text for this product photo in ALL ten languages.\n` +
        `Product: ${project.original_title}\n${image.description ? `Visible content: ${image.description}\n` : ""}` +
        `Languages: ${ETSY_LANGUAGES.map((l) => `${l.code} (${l.name})`).join(", ")}.\n` +
        `Return ONLY JSON: {"alt_texts":[{"language_code":"nl","text":"…"} … all ten …]}`,
      images: [vision],
      temperature: 0.3,
      config: managerConfig(context.settings),
      parse: (text) => parseBundle(text, expected),
      onAttempt: (log) => recordUsage(supabase, { companyId: project.company_id, projectId: project.id, employeeId: me.id }, log),
    });

    // Merge into each language's listing (only listings that exist — alt text
    // alone must not create an empty listing row).
    const { data: listings } = await supabase.from("etsy_seo_listings").select("*").eq("project_id", project.id);
    const updated: string[] = [];
    const skipped: string[] = [];
    for (const listing of listings ?? []) {
      const code = listing.language_code as string;
      const text = result.data[code];
      if (!text) continue;
      const check = validateAltText(text);
      const existingAlt = (listing.alt_texts as Array<{ image: number; text: string }> | null) ?? [];
      const altTexts = [...existingAlt.filter((a) => a.image !== index + 1), { image: index + 1, text: check.valid ? text : text.slice(0, 250) }].sort(
        (a, b) => a.image - b.image
      );
      const language = etsyLanguage(code);
      const report = language
        ? validateListing({
            languageCode: code,
            locale: language.locale,
            title: listing.title ?? "",
            description: listing.description ?? "",
            tags: (listing.tags as string[] | null) ?? [],
            altTexts,
            imageCount: images.length,
            keywords: { primary: listing.primary_keyword ?? undefined, secondary: (listing.secondary_keywords as string[] | null) ?? [] },
            sourceTitle: project.original_title,
          })
        : null;
      await supabase
        .from("etsy_seo_listings")
        .update({
          alt_texts: altTexts,
          validation_status: report?.status ?? listing.validation_status,
          seo_score: report?.score ?? listing.seo_score,
          validation_report: report ?? listing.validation_report,
          updated_at: new Date().toISOString(),
        })
        .eq("id", listing.id);
      updated.push(code);
    }
    for (const code of ETSY_LANGUAGES.map((l) => l.code)) {
      if (!updated.includes(code)) skipped.push(code);
    }

    return NextResponse.json({
      ok: true,
      image: index + 1,
      altTexts: result.data,
      provider: result.provider,
      model: result.model,
      backupUsed: result.backupUsed,
      updated,
      skipped,
      note: skipped.length > 0 ? "Generate those languages first — alt text was not saved for listings that do not exist yet." : null,
    });
  } catch (error) {
    if (error instanceof ProviderError) return jsonError(error.message, 502, { code: "provider_failed" });
    console.error("etsy-seo alt-text error:", error);
    return jsonError(error instanceof Error ? error.message : "Alt text generation failed.", 500);
  }
}
