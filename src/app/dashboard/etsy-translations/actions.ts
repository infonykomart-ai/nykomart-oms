"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient, createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log-audit";
import { etsyLanguage } from "@/lib/etsy/languages";
import { formatTags, normalizeTags, validateTags, validateTitle } from "@/lib/etsy/validation";

// 2026-11-17 — server side of the Etsy multilingual module. Two writes only:
// the English source (etsy_products) and ONE language's translation
// (etsy_product_translations). The per-language upsert is keyed on
// (product_id, language_code) so saving German can never touch French, and the
// English row is never written by a translation save.
//
// Validation is repeated here even though the UI already checks — a Server
// Action is a public endpoint, so "the button was disabled" is not a rule.

export type EtsyActionResult = { ok: boolean; error?: string; id?: string; issues?: string[] };

export type EtsyProductInput = {
  productId?: string;
  sku: string;
  productName?: string;
  originalTitle: string;
  originalDescription: string;
  originalTags?: string;
  category?: string;
  material?: string;
  size?: string;
  colour?: string;
  technique?: string;
  features?: string;
};

export async function saveEtsyProduct(input: EtsyProductInput): Promise<EtsyActionResult> {
  const me = await requireCapability("etsy_translation");
  const supabase = createServiceRoleClientUnchecked();

  const sku = (input.sku ?? "").trim();
  const title = (input.originalTitle ?? "").trim();
  if (!sku) return { ok: false, error: "Product SKU is required — translations are always linked to a SKU." };
  if (!title) return { ok: false, error: "The English product title is required." };

  // The English source has no Etsy 140-char rule of its own (it is the
  // reference text), but a blank or absurdly long source is not usable.
  if ([...title].length > 400) return { ok: false, error: "English title is too long to be a useful source (400 characters max)." };

  const row = {
    company_id: me.currentCompanyId,
    sku,
    product_name: input.productName?.trim() || null,
    original_title: title,
    original_description: (input.originalDescription ?? "").trim(),
    original_tags: input.originalTags?.trim() ?? "",
    category: input.category?.trim() || null,
    material: input.material?.trim() || null,
    size: input.size?.trim() || null,
    colour: input.colour?.trim() || null,
    technique: input.technique?.trim() || null,
    features: input.features?.trim() || null,
    entered_by_employee_id: me.id,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("etsy_products")
    .upsert(row, { onConflict: "company_id,sku" })
    .select("id")
    .single();

  if (error) {
    return {
      ok: false,
      error: /relation .*etsy_products.* does not exist/i.test(error.message)
        ? "The Etsy module tables are missing — run db/2026-11-17-etsy-translations.sql in Supabase first."
        : error.message,
    };
  }

  await logAudit(supabase as unknown as ReturnType<typeof createServiceRoleClient>, {
    companyId: me.currentCompanyId,
    employeeId: me.id,
    employeeName: me.name,
    action: input.productId ? "etsy_product.updated" : "etsy_product.created",
    entityType: "etsy_product",
    entityId: data?.id ?? null,
    entityLabel: sku,
    changes: { title },
  });

  revalidatePath("/dashboard/etsy-translations");
  return { ok: true, id: data?.id };
}

export type EtsyTranslationInput = {
  productId: string;
  languageCode: string;
  title: string;
  description: string;
  tags: string;
  aiModel?: string;
  editedManually?: boolean;
};

export async function saveEtsyTranslation(input: EtsyTranslationInput): Promise<EtsyActionResult> {
  const me = await requireCapability("etsy_translation");
  const supabase = createServiceRoleClientUnchecked();

  const language = etsyLanguage(input.languageCode);
  if (!language) return { ok: false, error: "Unknown language." };

  const title = (input.title ?? "").trim();
  const description = (input.description ?? "").trim();
  const titleCheck = validateTitle(title);
  const tagCheck = validateTags(input.tags);
  const issues: string[] = [];
  if (titleCheck.message) issues.push(`Title: ${titleCheck.message}`);
  if (tagCheck.total !== 13) issues.push(`Tags: ${tagCheck.total}/13 — exactly 13 tags are required.`);
  if (tagCheck.tooLong.length > 0) issues.push(`Tags: ${tagCheck.tooLong.length} tag(s) exceed 29 characters.`);
  if (tagCheck.duplicates.length > 0) issues.push(`Tags: ${tagCheck.duplicates.length} duplicate tag(s).`);
  if (!description) issues.push("Description is empty.");
  if (issues.length > 0) return { ok: false, error: issues.join(" "), issues };

  // Store what Etsy will actually receive: deduped, over-length tags removed,
  // one comma-separated line. If that cleanup changed anything, refuse rather
  // than silently dropping content the user typed.
  const normalized = normalizeTags(input.tags);
  if (normalized.tags.length !== 13) {
    return {
      ok: false,
      error: `After removing invalid/duplicate tags only ${normalized.tags.length} tag(s) remain — fix them before saving.`,
      issues: [`Tags: ${normalized.tags.length}/13 valid.`],
    };
  }
  const tagsLine = formatTags(normalized.tags);

  const { data: product, error: productError } = await supabase
    .from("etsy_products")
    .select("id, sku, company_id")
    .eq("id", input.productId)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (productError) return { ok: false, error: productError.message };
  if (!product) return { ok: false, error: "Product not found in your company." };

  const validationDetail = {
    titleCharacters: titleCheck.length,
    tagCount: tagCheck.total,
    maxTagLength: tagCheck.maxTagLength,
    uniqueTags: tagCheck.valid,
    checkedAt: new Date().toISOString(),
  };

  const { error } = await supabase.from("etsy_product_translations").upsert(
    {
      product_id: product.id,
      company_id: product.company_id,
      sku: product.sku,
      language_code: language.code,
      language_name: language.name,
      translated_title: title,
      translated_description: description,
      translated_tags: tagsLine,
      title_character_count: titleCheck.length,
      tag_count: tagCheck.total,
      max_tag_length: tagCheck.maxTagLength,
      tag_validation_status: tagCheck.pass ? "PASS" : "FAIL",
      validation_detail: validationDetail,
      translation_status: input.editedManually ? "Edited" : "Saved",
      ai_model: input.aiModel ?? null,
      edited_manually: input.editedManually === true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "product_id,language_code" }
  );

  if (error) return { ok: false, error: error.message };

  await logAudit(supabase as unknown as ReturnType<typeof createServiceRoleClient>, {
    companyId: product.company_id,
    employeeId: me.id,
    employeeName: me.name,
    action: "etsy_translation.saved",
    entityType: "etsy_translation",
    entityId: product.id,
    entityLabel: `${product.sku} · ${language.name}`,
    changes: { titleCharacters: titleCheck.length, tags: tagCheck.total, maxTagLength: tagCheck.maxTagLength },
  });

  revalidatePath("/dashboard/etsy-translations");
  return { ok: true };
}
