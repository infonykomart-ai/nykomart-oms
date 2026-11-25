"use server";

// Store-level Daily Spend tracking (pending item 3 — see
// claude/order-lifecycle-inventory-tracking-adspend-requests-2026-08-08.md
// and db/2026-08-08-store-ad-spend.sql). Only Budget/Spend (USD) are real
// data here — QTY ORD / USD (order count / order value) are computed live
// from `orders` by the report queries in page.tsx/report data functions
// below, never stored in store_ad_spend.
//
// 2026-11-25 — CREATE / UPDATE / SOFT DELETE, explicitly separated.
// Before this, the only write was an upsert on (store, date, country): a
// correction silently replaced the previous numbers and overwrote
// entry_by_employee_id, and Delete physically removed the row. Now:
//   • a new entry that collides with an existing day is REFUSED with the
//     existing values, and the form offers Edit for those rows instead;
//   • updating writes only the intended row, keeps created_at/created_by and
//     records before → after in audit_log;
//   • deleting is a soft delete (deleted_at), restorable by an admin, and is
//     audited. Reports, the entry list and exports all filter deleted rows out.

import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit/log-audit";
// 2026-10-15 — Amazon is entered per marketplace country (see
// db/2026-10-15-ad-spend-amazon-country.sql).
import { AMAZON_COUNTRY_CODES, AMAZON_CURRENCIES, isAmazonStore } from "./amazon-countries";
// 2026-10-15b — live rate snapshot for the Amazon country-wise totals.
import { loadFxSnapshot } from "@/lib/fx/rates";
// 2026-11-21 — the same store-scope rule the page uses, so a login can only
// save/delete for a store that all three Ad Spend tabs would actually show it.
import { canWorkOnAdSpendStore, type AdSpendStoreScope } from "./store-scope";
// 2026-11-21 — the marketplace-specific numbers typed on the Daily Entry
// (Amazon / eBay / Etsy). Only the selected store's own channel columns are
// written, so saving an Amazon day can never blank an Etsy store's numbers.
import {
  CHANNEL_METRIC_KEYS,
  parseMetricNumber,
  storeChannel,
  type ChannelMetrics,
} from "./channel-metrics";

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

type ServiceClient = ReturnType<typeof createServiceRoleClient>;
type StoreRow = { id: string; name: string; company_id: string };

function scopeFor(capabilities: string[], companyIds: string[], storeIds: string[]): AdSpendStoreScope {
  return { companyIds, assignedStoreIds: storeIds, canSeeAllStores: capabilities.includes("ad_spend_report_all") };
}

const metricLabels: Record<keyof ChannelMetrics, string> = {
  clicks: "Clicks",
  impressions: "Impressions / Views",
  visits: "Visits",
  ad_revenue_usd: "Ad revenue (USD)",
  etsy_visits_daily: "Etsy visits (daily)",
  etsy_visits_monthly: "Etsy visits (monthly)",
  etsy_conversion_rate_monthly: "Etsy conversion rate (monthly)",
  etsy_revenue_usd: "Etsy revenue (USD)",
  etsy_orders: "Etsy orders",
  etsy_ad_clicks: "Etsy ads clicks",
};

type ValidatedEntry = {
  storeId: string;
  spendDate: string;
  countryCode: string;
  base: Record<string, unknown>;
  metrics: Partial<ChannelMetrics>;
  adOrders: number | null;
};

/**
 * Every rule the Daily Entry form has always enforced, in one place so CREATE
 * and UPDATE cannot drift apart. Returns the row payload or a human sentence.
 */
