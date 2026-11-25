"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log-audit";
import { etsyLanguage } from "@/lib/etsy/languages";
import { formatTags, normalizeTags, validateTags, validateTitle } from "@/lib/etsy/validation";
import { validateListing } from "@/lib/etsy/seo-validation";
import type { EtsyProductFacts } from "@/lib/etsy/product";

// 2026-11-18 — Server Actions for the Etsy SEO Generator.
//
// A Server Action is a public endpoint, so every write repeats the capability
// check, the company scope and the deterministic validation — the disabled
// button in the browser is never the rule.

export type ActionResult<T = unknown> = { ok: boolean; error?: string; issues?: string[]; data?: T; report?: unknown };

export type ProjectInput = {
  id?: string;
  sku?: string;
  projectName: string;
  category?: string;
  englishTitle: string;
  englishDescription?: string;
  englishTags?: string;
  product: EtsyProductFacts;
  images?: Array<{ url: string; storage_path?: string; order?: number; description?: string }>;
};

export async function saveSeoProject(input: ProjectInput): Promise<ActionResult<{ id: string }>> {
  const me = await requireCapability("etsy_seo_generator");
  const supabase = createServiceRoleClientUnchecked();

  // 2026-11-24 — The form is five mandatory fields. Everything else the pipeline
  // needs is generated, so a save can never proceed half-empty: the English
  // title, description and tags are the protected source every market derives
  // from, and the category drives market terminology.
  const projectName = (input.projectName ?? "").trim();
  const englishTitle = (input.englishTitle ?? "").trim();
  const englishDescription = (input.englishDescription ?? "").trim();
  const englishTags = (input.englishTags ?? "").trim();
  const category = (input.category ?? "").trim();
  if (!projectName) return { ok: false, error: "Project name is required." };
  if (!category) return { ok: false, error: "Category is required — it selects the market terminology the AI uses." };
  if (!englishTitle) return { ok: false, error: "The English product title is required — it is the source every language derives from." };
  if ([...englishTitle].length > 400) return { ok: false, error: "English title is too long to be a useful source (400 characters max)." };
  if (!englishDescription) return { ok: false, error: "The existing English description is required — it is the source content for the localized descriptions." };
  if (!englishTags) return { ok: false, error: "The existing English tags are required — they are the source content for the localized tags." };

  const images = (input.images ?? []).slice(0, 20);
  const productFacts: EtsyProductFacts = {};
  for (const [key, value] of Object.entries(input.product ?? {})) {
    const text = (value ?? "").toString().trim();
    if (text) (productFacts as Record<string, string>)[key] = text;
  }

  const row = {
    company_id: me.currentCompanyId,
    sku: (input.sku ?? "").trim() || null,
    project_name: projectName,
    category,
    original_title: englishTitle,
    original_description: englishDescription,
    original_tags: englishTags,
    product: productFacts,
    images,
    updated_at: new Date().toISOString(),
  };

  const query = input.id
    ? supabase.from("etsy_seo_projects").update(row).eq("id", input.id).in("company_id", me.companyIds).select("id").single()
    : supabase.from("etsy_seo_projects").insert({ ...row, created_by_employee_id: me.id }).select("id").single();

  const { data, error } = await query;
  if (error) {
    return {
      ok: false,
      error: /relation .*etsy_seo_projects.* does not exist/i.test(error.message)
        ? "The Etsy SEO tables are missing — run db/2026-11-18-etsy-seo-generator.sql in Supabase."
        : error.message,
    };
  }

  await logAudit(supabase as unknown as ReturnType<typeof createServiceRoleClientUnchecked>, {
    companyId: me.currentCompanyId,
    employeeId: me.id,
    employeeName: me.name,
    action: input.id ? "etsy_seo_project.updated" : "etsy_seo_project.created",
    entityType: "etsy_seo_project",
    entityId: data?.id ?? null,
    entityLabel: projectName,
    changes: { category: row.category, images: images.length },
  });

  revalidatePath("/dashboard/etsy-seo");
  return { ok: true, data: { id: data?.id as string } };
}

export async function deleteSeoProject(projectId: string): Promise<ActionResult> {
  const me = await requireCapability("etsy_seo_generator");
  const supabase = createServiceRoleClientUnchecked();
  const { error } = await supabase.from("etsy_seo_projects").delete().eq("id", projectId).in("company_id", me.companyIds);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard/etsy-seo");
  return { ok: true };
}

export type ListingEditInput = {
  listingId: string;
  title: string;
  description: string;
  tags: string;
  altTexts?: Array<{ image: number; text: string }>;
};

/**
 * Save one language after manual editing. Keeps the previous text as a version,
 * re-runs the deterministic validator and returns the fresh report so the user
 * sees immediately whether the edit fixed or broke a rule.
 */
