// 2026-11-20 — write-side operations for Master SKUs and store SKU mappings.
//
// Every function is called only after requireCapability("inventory_master_admin")
// has passed in the server action. The database remains the final authority:
// unique keys stop duplicate mappings and the merge RPC re-checks physical
// identity atomically.
import { randomUUID } from "node:crypto";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { isMissingSchemaPiece } from "@/lib/db/missing-column";
import {
  canMergeMasterVariants,
  isMasterSku,
  masterSkuBase,
  nextMasterSku,
  type MergeCandidate,
} from "./master-sku";

type Db = ReturnType<typeof createServiceRoleClientUnchecked>;
export type MasterResult = { error: string | null; message: string | null };

const FOUNDATION_FILE = "db/2026-11-20b-inventory-master-sku-foundation.sql";
const MERGE_FILE = "db/2026-11-20c-inventory-master-merge.sql";

function explain(error: { code?: string | null; message?: string | null } | null, fallback: string): string {
  if (!error) return fallback;
  if (isMissingSchemaPiece(error)) {
    return `This screen needs ${FOUNDATION_FILE} (and ${MERGE_FILE} for merging) to be run in Supabase first.`;
  }
  if (error.code === "23505") {
    return "That value already exists. A Master SKU is permanent, a store SKU can map to only one Master SKU, and carrier codes cannot repeat.";
  }
  if (error.code === "23503") {
    return "A referenced record no longer exists — reload the page and try again.";
  }
  return error.message || fallback;
}

// ---------------------------------------------------------------------------
// Master products
// ---------------------------------------------------------------------------

export async function saveMasterProduct(
  db: Db,
  input: {
    id?: string | null;
    masterCode: string;
    name: string;
    designCode?: string | null;
    itemCategoryId?: string | null;
    material?: string | null;
    construction?: string | null;
    notes?: string | null;
    active?: boolean;
    actorId: string;
  }
): Promise<MasterResult> {
  const masterCode = input.masterCode.trim().toUpperCase();
  const name = input.name.trim();
  if (!masterCode) return { error: "Master code is required (e.g. JUTE-001).", message: null };
  if (!name) return { error: "Product name is required.", message: null };

  const payload = {
    master_code: masterCode,
    name,
    design_code: input.designCode?.trim() || null,
    item_category_id: input.itemCategoryId || null,
    material: input.material?.trim() || null,
    construction: input.construction?.trim() || null,
    notes: input.notes?.trim() || null,
    active: input.active ?? true,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { error } = await db.from("inventory_master_products").update(payload).eq("id", input.id);
    if (error) return { error: explain(error, "Could not update the master product."), message: null };
    return { error: null, message: `Master product ${masterCode} updated.` };
  }

  const { error } = await db.from("inventory_master_products").insert({
    ...payload,
    created_by_employee_id: input.actorId,
  });
  if (error) return { error: explain(error, "Could not create the master product."), message: null };
  return { error: null, message: `Master product ${masterCode} created — add its size/colour variants next.` };
}

// ---------------------------------------------------------------------------
// Master variants (permanent Master SKU)
// ---------------------------------------------------------------------------

export async function saveMasterVariant(
  db: Db,
  input: {
    id?: string | null;
    masterProductId: string;
    masterSku?: string | null;
    sizeLabel: string;
    sizeUnit?: string | null;
    colour?: string | null;
    lengthValue?: number | null;
    widthValue?: number | null;
    active?: boolean;
    actorId: string;
  }
): Promise<MasterResult> {
  if (!input.masterProductId) return { error: "Choose the master product.", message: null };

  const { data: product, error: productError } = await db
    .from("inventory_master_products")
    .select("id, master_code, name")
    .eq("id", input.masterProductId)
    .maybeSingle();
  if (productError) return { error: explain(productError, "Could not load the master product."), message: null };
  if (!product) return { error: "That master product no longer exists.", message: null };

  let masterSku = (input.masterSku ?? "").trim().toUpperCase();
  if (masterSku) {
    if (!isMasterSku(masterSku)) {
      return { error: "Master SKU must look like JUTE-001-0001 (prefix + 4-digit sequence).", message: null };
    }
  } else {
    const { data: existing, error: existingError } = await db
      .from("inventory_master_variants")
      .select("master_sku")
      .eq("master_product_id", input.masterProductId);
    if (existingError) return { error: explain(existingError, "Could not allocate a Master SKU."), message: null };
    masterSku = nextMasterSku(
      masterSkuBase(product.master_code),
      ((existing ?? []) as { master_sku: string }[]).map((row) => row.master_sku)
    );
  }

  const payload = {
    master_product_id: input.masterProductId,
    master_sku: masterSku,
    size_label: input.sizeLabel.trim(),
    size_unit: input.sizeUnit?.trim().toUpperCase() || null,
    colour: (input.colour ?? "").trim(),
    length_value: input.lengthValue ?? null,
    width_value: input.widthValue ?? null,
    active: input.active ?? true,
    updated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { error } = await db.from("inventory_master_variants").update(payload).eq("id", input.id);
    if (error) return { error: explain(error, "Could not update the Master SKU."), message: null };
    return { error: null, message: `Master SKU ${masterSku} updated.` };
  }

  const { error } = await db.from("inventory_master_variants").insert({
    ...payload,
    created_by_employee_id: input.actorId,
  });
  if (error) return { error: explain(error, "Could not create the Master SKU."), message: null };
  return { error: null, message: `Master SKU ${masterSku} created. Map the store SKUs to it next.` };
}