function validateEntry(formData: FormData, store: StoreRow): { value: ValidatedEntry } | { error: string } {
  const spendDate = str(formData, "spend_date");
  if (!spendDate) return { error: "Date is required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(spendDate)) return { error: "Date must be a valid YYYY-MM-DD date." };

  const budgetUsd = numOrZero(formData, "budget_usd");
  const spendUsd = numOrZero(formData, "spend_usd");
  if (!Number.isFinite(budgetUsd) || !Number.isFinite(spendUsd)) return { error: "Budget and Spend must be numbers." };
  if (budgetUsd < 0 || spendUsd < 0) return { error: "Budget/Spend cannot be negative." };

  // 2026-11-20 — optional ad-platform attributed orders: blank is "not
  // recorded" (NULL), never a typed zero.
  const adOrdersRaw = str(formData, "ad_orders");
  const adOrders = adOrdersRaw === "" ? null : Number(adOrdersRaw);
  if (adOrders !== null && (!Number.isFinite(adOrders) || !Number.isInteger(adOrders) || adOrders < 0)) {
    return { error: "Ad orders must be a whole number (0 or more), or left blank." };
  }

  // 2026-11-21 — channel metrics for this store's marketplace type. A blank
  // box stays "not recorded"; CTR and the Etsy spend % are derived on read.
  const channel = storeChannel(store.name);
  const metrics: Partial<ChannelMetrics> = {};
  for (const key of CHANNEL_METRIC_KEYS[channel]) {
    const parsed = parseMetricNumber(str(formData, key));
    if (parsed === undefined) {
      return { error: `${metricLabels[key]} must be zero or a positive number, or left blank.` };
    }
    metrics[key] = parsed;
  }
  if (
    metrics.clicks != null &&
    metrics.impressions != null &&
    metrics.impressions > 0 &&
    metrics.clicks > metrics.impressions
  ) {
    return { error: "Clicks cannot be more than impressions / views for the same day." };
  }

  const isAmazon = isAmazonStore(store.name);
  const submittedCountry = str(formData, "country_code").toUpperCase();
  if (isAmazon && !AMAZON_COUNTRY_CODES.includes(submittedCountry)) {
    return { error: "Amazon entries need a Country (US / UK / DE …)." };
  }
  const countryCode = isAmazon ? submittedCountry : "";

  return {
    value: {
      storeId: store.id,
      spendDate,
      countryCode,
      adOrders,
      metrics,
      base: { store_id: store.id, spend_date: spendDate, country_code: countryCode, budget_usd: budgetUsd, spend_usd: spendUsd },
    },
  };
}

/** Store row + the "may this login touch it" check, shared by both writes. */
async function resolveStore(
  supabase: ServiceClient,
  employee: { companyIds: string[]; storeIds: string[]; capabilities: string[] },
  storeId: string
): Promise<{ store: StoreRow } | { error: string }> {
  if (!storeId) return { error: "Select a store." };
  const { data } = await supabase.from("stores").select("id, name, company_id").eq("id", storeId).maybeSingle();
  const store = (data ?? null) as StoreRow | null;
  if (!store || !canWorkOnAdSpendStore(store, scopeFor(employee.capabilities, employee.companyIds, employee.storeIds))) {
    return { error: "You do not have access to this store." };
  }
  return { store };
}


/** The login that entered a row, or a login approved for the whole report. */
function mayChangeOthers(
  employee: { capabilities: string[]; id: string },
  row: { entry_by_employee_id: string | null }
): boolean {
  return employee.capabilities.includes("ad_spend_report_all") || row.entry_by_employee_id === employee.id;
}

function entryLabel(storeName: string, date: string, countryCode: string): string {
  return `${storeName} · ${date}${countryCode ? ` · ${countryCode}` : ""}`;
}

/**
 * Create ONE new (store, date, country) row.
 *
 * 2026-11-25 — an existing day is no longer overwritten: the save is refused
 * with that row's own figures, and the Recent Entries list's Edit button is
 * what changes it. That is what "never silently overwrite" means in practice.
 */
export async function saveAdSpendAction(_prev: AdSpendFormState, formData: FormData): Promise<AdSpendFormState> {
  const employee = await requireCapability("ad_spend_entry");
  const supabase = createServiceRoleClient();

  const resolved = await resolveStore(supabase, employee, str(formData, "store_id"));
  if ("error" in resolved) return fail(resolved.error);

  const validated = validateEntry(formData, resolved.store);
  if ("error" in validated) return fail(validated.error);
  const entry = validated.value;

  // Read WITHOUT the deleted filter: a soft-deleted day still occupies the
  // (store, date, country) unique key, so the honest answer is "restore it",
  // not a raw constraint error from the insert below.
  const { data: existing } = await supabase
    .from("store_ad_spend")
    .select("id, budget_usd, spend_usd, deleted_at")
    .eq("store_id", entry.storeId)
    .eq("spend_date", entry.spendDate)
    .eq("country_code", entry.countryCode)
    .maybeSingle();

  if (existing?.deleted_at) {
    return fail(
      `An entry for ${entryLabel(resolved.store.name, entry.spendDate, entry.countryCode)} was deleted. ` +
        `An admin can restore it from Deleted entries — saving a new one for the same day would double-count.`
    );
  }
  if (existing) {
    return fail(
      `An entry already exists for ${entryLabel(resolved.store.name, entry.spendDate, entry.countryCode)} ` +
        `(Budget $${Number(existing.budget_usd ?? 0).toFixed(2)}, Spend $${Number(existing.spend_usd ?? 0).toFixed(2)}). ` +
        `Use Edit on that row in Recent Entries to change it.`
    );
  }

  const now = new Date().toISOString();
  const { error } = await supabase.from("store_ad_spend").insert({
    ...entry.base,
    entry_by_employee_id: employee.id,
    created_by_employee_id: employee.id,
    created_at: now,
    updated_at: now,
    ad_orders: entry.adOrders,
    ...entry.metrics,
  } as never);
  if (error) return fail(`Failed to save: ${error.message}`);

  await logAudit(supabase, {
    companyId: resolved.store.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "ad_spend.created",
    entityType: "store_ad_spend",
    entityLabel: entryLabel(resolved.store.name, entry.spendDate, entry.countryCode),
    changes: { budget_usd: entry.base.budget_usd, spend_usd: entry.base.spend_usd, ad_orders: entry.adOrders },
  });

  revalidatePath("/dashboard/ad-spend");
  return ok;
}

/**
 * Update an existing row in place (the Edit button).
 *
 * Keeps created_at/created_by, records who changed it and what it was before,
 * and refuses to move the row onto another existing day instead of silently
 * merging two entries.
 */
export async function updateAdSpendEntryAction(_prev: AdSpendFormState, formData: FormData): Promise<AdSpendFormState> {
  const employee = await requireCapability("ad_spend_entry");
  const supabase = createServiceRoleClient();

  const entryId = str(formData, "entry_id");
  if (!entryId) return fail("Missing entry.");

  const { data: current } = await supabase
    .from("store_ad_spend")
    .select(
      "store_id, spend_date, country_code, budget_usd, spend_usd, ad_orders, clicks, impressions, ad_revenue_usd, entry_by_employee_id, deleted_at"
    )
    .eq("id", entryId)
    .maybeSingle();
  if (!current) return fail("That entry no longer exists.");
  if (current.deleted_at) return fail("That entry was deleted — restore it before editing.");

  const resolved = await resolveStore(supabase, employee, str(formData, "store_id") || current.store_id);
  if ("error" in resolved) return fail(resolved.error);

  if (!mayChangeOthers(employee, current)) {
    return fail("Only the login that entered this row (or an admin) can edit it.");
  }

  const validated = validateEntry(formData, resolved.store);
  if ("error" in validated) return fail(validated.error);
  const entry = validated.value;

  const keyChanged =
    entry.storeId !== current.store_id || entry.spendDate !== current.spend_date || entry.countryCode !== current.country_code;
  if (keyChanged) {
    const { data: clash } = await supabase
      .from("store_ad_spend")
      .select("id")
      .eq("store_id", entry.storeId)
      .eq("spend_date", entry.spendDate)
      .eq("country_code", entry.countryCode)
      .is("deleted_at", null)
      .neq("id", entryId)
      .maybeSingle();
    if (clash) {
      return fail(
        `Another entry already exists for ${entryLabel(resolved.store.name, entry.spendDate, entry.countryCode)}. ` +
          `Edit that one instead — two rows for the same day would double-count in every report.`
      );
    }
  }

  const update = {
    ...entry.base,
    entry_by_employee_id: employee.id,
    updated_at: new Date().toISOString(),
    ad_orders: entry.adOrders,
    ...entry.metrics,
  };

  const { error } = await supabase.from("store_ad_spend").update(update as never).eq("id", entryId);
  if (error) return fail(`Failed to update: ${error.message}`);

  await logAudit(supabase, {
    companyId: resolved.store.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "ad_spend.updated",
    entityType: "store_ad_spend",
    entityId: entryId,
    entityLabel: entryLabel(resolved.store.name, entry.spendDate, entry.countryCode),
    changes: {
      spend_date: { from: current.spend_date, to: entry.spendDate },
      store_id: { from: current.store_id, to: entry.storeId },
      country_code: { from: current.country_code, to: entry.countryCode },
      budget_usd: { from: Number(current.budget_usd ?? 0), to: entry.base.budget_usd },
      spend_usd: { from: Number(current.spend_usd ?? 0), to: entry.base.spend_usd },
      ad_orders: { from: current.ad_orders ?? null, to: entry.adOrders },
      clicks: { from: current.clicks ?? null, to: entry.metrics.clicks ?? null },
      impressions: { from: current.impressions ?? null, to: entry.metrics.impressions ?? null },
      ad_revenue_usd: { from: current.ad_revenue_usd ?? null, to: entry.metrics.ad_revenue_usd ?? null },
    },
  });

  revalidatePath("/dashboard/ad-spend");
  return ok;
}

/**
 * 2026-11-21 (round 2) — monthly budget + ROAS target per store
 * (store_ad_targets). Only logins approved for the complete report can set
 * them. One form saves every store at once; a blank pair clears that store's
 * target.
 */
export async function saveAdSpendTargetsAction(
  _prev: AdSpendFormState,
  formData: FormData
): Promise<AdSpendFormState> {
  const employee = await requireCapability("ad_spend_report_all");
  const supabase = createServiceRoleClient();
  const storeIds = Array.from(
    new Set(
      [...formData.keys()]
        .filter((k) => k.startsWith("budget_") || k.startsWith("roas_"))
        .map((k) => k.replace(/^(budget|roas)_/, ""))
    )
  );
  if (storeIds.length === 0) return ok;

  const { data: stores } = await supabase.from("stores").select("id, company_id").in("id", storeIds);
  const allowed = new Set((stores ?? []).filter((s) => employee.companyIds.includes(s.company_id)).map((s) => s.id));

  const rows: { store_id: string; monthly_budget_usd: number | null; roas_target: number | null; updated_at: string }[] = [];
  const cleared: string[] = [];
  for (const storeId of storeIds) {
    if (!allowed.has(storeId)) continue;
    const budgetRaw = String(formData.get(`budget_${storeId}`) ?? "").trim();
    const roasRaw = String(formData.get(`roas_${storeId}`) ?? "").trim();
    const budget = budgetRaw === "" ? null : Number(budgetRaw);
    const roas = roasRaw === "" ? null : Number(roasRaw);
    if (budget !== null && (!Number.isFinite(budget) || budget < 0)) return fail("Monthly budget must be 0 or more.");
    if (roas !== null && (!Number.isFinite(roas) || roas < 0)) return fail("ROAS target must be 0 or more.");
    if (budget === null && roas === null) cleared.push(storeId);
    else rows.push({ store_id: storeId, monthly_budget_usd: budget, roas_target: roas, updated_at: new Date().toISOString() });
  }

  if (rows.length > 0) {
    const { error } = await supabase
      .from("store_ad_targets")
      .upsert(rows as never, { onConflict: "store_id" });
    if (error) return fail(`Could not save targets: ${error.message}`);
  }
  if (cleared.length > 0) {
    const { error } = await supabase.from("store_ad_targets").delete().in("store_id", cleared);
    if (error) return fail(`Could not clear targets: ${error.message}`);
  }
  revalidatePath("/dashboard/ad-spend");
  return ok;
}

export type SimpleResult = { error: string | null };

/**
 * 2026-10-15b — the Amazon Country-wise conversion strip refreshes at a live
 * market rate (see src/lib/fx/rates.ts). This action is the manual "Refresh
 * rates" button next to those numbers.
 */
export async function refreshFxRatesAction(): Promise<SimpleResult> {
  await requireCapability("ad_spend_entry");
  const supabase = createServiceRoleClient();
  const snapshot = await loadFxSnapshot(supabase, AMAZON_CURRENCIES, { force: true });
  revalidatePath("/dashboard/ad-spend");
  if (snapshot.stale) return { error: snapshot.warning ?? "Could not refresh the exchange rates." };
  return { error: null };
}

/**
 * Soft-delete one entry (2026-11-25).
 *
 * The row stays in the table with deleted_at/deleted_by set — every report,
 * list, export and chart filters it out — and an admin can restore it. The
 * audit entry records what the deleted row actually held, so nothing about
 * the day is lost.
 */
export async function deleteAdSpendAction(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("ad_spend_entry");
  const supabase = createServiceRoleClient();

  const { data: row } = await supabase
    .from("store_ad_spend")
    .select("id, store_id, spend_date, country_code, budget_usd, spend_usd, entry_by_employee_id, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { error: "Entry not found." };
  if (row.deleted_at) return { error: "That entry is already deleted." };

  const { data: store } = await supabase.from("stores").select("id, name, company_id").eq("id", row.store_id).maybeSingle();
  if (!store) return { error: "The store for this entry no longer exists." };
  if (!mayChangeOthers(employee, row)) {
    return { error: "Only the login that entered this row (or an admin) can delete it." };
  }
  if (!canWorkOnAdSpendStore(store, scopeFor(employee.capabilities, employee.companyIds, employee.storeIds))) {
    return { error: "You do not have access to this entry." };
  }

  const { error } = await supabase
    .from("store_ad_spend")
    .update({ deleted_at: new Date().toISOString(), deleted_by_employee_id: employee.id, updated_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) return { error: error.message };

  await logAudit(supabase, {
    companyId: store.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "ad_spend.deleted",
    entityType: "store_ad_spend",
    entityId: id,
    entityLabel: entryLabel(store.name, row.spend_date, row.country_code ?? ""),
    changes: {
      soft_deleted: true,
      budget_usd: Number(row.budget_usd ?? 0),
      spend_usd: Number(row.spend_usd ?? 0),
    },
  });

  revalidatePath("/dashboard/ad-spend");
  return { error: null };
}

/** Admin-only undo for a soft delete (the same entry comes back as it was). */
export async function restoreAdSpendEntryAction(id: string): Promise<SimpleResult> {
  const employee = await requireCapability("ad_spend_report_all");
  const supabase = createServiceRoleClient();

  const { data: row } = await supabase
    .from("store_ad_spend")
    .select("id, store_id, spend_date, country_code")
    .eq("id", id)
    .maybeSingle();
  if (!row) return { error: "Entry not found." };

  const { data: store } = await supabase.from("stores").select("name, company_id").eq("id", row.store_id).maybeSingle();
  if (store && !employee.companyIds.includes(store.company_id)) {
    return { error: "You do not have access to this entry." };
  }

  const { error } = await supabase
    .from("store_ad_spend")
    .update({ deleted_at: null, deleted_by_employee_id: null, updated_at: new Date().toISOString() } as never)
    .eq("id", id);
  if (error) return { error: error.message };

  await logAudit(supabase, {
    companyId: store?.company_id ?? null,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "ad_spend.restored",
    entityType: "store_ad_spend",
    entityId: id,
    entityLabel: entryLabel(store?.name ?? "", row.spend_date, row.country_code ?? ""),
  });

  revalidatePath("/dashboard/ad-spend");
  return { error: null };
}
