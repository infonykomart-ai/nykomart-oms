// 2026-11-20 — read-side queries for the Master SKU and store-mapping screens.
//
// Master products/variants are deliberately CROSS-COMPANY (one physical design
// is one identity no matter which company sells it). Company/store mappings are
// scoped to the signed-in employee's companies by the caller passing companyIds.
//
// Plain queries joined in TypeScript, same convention as ./queries.ts: the
// inventory tables are read through the unchecked service-role client, so
// embedded selects buy nothing and only make the shapes harder to reason about.
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { isMissingSchemaPiece } from "@/lib/db/missing-column";

type Db = ReturnType<typeof createServiceRoleClientUnchecked>;

export type MasterProductRow = {
  id: string;
  master_code: string;
  name: string;
  design_code: string | null;
  item_category_id: string | null;
  material: string | null;
  construction: string | null;
  notes: string | null;
  active: boolean;
  created_at: string;
};

export type MasterVariantRow = {
  id: string;
  master_product_id: string;
  master_sku: string;
  size_label: string;
  size_unit: string | null;
  colour: string;
  length_value: number | null;
  width_value: number | null;
  active: boolean;
  merged_into_id: string | null;
  created_at: string;
};

export type MasterMergeRow = {
  id: string;
  source_master_sku: string;
  target_master_sku: string;
  mappings_moved: number;
  variants_moved: number;
  reservations_moved: number;
  reason: string | null;
  created_at: string;
};

export type MasterPhotoRow = {
  id: string;
  master_variant_id: string;
  image_type: string;
  file_name: string | null;
  is_active: boolean;
  uploaded_at: string;
};

export type MasterCatalog = {
  products: MasterProductRow[];
  variants: MasterVariantRow[];
  merges: MasterMergeRow[];
  photos: MasterPhotoRow[];
  mappingCounts: Map<string, number>;
  missingMigration: boolean;
  error: string | null;
};

const EMPTY_CATALOG: MasterCatalog = {
  products: [],
  variants: [],
  merges: [],
  photos: [],
  mappingCounts: new Map(),
  missingMigration: false,
  error: null,
};

/**
 * Full master catalogue for the Master SKU screen. Master data is global on
 * purpose; writes still require inventory_master_admin (checked in actions).
 */
export async function loadMasterCatalog(db: Db): Promise<MasterCatalog> {
  const [productsRes, variantsRes] = await Promise.all([
    db
      .from("inventory_master_products")
      .select("id, master_code, name, design_code, item_category_id, material, construction, notes, active, created_at")
      .order("master_code"),
    db
      .from("inventory_master_variants")
      .select(
        "id, master_product_id, master_sku, size_label, size_unit, colour, length_value, width_value, active, merged_into_id, created_at"
      )
      .order("master_sku"),
  ]);

  if (productsRes.error || variantsRes.error) {
    const error = productsRes.error ?? variantsRes.error;
    return {
      ...EMPTY_CATALOG,
      missingMigration: isMissingSchemaPiece(error),
      error: error?.message ?? "Could not load Master SKUs.",
    };
  }

  const [mapsRes, mergesRes, photosRes] = await Promise.all([
    db.from("inventory_store_sku_map").select("master_variant_id"),
    db
      .from("inventory_master_merge_log")
      .select("id, source_master_sku, target_master_sku, mappings_moved, variants_moved, reservations_moved, reason, created_at")
      .order("created_at", { ascending: false })
      .limit(50),
    // 2026-11-20d — Master SKU photo album. Its migration is separate, so a
    // missing table must never blank the catalogue: just no thumbnails.
    db
      .from("inventory_master_variant_photos")
      .select("id, master_variant_id, image_type, file_name, is_active, uploaded_at")
      .order("uploaded_at", { ascending: false })
      .limit(2000),
  ]);

  const mappingCounts = new Map<string, number>();
  for (const row of (mapsRes.data ?? []) as { master_variant_id: string }[]) {
    mappingCounts.set(row.master_variant_id, (mappingCounts.get(row.master_variant_id) ?? 0) + 1);
  }

  return {
    products: (productsRes.data ?? []) as MasterProductRow[],
    variants: (variantsRes.data ?? []) as MasterVariantRow[],
    // The merge log only exists after 2026-11-20c; absence must not blank the page.
    merges: mergesRes.error ? [] : ((mergesRes.data ?? []) as MasterMergeRow[]),
    photos: photosRes.error ? [] : ((photosRes.data ?? []) as MasterPhotoRow[]),
    mappingCounts,
    missingMigration: false,
    error: null,
  };
}

export type MappingCompanyRow = { id: string; name: string };
export type MappingStoreRow = { id: string; company_id: string; name: string; active: boolean };

export type StoreMappingRow = {
  id: string;
  company_id: string;
  store_id: string;
  master_variant_id: string;
  store_sku: string;
  marketplace_listing_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  companyName: string;
  storeName: string;
  masterSku: string;
  productName: string;
  sizeLabel: string;
  colour: string;
};

export type MappingHistoryRow = {
  id: string;
  store_sku: string;
  action: string;
  old_master_sku: string | null;
  new_master_sku: string | null;
  reason: string | null;
  changed_at: string;
  storeName: string;
  companyName: string;
};