// ---------------------------------------------------------------------------
// Master SKU photos — the SKU's own album (2026-11-20d)
// ---------------------------------------------------------------------------
// A Master SKU is the physical identity, so its photo belongs to the SKU, not
// to a stock receipt. Files go to the SAME private `inventory-photos` bucket as
// stock-entry photos (never a public URL) and are served only through
// /api/inventory/master-photo/[id]. A replacement deactivates the old row and
// links it through replaced_photo_id — photos are never overwritten.
const PHOTO_BUCKET = "inventory-photos";
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB, same cap as other uploads
const PHOTO_TYPES = [
  "PRODUCT_MAIN",
  "DESIGN_DETAIL",
  "COLOUR_REFERENCE",
  "SIZE_MEASUREMENT",
  "QUALITY_CHECK",
  "PACKAGING",
];
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const PHOTOS_FILE = "db/2026-11-20d-inventory-master-photos.sql";

export async function saveMasterVariantPhoto(
  db: Db,
  input: {
    variantId: string;
    file: File;
    imageType?: string | null;
    reason?: string | null;
    replacePhotoId?: string | null;
    actorId: string;
  }
): Promise<MasterResult> {
  if (!input.variantId) return { error: "Choose the Master SKU this photo belongs to.", message: null };

  const file = input.file;
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a photo file to upload.", message: null };
  }
  if (file.size > MAX_PHOTO_BYTES) return { error: "Photo is too large — max 10MB.", message: null };
  const mime = (file.type || "").toLowerCase();
  const ext = EXT_BY_MIME[mime];
  if (!ext) return { error: "Photos must be JPEG, PNG or WebP.", message: null };

  const imageType = (input.imageType ?? "").trim().toUpperCase() || "PRODUCT_MAIN";
  if (!PHOTO_TYPES.includes(imageType)) return { error: "Choose a valid photo type.", message: null };

  const { data: variant, error: variantError } = await db
    .from("inventory_master_variants")
    .select("id, master_sku")
    .eq("id", input.variantId)
    .maybeSingle();
  if (variantError) return { error: explain(variantError, "Could not load the Master SKU."), message: null };
  if (!variant) return { error: "That Master SKU no longer exists.", message: null };

  const path = `masters/${input.variantId}/${Date.now()}-${randomUUID()}.${ext}`;
  const { error: uploadError } = await db.storage
    .from(PHOTO_BUCKET)
    .upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
  if (uploadError) return { error: `Upload failed: ${uploadError.message}`, message: null };

  const { error: insertError } = await db.from("inventory_master_variant_photos").insert({
    master_variant_id: input.variantId,
    image_path: path,
    image_type: imageType,
    file_name: file.name.replace(/[^\w.\- ]/g, "_").slice(0, 150),
    mime_type: mime,
    size_bytes: file.size,
    is_active: true,
    replaced_photo_id: input.replacePhotoId || null,
    update_reason: input.reason?.trim() || null,
    uploaded_by_employee_id: input.actorId,
  });
  if (insertError) {
    // Keep storage and the table consistent — no orphan file on failure.
    await db.storage.from(PHOTO_BUCKET).remove([path]);
    if (isMissingSchemaPiece(insertError)) {
      return { error: `Master SKU photos need ${PHOTOS_FILE} to be run in Supabase first.`, message: null };
    }
    return { error: explain(insertError, "Photo uploaded but could not be saved."), message: null };
  }

  if (input.replacePhotoId) {
    const { error: replaceError } = await db
      .from("inventory_master_variant_photos")
      .update({ is_active: false })
      .eq("id", input.replacePhotoId)
      .eq("master_variant_id", input.variantId);
    if (replaceError) {
      return {
        error: explain(replaceError, "New photo saved, but the old photo could not be marked replaced."),
        message: null,
      };
    }
  }

  return {
    error: null,
    message: `Photo added to ${variant.master_sku}. Earlier photos stay in history — nothing was overwritten.`,
  };
}