export async function saveListingEdits(input: ListingEditInput): Promise<ActionResult> {
  const me = await requireCapability("etsy_seo_generator");
  const supabase = createServiceRoleClientUnchecked();

  const { data: listing } = await supabase
    .from("etsy_seo_listings")
    .select("*")
    .eq("id", input.listingId)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (!listing) return { ok: false, error: "Listing not found in your company." };

  const language = etsyLanguage(listing.language_code as string);
  if (!language) return { ok: false, error: "Unknown language on this listing." };

  const title = (input.title ?? "").trim();
  const description = (input.description ?? "").trim();
  const titleCheck = validateTitle(title);
  const tagCheck = validateTags(input.tags);
  const issues: string[] = [];
  if (titleCheck.message) issues.push(`Title: ${titleCheck.message}`);
  if (tagCheck.total !== 13) issues.push(`Tags: ${tagCheck.total}/13 — exactly 13 are required.`);
  if (tagCheck.tooLong.length > 0) issues.push(`Tags: ${tagCheck.tooLong.length} exceed 20 characters.`);
  if (tagCheck.duplicates.length > 0) issues.push(`Tags: ${tagCheck.duplicates.length} duplicate.`);
  if (!description) issues.push("Description is empty.");
  if (issues.length > 0) return { ok: false, error: issues.join(" "), issues };

  const normalized = normalizeTags(input.tags);
  if (normalized.tags.length !== 13) {
    return { ok: false, error: `Only ${normalized.tags.length}/13 tags are valid after cleanup.`, issues: [`Tags: ${normalized.tags.length}/13 valid.`] };
  }

  const { data: project } = await supabase
    .from("etsy_seo_projects")
    .select("id, original_title, images")
    .eq("id", listing.project_id)
    .maybeSingle();
  const imageCount = Array.isArray(project?.images) ? (project!.images as unknown[]).length : 0;
  const altTexts = input.altTexts ?? ((listing.alt_texts as Array<{ image: number; text: string }> | null) ?? []);

  const report = validateListing({
    languageCode: language.code,
    locale: language.locale,
    title,
    description,
    tags: normalized.tags,
    altTexts,
    imageCount,
    keywords: { primary: listing.primary_keyword ?? undefined, secondary: (listing.secondary_keywords as string[] | null) ?? [] },
    sourceTitle: project?.original_title ?? undefined,
  });

  await supabase.from("etsy_seo_listing_versions").insert({
    listing_id: listing.id,
    company_id: listing.company_id,
    version: listing.version ?? 1,
    title: listing.title ?? "",
    description: listing.description ?? "",
    tags: listing.tags ?? [],
    alt_texts: listing.alt_texts ?? [],
    seo_score: listing.seo_score ?? null,
    reason: "manual_edit",
    created_by_employee_id: me.id,
  });

  const { error } = await supabase
    .from("etsy_seo_listings")
    .update({
      title,
      description,
      tags: normalized.tags,
      alt_texts: altTexts,
      seo_score: report.score,
      validation_status: report.status,
      validation_report: report,
      version: (listing.version ?? 1) + 1,
      edited_manually: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", listing.id);
  if (error) return { ok: false, error: error.message };

  await logAudit(supabase as unknown as ReturnType<typeof createServiceRoleClientUnchecked>, {
    companyId: listing.company_id,
    employeeId: me.id,
    employeeName: me.name,
    action: "etsy_seo_listing.edited",
    entityType: "etsy_seo_listing",
    entityId: listing.id,
    entityLabel: `${listing.language_name} · ${language.code}`,
    changes: { titleCharacters: titleCheck.length, tags: normalized.tags.length, score: report.score, status: report.status },
  });

  revalidatePath("/dashboard/etsy-seo");
  return { ok: true, report, data: { title, description, tags: formatTags(normalized.tags), status: report.status, score: report.score } };
}

/** Admin-extendable category list (spec §3). */
export async function addSeoCategory(name: string): Promise<ActionResult> {
  const me = await requireCapability("etsy_seo_generator");
  const supabase = createServiceRoleClientUnchecked();
  const clean = (name ?? "").trim();
  if (clean.length < 2) return { ok: false, error: "Category name is too short." };
  const { error } = await supabase.from("etsy_seo_categories").insert({ company_id: me.currentCompanyId, name: clean });
  if (error) return { ok: false, error: /duplicate key/i.test(error.message) ? "That category already exists." : error.message };
  revalidatePath("/dashboard/etsy-seo");
  return { ok: true };
}

export type UploadResult = { ok: boolean; error?: string; image?: { url: string; storage_path: string; order: number } };

/**
 * Upload one product photo to Supabase Storage and return its public URL.
 * Type and size are checked server-side; the bucket is created by the module's
 * SQL migration.
 */
export async function uploadSeoImage(formData: FormData): Promise<UploadResult> {
  const me = await requireCapability("etsy_seo_generator");
  const file = formData.get("file");
  const projectId = String(formData.get("projectId") ?? "");
  const order = Number(formData.get("order") ?? 0) || 0;
  if (!(file instanceof File)) return { ok: false, error: "No file received." };
  if (!projectId) return { ok: false, error: "Save the project first, then upload images." };
  if (file.size > 8 * 1024 * 1024) return { ok: false, error: "Image is larger than 8 MB." };
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) return { ok: false, error: "Use a JPEG, PNG or WEBP image." };

  const supabase = createServiceRoleClientUnchecked();
  const { data: project } = await supabase.from("etsy_seo_projects").select("id").eq("id", projectId).in("company_id", me.companyIds).maybeSingle();
  if (!project) return { ok: false, error: "Project not found in your company." };

  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${me.currentCompanyId}/${projectId}/${Date.now()}-${order}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const { error } = await supabase.storage.from("etsy-product-images").upload(path, buffer, { contentType: file.type, upsert: false });
  if (error) {
    return {
      ok: false,
      error: /bucket/i.test(error.message)
        ? 'Storage bucket "etsy-product-images" is missing — run db/2026-11-18-etsy-seo-generator.sql (it creates the bucket).'
        : error.message,
    };
  }
  const { data: publicUrl } = supabase.storage.from("etsy-product-images").getPublicUrl(path);
  return { ok: true, image: { url: publicUrl.publicUrl, storage_path: path, order } };
}