export type MappingData = {
  companies: MappingCompanyRow[];
  stores: MappingStoreRow[];
  variantOptions: {
    id: string;
    master_sku: string;
    productName: string;
    size_label: string;
    colour: string;
    merged: boolean;
    active: boolean;
  }[];
  mappings: StoreMappingRow[];
  history: MappingHistoryRow[];
  missingMigration: boolean;
  error: string | null;
};

export type MappingFilters = { companyId?: string; storeId?: string; query?: string };

/**
 * Mapping screen data, restricted to the employee's companies. Store SKUs are
 * matched on text (store SKU / master SKU / product name).
 */
export async function loadMappingData(
  db: Db,
  companyIds: string[],
  filters: MappingFilters = {}
): Promise<MappingData> {
  const empty: MappingData = {
    companies: [],
    stores: [],
    variantOptions: [],
    mappings: [],
    history: [],
    missingMigration: false,
    error: null,
  };
  if (companyIds.length === 0) return empty;

  const [companiesRes, storesRes, catalogRes] = await Promise.all([
    db.from("companies").select("id, name").in("id", companyIds).order("name"),
    db.from("stores").select("id, company_id, name, active").in("company_id", companyIds).order("name"),
    loadMasterCatalog(db),
  ]);

  if (catalogRes.missingMigration || catalogRes.error) {
    return { ...empty, missingMigration: catalogRes.missingMigration, error: catalogRes.error };
  }

  const companyById = new Map(
    ((companiesRes.data ?? []) as MappingCompanyRow[]).map((c) => [c.id, c.name])
  );
  const storeById = new Map(
    ((storesRes.data ?? []) as MappingStoreRow[]).map((s) => [s.id, s])
  );
  const productById = new Map(catalogRes.products.map((p) => [p.id, p]));
  const variantById = new Map(catalogRes.variants.map((v) => [v.id, v]));

  let mappingQuery = db
    .from("inventory_store_sku_map")
    .select("id, company_id, store_id, master_variant_id, store_sku, marketplace_listing_id, is_active, created_at, updated_at")
    .in("company_id", companyIds)
    .order("updated_at", { ascending: false })
    .limit(500);
  if (filters.companyId && companyIds.includes(filters.companyId)) {
    mappingQuery = mappingQuery.eq("company_id", filters.companyId);
  }
  if (filters.storeId) mappingQuery = mappingQuery.eq("store_id", filters.storeId);

  const [mappingsRes, historyRes] = await Promise.all([
    mappingQuery,
    db
      .from("inventory_store_sku_map_history")
      .select("id, store_sku, action, old_master_variant_id, new_master_variant_id, reason, changed_at, store_id, company_id")
      .in("company_id", companyIds)
      .order("changed_at", { ascending: false })
      .limit(100),
  ]);

  const q = (filters.query ?? "").trim().toLowerCase();

  const mappings: StoreMappingRow[] = ((mappingsRes.data ?? []) as {
    id: string;
    company_id: string;
    store_id: string;
    master_variant_id: string;
    store_sku: string;
    marketplace_listing_id: string | null;
    is_active: boolean;
    created_at: string;
    updated_at: string;
  }[])
    .map((row) => {
      const variant = variantById.get(row.master_variant_id);
      const product = variant ? productById.get(variant.master_product_id) : null;
      return {
        ...row,
        companyName: companyById.get(row.company_id) ?? "—",
        storeName: storeById.get(row.store_id)?.name ?? "—",
        masterSku: variant?.master_sku ?? "—",
        productName: product?.name ?? "—",
        sizeLabel: variant?.size_label ?? "",
        colour: variant?.colour ?? "",
      };
    })
    .filter((row) =>
      !q ||
      row.store_sku.toLowerCase().includes(q) ||
      row.masterSku.toLowerCase().includes(q) ||
      row.productName.toLowerCase().includes(q) ||
      row.storeName.toLowerCase().includes(q)
    );

  const history: MappingHistoryRow[] = ((historyRes.data ?? []) as {
    id: string;
    store_sku: string;
    action: string;
    old_master_variant_id: string | null;
    new_master_variant_id: string | null;
    reason: string | null;
    changed_at: string;
    store_id: string;
    company_id: string;
  }[]).map((row) => ({
    id: row.id,
    store_sku: row.store_sku,
    action: row.action,
    old_master_sku: row.old_master_variant_id ? variantById.get(row.old_master_variant_id)?.master_sku ?? null : null,
    new_master_sku: row.new_master_variant_id ? variantById.get(row.new_master_variant_id)?.master_sku ?? null : null,
    reason: row.reason,
    changed_at: row.changed_at,
    storeName: storeById.get(row.store_id)?.name ?? "—",
    companyName: companyById.get(row.company_id) ?? "—",
  }));

  return {
    companies: (companiesRes.data ?? []) as MappingCompanyRow[],
    stores: (storesRes.data ?? []) as MappingStoreRow[],
    variantOptions: catalogRes.variants
      .map((v) => {
        const product = productById.get(v.master_product_id);
        return {
          id: v.id,
          master_sku: v.master_sku,
          productName: product?.name ?? "—",
          size_label: v.size_label,
          colour: v.colour,
          merged: Boolean(v.merged_into_id),
          active: v.active,
        };
      })
      .sort((a, b) => a.master_sku.localeCompare(b.master_sku)),
    mappings,
    history,
    missingMigration: false,
    error: mappingsRes.error?.message ?? historyRes.error?.message ?? null,
  };
}
