"use server";

// Store-level Daily Spend tracking (pending item 3 — see
// claude/order-lifecycle-inventory-tracking-adspend-requests-2026-08-08.md
// and db/2026-08-08-store-ad-spend.sql). Only Budget/Spend (USD) are real
// data here — QTY ORD / USD (order count / order value) are computed live
// from `orders` by the report queries in page.tsx/report data functions
// below, never stored in store_ad_spend.

import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function numOrZero(formData: FormData, key: string): number {
  const v = str(formData, key);
  return v ? Number(v) : 0;
}

export type AdSpendFormState = { error: string | null; success: boolean };
const ok: AdSpendFormState = { error: null, success: true };
const fail = (error: string): AdSpendFormState => ({ error, success: false });

/**
 * Upsert one (store, date) row — the form re-submitting the same store+date
 * simply overwrites the previous Budget/Spend for that day (matches the
 * old spreadsheet's "just re-type the cell" correction pattern; no
 * separate edit screen needed).
 */
export async function saveAdSpendAction(_prev: AdSpendFormState, formData: FormData): Promise<AdSpendFormState> {
  const employee = await requireCapability("ad_spend_entry");
  const supabase = createServiceRoleClient();

  const storeId = str(formData, "store_id");
  const spendDate = str(formData, "spend_date");
  if (!storeId) return fail("Select a store.");
  if (!spendDate) return fail("Date is required.");

  const budgetUsd = numOrZero(formData, "budget_usd");
  const spendUsd = numOrZero(formData, "spend_usd");
  if (budgetUsd < 0 || spendUsd < 0) return fail("Budget/Spend cannot be negative.");

  // Confirm this store belongs to one of the employee's accessible
  // companies before writing — same defense-in-depth check used across
  // every other module (e.g. lookupOrderForEntry's employee.companyIds
  // filter) rather than trusting the client-submitted store_id alone.
  const { data: store } = await supabase.from("stores").select("id, company_id").eq("id", storeId).maybeSingle();
  if (!store || !employee.companyIds.includes(store.company_id)) {
    return fail("You do not have access to this store.");
  }
  // 2026-08-08: store-scoping — without ad_spend_report_all, a login may
  // only enter Budget/Spend for a store it's actually assigned to (see
  // employee_store_access). The Store dropdown already only lists these,
  // but the client can be tampered with, so re-check here same as every
  // other capability guard in this codebase.
  if (!employee.capabilities.includes("ad_spend_report_all") && !employee.storeIds.includes(storeId)) {
    return fail("You do not have access to this store.");
  }

  const { error } = await supabase
    .from("store_ad_spend")
    .upsert(
      {
        store_id: storeId,
        spend_date: spendDate,
        budget_usd: budgetUsd,
        spend_usd: spendUsd,
        entry_by_employee_id: employee.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_id,spend_date" }
    );

  if (error) return fail(`Failed to save: ${error.message}`);
  revalidatePath("/dashboard/ad-spend");
  return ok;
}

export type SimpleResult = { error: string | null };

/** Clears a day's entry entirely (rather than leaving a stray 0/0 row). */
export async function deleteAdSpendAction(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("ad_spend_entry");
  const supabase = createServiceRoleClient();

  const { data: row } = await supabase.from("store_ad_spend").select("id, store_id").eq("id", id).maybeSingle();
  if (!row) return { error: "Entry not found." };
  const { data: store } = await supabase.from("stores").select("company_id").eq("id", row.store_id).maybeSingle();
  if (!store || !employee.companyIds.includes(store.company_id)) {
    return { error: "You do not have access to this entry." };
  }
  if (!employee.capabilities.includes("ad_spend_report_all") && !employee.storeIds.includes(row.store_id)) {
    return { error: "You do not have access to this entry." };
  }

  const { error } = await supabase.from("store_ad_spend").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/dashboard/ad-spend");
  return { error: null };
}
