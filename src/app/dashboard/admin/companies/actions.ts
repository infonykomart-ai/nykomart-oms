"use server";

// Company & Item Admin (round 11) — the company_item_admin dashboard tile
// already pointed at /dashboard/admin/companies; this fills in the missing
// screen. Old system's design (per claude/pending-feature-requests notes):
// "Add Company / Add Item Category / Add Size" — a runtime-append pattern
// over the companies/item_categories/sizes tables, which all already
// existed with everything needed (no new columns required).
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export type SimpleFormState = { error: string | null; success: boolean };

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}

export async function createCompany(_prev: SimpleFormState, formData: FormData): Promise<SimpleFormState> {
  await requireCapability("company_item_admin");
  const supabase = createServiceRoleClient();

  const name = str(formData, "name");
  const shortCode = str(formData, "short_code").toUpperCase();
  const refPrefix = str(formData, "ref_prefix").toUpperCase();
  if (!name || !shortCode || !refPrefix) {
    return { error: "Name, Short Code, and Ref Prefix (used in PO/RF/RG numbers) are all required.", success: false };
  }
  const weeklyOffRaw = formData.getAll("weekly_off_days").map(String).filter(Boolean).map(Number);

  const { error } = await supabase.from("companies").insert({
    name,
    short_code: shortCode,
    ref_prefix: refPrefix,
    master_invoice_prefix: strOrNull(formData, "master_invoice_prefix"),
    logo_url: strOrNull(formData, "logo_url"),
    weekly_off_days: weeklyOffRaw.length > 0 ? weeklyOffRaw : [0],
  });

  if (error) {
    if (error.message.toLowerCase().includes("duplicate key")) {
      return { error: "A company with this Name, Short Code, or Ref Prefix already exists.", success: false };
    }
    return { error: error.message, success: false };
  }

  revalidatePath("/dashboard/admin/companies");
  return { error: null, success: true };
}

export async function setCompanyActive(id: string, active: boolean): Promise<{ error: string | null }> {
  await requireCapability("company_item_admin");
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("companies").update({ active }).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/admin/companies");
  return { error: null };
}

// -----------------------------------------------------------------------
// Store management (2026-09-13 — "ek ye section or add karna hai ki agar
// kisi store ko delete karna, rename karna, naya store add karna ho kis
// company me add ho raha") — stores were previously seed-data only: the 17
// marketplace/website stores (Amazon Arts of Jaipur, Etsy The Rugara, ...
// per the Ad Spend entry screen) could never be added to, renamed, or
// removed from the app, even though stores.company_id already existed and
// every store-scoped feature (Ad Spend entry scoping, employee_store_access,
// order entry's store select, invoice prefixes) reads this one table.
//
// DELETE is a soft-deactivate, NOT a SQL DELETE — stores is referenced by
// orders.store_id (NOT NULL FK), store_ad_spend, employee_store_access,
// leave_coverage_assignments, sales_invoices.store_id, refunds, etc., so a
// hard delete would fail on FK constraints (or, worse, cascade-delete real
// orders). `active = false` is what the Ad Spend entry screen already
// understands (its own toggle uses setCompanyActive on companies, and
// stores.active exists for exactly this). Rename keeps history intact —
// every order that pointed at the store keeps pointing at the same row.
// -----------------------------------------------------------------------

export async function createStore(_prev: SimpleFormState, formData: FormData): Promise<SimpleFormState> {
  await requireCapability("company_item_admin");
  const supabase = createServiceRoleClient();

  const name = str(formData, "name");
  const companyId = str(formData, "company_id");
  if (!name || !companyId) return { error: "Store name and company are both required.", success: false };

  const { error } = await supabase.from("stores").insert({
    name,
    company_id: companyId,
    invoice_ref_prefix: strOrNull(formData, "invoice_ref_prefix"),
  });

  if (error) {
    if (error.message.toLowerCase().includes("duplicate key")) {
      return { error: "A store with this name already exists (names are unique per company).", success: false };
    }
    return { error: error.message, success: false };
  }

  revalidatePath("/dashboard/admin/companies");
  // Ad Spend entry + employee store-access screens read stores too.
  revalidatePath("/dashboard/ad-spend");
  revalidatePath("/dashboard/admin/employees");
  return { error: null, success: true };
}

export async function renameStore(storeId: string, newName: string): Promise<{ error: string | null }> {
  await requireCapability("company_item_admin");
  const supabase = createServiceRoleClient();

  const name = newName.trim();
  if (!name) return { error: "Store name cannot be empty." };

  const { error } = await supabase.from("stores").update({ name }).eq("id", storeId);
  if (error) {
    if (error.message.toLowerCase().includes("duplicate key")) {
      return { error: "A store with this name already exists in that company." };
    }
    return { error: error.message };
  }

  revalidatePath("/dashboard/admin/companies");
  revalidatePath("/dashboard/ad-spend");
  revalidatePath("/dashboard/admin/employees");
  return { error: null };
}

export async function setStoreActive(storeId: string, active: boolean): Promise<{ error: string | null }> {
  await requireCapability("company_item_admin");
  const supabase = createServiceRoleClient();

  const { error } = await supabase.from("stores").update({ active }).eq("id", storeId);
  if (error) return { error: error.message };

  revalidatePath("/dashboard/admin/companies");
  revalidatePath("/dashboard/ad-spend");
  revalidatePath("/dashboard/admin/employees");
  return { error: null };
}

export async function createItemCategory(_prev: SimpleFormState, formData: FormData): Promise<SimpleFormState> {
  await requireCapability("company_item_admin");
  const supabase = createServiceRoleClient();

  const name = str(formData, "name");
  if (!name) return { error: "Item Category name is required.", success: false };

  const { error } = await supabase.from("item_categories").insert({
    name,
    hsn_code: strOrNull(formData, "hsn_code"),
    harmonized_tariff_number: strOrNull(formData, "harmonized_tariff_number"),
  });

  if (error) {
    if (error.message.toLowerCase().includes("duplicate key")) {
      return { error: "This Item Category already exists.", success: false };
    }
    return { error: error.message, success: false };
  }

  revalidatePath("/dashboard/admin/companies");
  return { error: null, success: true };
}

export async function createSize(_prev: SimpleFormState, formData: FormData): Promise<SimpleFormState> {
  await requireCapability("company_item_admin");
  const supabase = createServiceRoleClient();

  const label = str(formData, "label");
  if (!label) return { error: "Size label is required.", success: false };

  const { error } = await supabase.from("sizes").insert({ label });

  if (error) {
    if (error.message.toLowerCase().includes("duplicate key")) {
      return { error: "This size already exists.", success: false };
    }
    return { error: error.message, success: false };
  }

  revalidatePath("/dashboard/admin/companies");
  return { error: null, success: true };
}
