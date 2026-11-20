"use server";

// 2026-11-20 — Server actions for Master SKUs and store SKU mappings.
// Same contract as ./actions.ts: capability is re-checked here, never trusted
// from the hidden form fields, and results travel back as ?ok= / ?error= so
// these screens stay fully server-rendered.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import {
  deactivateStoreSkuMapping,
  mergeMasterVariants,
  saveMasterProduct,
  saveMasterVariant,
  saveStoreSkuMapping,
} from "@/lib/inventory/master-service";

const BASE = "/dashboard/inventory";
const MASTERS = `${BASE}/masters`;
const MAPPINGS = `${BASE}/mappings`;

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function numOrNull(formData: FormData, key: string): number | null {
  const raw = str(formData, key);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
function checked(formData: FormData, key: string): boolean {
  return formData.get(key) !== null && formData.get(key) !== "false";
}
function safeTarget(formData: FormData, fallback: string): string {
  const target = str(formData, "return_to");
  return target.startsWith(BASE) ? target : fallback;
}
function done(target: string, message: string): never {
  redirect(`${target}?${new URLSearchParams({ ok: message }).toString()}`);
}
function failed(target: string, message: string): never {
  redirect(`${target}?${new URLSearchParams({ error: message }).toString()}`);
}

export async function masterProductAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_master_admin");
  const target = safeTarget(formData, MASTERS);
  const db = createServiceRoleClientUnchecked();

  const result = await saveMasterProduct(db, {
    id: str(formData, "id") || null,
    masterCode: str(formData, "master_code"),
    name: str(formData, "name"),
    designCode: str(formData, "design_code") || null,
    itemCategoryId: str(formData, "item_category_id") || null,
    material: str(formData, "material") || null,
    construction: str(formData, "construction") || null,
    notes: str(formData, "notes") || null,
    active: checked(formData, "active"),
    actorId: employee.id,
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, result.message!);
}

export async function masterVariantAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_master_admin");
  const target = safeTarget(formData, MASTERS);
  const db = createServiceRoleClientUnchecked();

  const result = await saveMasterVariant(db, {
    id: str(formData, "id") || null,
    masterProductId: str(formData, "master_product_id"),
    masterSku: str(formData, "master_sku") || null,
    sizeLabel: str(formData, "size_label"),
    sizeUnit: str(formData, "size_unit") || null,
    colour: str(formData, "colour"),
    lengthValue: numOrNull(formData, "length_value"),
    widthValue: numOrNull(formData, "width_value"),
    active: checked(formData, "active"),
    actorId: employee.id,
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, result.message!);
}

export async function mergeMasterVariantsAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_master_admin");
  const target = safeTarget(formData, MASTERS);
  const db = createServiceRoleClientUnchecked();

  const result = await mergeMasterVariants(db, {
    sourceVariantId: str(formData, "source_variant_id"),
    targetVariantId: str(formData, "target_variant_id"),
    reason: str(formData, "reason") || null,
    actorId: employee.id,
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, result.message!);
}

export async function storeSkuMappingAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_master_admin");
  const target = safeTarget(formData, MAPPINGS);
  const companyId = str(formData, "company_id");
  if (!employee.companyIds.includes(companyId)) {
    failed(target, "You do not have access to that company.");
  }
  const db = createServiceRoleClientUnchecked();

  const result = await saveStoreSkuMapping(db, {
    companyId,
    storeId: str(formData, "store_id"),
    storeSku: str(formData, "store_sku"),
    masterVariantId: str(formData, "master_variant_id"),
    marketplaceListingId: str(formData, "marketplace_listing_id") || null,
    actorId: employee.id,
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, result.message!);
}

export async function deactivateMappingAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_master_admin");
  const target = safeTarget(formData, MAPPINGS);
  const companyId = str(formData, "company_id");
  if (!employee.companyIds.includes(companyId)) {
    failed(target, "You do not have access to that company.");
  }
  const db = createServiceRoleClientUnchecked();

  const result = await deactivateStoreSkuMapping(db, {
    mappingId: str(formData, "mapping_id"),
    companyId,
    reason: str(formData, "reason") || null,
    actorId: employee.id,
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, result.message!);
}