// ---------------------------------------------------------------------------
// Merge duplicate Master SKUs
// ---------------------------------------------------------------------------

export async function mergeMasterVariants(
  db: Db,
  input: { sourceVariantId: string; targetVariantId: string; reason?: string | null; actorId: string }
): Promise<MasterResult> {
  if (!input.sourceVariantId || !input.targetVariantId) {
    return { error: "Choose both a source and a target Master SKU.", message: null };
  }

  const { data: variants, error: variantsError } = await db
    .from("inventory_master_variants")
    .select("id, master_sku, master_product_id, size_label, size_unit, colour, active, merged_into_id")
    .in("id", [input.sourceVariantId, input.targetVariantId]);
  if (variantsError) return { error: explain(variantsError, "Could not load the Master SKUs."), message: null };

  const rows = (variants ?? []) as {
    id: string;
    master_sku: string;
    master_product_id: string;
    size_label: string;
    size_unit: string | null;
    colour: string;
    active: boolean;
    merged_into_id: string | null;
  }[];
  const source = rows.find((row) => row.id === input.sourceVariantId);
  const target = rows.find((row) => row.id === input.targetVariantId);
  if (!source || !target) return { error: "That Master SKU no longer exists.", message: null };

  const { data: products } = await db
    .from("inventory_master_products")
    .select("id, material, construction")
    .in("id", Array.from(new Set([source.master_product_id, target.master_product_id])));
  const productById = new Map(
    ((products ?? []) as { id: string; material: string | null; construction: string | null }[]).map((p) => [p.id, p])
  );

  const toCandidate = (row: typeof source): MergeCandidate => {
    const product = productById.get(row.master_product_id);
    return {
      id: row.id,
      masterSku: row.master_sku,
      sizeLabel: row.size_label,
      sizeUnit: row.size_unit,
      colour: row.colour,
      material: product?.material ?? null,
      construction: product?.construction ?? null,
      active: row.active,
      mergedIntoId: row.merged_into_id,
    };
  };

  const check = canMergeMasterVariants(toCandidate(source), toCandidate(target));
  if (!check.ok) return { error: check.reason, message: null };

  const { data, error } = await db.rpc("inventory_merge_master_variants", {
    p_source_variant_id: input.sourceVariantId,
    p_target_variant_id: input.targetVariantId,
    p_actor: input.actorId,
    p_reason: input.reason?.trim() || null,
  });
  if (error) {
    if (/inventory_merge_master_variants|function/i.test(error.message)) {
      return { error: `Merging needs ${MERGE_FILE} to be run in Supabase first.`, message: null };
    }
    return { error: error.message, message: null };
  }

  const result = (data ?? {}) as {
    source_master_sku?: string;
    target_master_sku?: string;
    mappings_moved?: number;
    variants_moved?: number;
    reservations_moved?: number;
  };
  return {
    error: null,
    message: `Merged ${result.source_master_sku ?? source.master_sku} into ${result.target_master_sku ?? target.master_sku} — ${result.mappings_moved ?? 0} store mapping(s), ${result.variants_moved ?? 0} variant(s), ${result.reservations_moved ?? 0} reservation(s) moved.`,
  };
}

// ---------------------------------------------------------------------------
// Store SKU mappings
// ---------------------------------------------------------------------------

export async function saveStoreSkuMapping(
  db: Db,
  input: {
    companyId: string;
    storeId: string;
    storeSku: string;
    masterVariantId: string;
    marketplaceListingId?: string | null;
    actorId: string;
  }
): Promise<MasterResult> {
  const storeSku = input.storeSku.trim();
  if (!storeSku) return { error: "Store SKU is required.", message: null };
  if (!input.storeId) return { error: "Choose the store.", message: null };
  if (!input.masterVariantId) return { error: "Choose the Master SKU.", message: null };

  const { data: store, error: storeError } = await db
    .from("stores")
    .select("id, company_id, name")
    .eq("id", input.storeId)
    .maybeSingle();
  if (storeError) return { error: explain(storeError, "Could not load the store."), message: null };
  if (!store) return { error: "That store no longer exists.", message: null };
  if (store.company_id !== input.companyId) {
    return { error: "The selected store does not belong to the selected company.", message: null };
  }

  const { data: variant, error: variantError } = await db
    .from("inventory_master_variants")
    .select("id, master_sku, active, merged_into_id")
    .eq("id", input.masterVariantId)
    .maybeSingle();
  if (variantError) return { error: explain(variantError, "Could not load the Master SKU."), message: null };
  if (!variant) return { error: "That Master SKU no longer exists.", message: null };
  if (!variant.active || variant.merged_into_id) {
    return { error: "That Master SKU is inactive or merged — map to the surviving Master SKU.", message: null };
  }

  const { data: existing, error: existingError } = await db
    .from("inventory_store_sku_map")
    .select("id, master_variant_id, is_active")
    .eq("store_id", input.storeId)
    .eq("store_sku", storeSku)
    .maybeSingle();
  if (existingError) return { error: explain(existingError, "Could not check the existing mapping."), message: null };

  const listing = input.marketplaceListingId?.trim() || null;

  if (existing) {
    const oldMaster = existing.master_variant_id as string;
    const { error } = await db
      .from("inventory_store_sku_map")
      .update({
        master_variant_id: input.masterVariantId,
        marketplace_listing_id: listing,
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    if (error) return { error: explain(error, "Could not update the mapping."), message: null };

    if (oldMaster !== input.masterVariantId) {
      const { error: historyError } = await db.from("inventory_store_sku_map_history").insert({
        map_id: existing.id,
        company_id: input.companyId,
        store_id: input.storeId,
        store_sku: storeSku,
        old_master_variant_id: oldMaster,
        new_master_variant_id: input.masterVariantId,
        action: "REPOINTED",
        reason: "Re-mapped from the store SKU screen",
        changed_by_employee_id: input.actorId,
      });
      if (historyError) return { error: explain(historyError, "Mapping changed but history could not be written."), message: null };
      return { error: null, message: `Store SKU ${storeSku} re-pointed to ${variant.master_sku} (history kept).` };
    }
    return { error: null, message: `Store SKU ${storeSku} is mapped to ${variant.master_sku}.` };
  }

  const { data: inserted, error } = await db
    .from("inventory_store_sku_map")
    .insert({
      company_id: input.companyId,
      store_id: input.storeId,
      master_variant_id: input.masterVariantId,
      store_sku: storeSku,
      marketplace_listing_id: listing,
      created_by_employee_id: input.actorId,
    })
    .select("id")
    .single();
  if (error) return { error: explain(error, "Could not save the mapping."), message: null };

  const { error: historyError } = await db.from("inventory_store_sku_map_history").insert({
    map_id: inserted?.id ?? null,
    company_id: input.companyId,
    store_id: input.storeId,
    store_sku: storeSku,
    old_master_variant_id: null,
    new_master_variant_id: input.masterVariantId,
    action: "CREATED",
    reason: "Created from the store SKU screen",
    changed_by_employee_id: input.actorId,
  });
  if (historyError) return { error: explain(historyError, "Mapping saved but history could not be written."), message: null };

  return { error: null, message: `Store SKU ${storeSku} mapped to ${variant.master_sku}.` };
}

export async function deactivateStoreSkuMapping(
  db: Db,
  input: { mappingId: string; companyId: string; actorId: string; reason?: string | null }
): Promise<MasterResult> {
  const { data: mapping, error } = await db
    .from("inventory_store_sku_map")
    .select("id, company_id, store_id, store_sku, master_variant_id, is_active")
    .eq("id", input.mappingId)
    .maybeSingle();
  if (error) return { error: explain(error, "Could not load the mapping."), message: null };
  if (!mapping) return { error: "That mapping no longer exists.", message: null };
  if (mapping.company_id !== input.companyId) {
    return { error: "That mapping belongs to another company.", message: null };
  }
  if (!mapping.is_active) return { error: null, message: "That mapping is already inactive." };

  const { error: updateError } = await db
    .from("inventory_store_sku_map")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", input.mappingId);
  if (updateError) return { error: explain(updateError, "Could not deactivate the mapping."), message: null };

  const { error: historyError } = await db.from("inventory_store_sku_map_history").insert({
    map_id: mapping.id,
    company_id: mapping.company_id,
    store_id: mapping.store_id,
    store_sku: mapping.store_sku,
    old_master_variant_id: mapping.master_variant_id,
    new_master_variant_id: null,
    action: "DEACTIVATED",
    reason: input.reason?.trim() || "Deactivated from the store SKU screen",
    changed_by_employee_id: input.actorId,
  });
  if (historyError) return { error: explain(historyError, "Deactivated but history could not be written."), message: null };

  return { error: null, message: `Store SKU ${mapping.store_sku} is now inactive (history kept).` };
}
