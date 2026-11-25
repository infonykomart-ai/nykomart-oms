// 2026-11-25 — One query for the Daily Entry list, its filters, its
// pagination and the CSV/Excel export.
//
// WHY ONE MODULE: the export must contain exactly the rows the screen is
// showing. Two hand-written queries would drift the moment a filter is added
// to one of them, and "the Excel doesn't match what I see" is precisely the
// kind of bug that is invisible until someone reconciles a month by hand.
import type { createServiceRoleClient } from "@/lib/supabase/server";
// The one CTR formula the report already uses, so an exported CTR can never
// disagree with the one on screen. Imported by relative path so this module
// stays runnable under plain `node --test` (see entries.test.ts).
import { ctrPct } from "../../app/dashboard/ad-spend/channel-metrics";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type AdSpendEntryRow = {
  id: string;
  store_id: string;
  spend_date: string;
  country_code: string | null;
  budget_usd: number | string | null;
  spend_usd: number | string | null;
  ad_orders: number | null;
  clicks: number | null;
  impressions: number | null;
  visits: number | null;
  etsy_visits_daily: number | null;
  etsy_visits_monthly: number | null;
  etsy_conversion_rate_monthly: number | string | null;
  etsy_revenue_usd: number | string | null;
  etsy_orders: number | null;
  etsy_ad_clicks: number | null;
  ad_revenue_usd: number | string | null;
  entry_by_employee_id: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
};

export type AdSpendEntryFilters = {
  /** Stores this login may see (already scoped by storesForAdSpend). */
  storeIds: string[];
  /** '' = every visible store. */
  storeId?: string;
  from?: string;
  to?: string;
  /** Free text: a store name, or a date prefix (2026, 2026-11, 2026-11-24). */
  q?: string;
  /** Export exactly these rows (the ticked entries). Wins over q/from/to. */
  ids?: string[];
  /** Include soft-deleted rows (admins only). */
  includeDeleted?: boolean;
  page?: number;
  pageSize?: number;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A selection is bounded so a hand-built URL cannot ask for the whole table. */
export const MAX_SELECTED_IDS = 200;

/**
 * The ticked entry ids from `?ids=a,b,c`. Anything that is not a UUID is
 * dropped and duplicates collapse, so a malformed URL simply selects fewer
 * rows instead of erroring.
 */
export function parseSelectedIds(raw: string | null | undefined): string[] {
  const seen = new Set<string>();
  for (const token of (raw ?? "").split(",")) {
    const id = token.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) seen.add(id);
  }
  return [...seen].slice(0, MAX_SELECTED_IDS);
}

/** What the URL actually resolved to — every field present, store scoped. */
export type ResolvedEntryFilters = {
  storeIds: string[];
  storeId: string;
  from: string;
  to: string;
  q: string;
  includeDeleted: boolean;
  page: number;
  pageSize: number;
};

export function parseEntryFilters(
  sp: Record<string, string | string[] | undefined>,
  storeIds: string[]
): ResolvedEntryFilters {
  const one = (key: string) => (typeof sp[key] === "string" ? (sp[key] as string) : "");
  const storeId = storeIds.includes(one("store")) ? one("store") : "";
  const from = DATE_RE.test(one("from")) ? one("from") : "";
  const to = DATE_RE.test(one("to")) ? one("to") : "";
  const q = one("q").trim().slice(0, 80);
  const page = Math.max(1, Math.min(10_000, Number.parseInt(one("page"), 10) || 1));
  return {
    storeIds,
    storeId,
    from,
    to,
    q,
    includeDeleted: one("showDeleted") === "1",
    page,
    pageSize: 25,
  };
}

/** Turn the free-text box into the database filters it can honestly mean. */
function resolveSearch(q: string, storeIds: string[], storeName: (id: string) => string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return { storeIds, datePrefix: "" as string };
  if (/^\d{4}(-\d{2}){0,2}$/.test(needle)) {
    return { storeIds, datePrefix: needle };
  }
  const matching = storeIds.filter((id) => storeName(id).toLowerCase().includes(needle));
  return { storeIds: matching, datePrefix: "" };
}

export async function listAdSpendEntries(
  supabase: ServiceClient,
  filters: AdSpendEntryFilters & { storeName?: (id: string) => string }
): Promise<{ rows: AdSpendEntryRow[]; total: number; page: number; pageSize: number }> {
  const pageSize = Math.max(1, Math.min(5000, filters.pageSize ?? 25));
  const page = Math.max(1, filters.page ?? 1);
  const base = filters.storeId ? filters.storeIds.filter((id) => id === filters.storeId) : filters.storeIds;
  if (base.length === 0) return { rows: [], total: 0, page, pageSize };

  // A ticked-row export means exactly those rows: it keeps the store scope and
  // the soft-delete rule, but no search/date filter can drop one of them.
  const ids = (filters.ids ?? []).slice(0, MAX_SELECTED_IDS);
  const search = ids.length
    ? { storeIds: base, datePrefix: "" }
    : resolveSearch(filters.q ?? "", base, filters.storeName ?? (() => ""));
  if (search.storeIds.length === 0) return { rows: [], total: 0, page, pageSize };

  const from = (page - 1) * pageSize;

  // Built per attempt so the soft-delete filter can be dropped on a database
  // that has not run db/2026-11-25-ad-spend-entry-audit.sql yet — the list
  // then shows every row (as it did before that file) instead of nothing.
  const run = async (withSoftDeleteFilter: boolean) => {
    let query = supabase
      .from("store_ad_spend")
      .select("*", { count: "exact" })
      .in("store_id", search.storeIds)
      .order("spend_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (withSoftDeleteFilter && !filters.includeDeleted) query = query.is("deleted_at", null);
    if (ids.length > 0) query = query.in("id", ids);
    if (ids.length === 0 && filters.from) query = query.gte("spend_date", filters.from);
    if (ids.length === 0 && filters.to) query = query.lte("spend_date", filters.to);
    if (ids.length === 0 && search.datePrefix) {
      const start =
        search.datePrefix.length === 4
          ? `${search.datePrefix}-01-01`
          : search.datePrefix.length === 7
            ? `${search.datePrefix}-01`
            : search.datePrefix;
      const end =
        search.datePrefix.length === 4
          ? `${search.datePrefix}-12-31`
          : search.datePrefix.length === 7
            ? `${search.datePrefix}-31`
            : search.datePrefix;
      query = query.gte("spend_date", start).lte("spend_date", end);
    }
    return await query.range(from, from + pageSize - 1);
  };

  let result = await run(true);
  if (result.error && !filters.includeDeleted) result = await run(false);
  if (result.error) return { rows: [], total: 0, page, pageSize };
  return {
    rows: (result.data ?? []) as unknown as AdSpendEntryRow[],
    total: result.count ?? 0,
    page,
    pageSize,
  };
}

/** The columns every export writes, in one order, with no invented values. */
export type ExportColumn = { label: string; value: (row: ExportRow) => string | number };

export type ExportRow = {
  id: string;
  companyName: string;
  storeName: string;
  country: string;
  date: string;
  budget: number | null;
  spend: number | null;
  adOrders: number | null;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  visits: number | null;
  adRevenue: number | null;
  etsyVisitsDaily: number | null;
  etsyVisitsMonthly: number | null;
  etsyConversionRate: number | null;
  etsyRevenue: number | null;
  etsyOrders: number | null;
  etsyAdClicks: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
};

const num = (raw: number | string | null | undefined): number | null => {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

/** Row → export row. Blank stays blank; nothing is coerced to 0. */
export function toExportRow(
  row: AdSpendEntryRow,
  names: { store: string; company: string; countryLabel: (code: string) => string }
): ExportRow {
  const clicks = row.clicks === null || row.clicks === undefined ? null : Number(row.clicks);
  const impressions = row.impressions === null || row.impressions === undefined ? null : Number(row.impressions);
  return {
    id: row.id,
    companyName: names.company,
    storeName: names.store,
    country: row.country_code ? names.countryLabel(row.country_code) : "",
    date: row.spend_date,
    budget: num(row.budget_usd),
    spend: num(row.spend_usd),
    adOrders: row.ad_orders ?? null,
    impressions,
    clicks,
    ctr: clicks !== null && impressions !== null && impressions > 0 ? ctrPct(clicks, impressions) : null,
    visits: row.visits ?? null,
    adRevenue: num(row.ad_revenue_usd),
    etsyVisitsDaily: row.etsy_visits_daily ?? null,
    etsyVisitsMonthly: row.etsy_visits_monthly ?? null,
    etsyConversionRate: num(row.etsy_conversion_rate_monthly),
    etsyRevenue: num(row.etsy_revenue_usd),
    etsyOrders: row.etsy_orders ?? null,
    etsyAdClicks: row.etsy_ad_clicks ?? null,
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
    deletedAt: row.deleted_at ?? "",
  };
}

const money = (value: number | null) => (value === null ? "" : value.toFixed(2));
const count = (value: number | null) => (value === null ? "" : value);

export const EXPORT_COLUMNS: ExportColumn[] = [
  { label: "Entry ID", value: (r) => r.id },
  { label: "Company", value: (r) => r.companyName },
  { label: "Store", value: (r) => r.storeName },
  { label: "Marketplace / Country", value: (r) => r.country },
  { label: "Date", value: (r) => r.date },
  { label: "Budget (USD)", value: (r) => money(r.budget) },
  { label: "Spend (USD)", value: (r) => money(r.spend) },
  { label: "Ad Orders", value: (r) => count(r.adOrders) },
  { label: "Impressions / Views", value: (r) => count(r.impressions) },
  { label: "Clicks", value: (r) => count(r.clicks) },
  { label: "CTR %", value: (r) => money(r.ctr) },
  { label: "Visits", value: (r) => count(r.visits) },
  { label: "Ad Revenue (USD)", value: (r) => money(r.adRevenue) },
  { label: "Etsy Visits (daily)", value: (r) => count(r.etsyVisitsDaily) },
  { label: "Etsy Visits (monthly)", value: (r) => count(r.etsyVisitsMonthly) },
  { label: "Etsy Conversion % (monthly)", value: (r) => money(r.etsyConversionRate) },
  { label: "Etsy Revenue (USD, monthly)", value: (r) => money(r.etsyRevenue) },
  { label: "Etsy Orders (monthly)", value: (r) => count(r.etsyOrders) },
  { label: "Etsy Ads Clicks", value: (r) => count(r.etsyAdClicks) },
  { label: "Created", value: (r) => r.createdAt },
  { label: "Last Updated", value: (r) => r.updatedAt },
  { label: "Deleted", value: (r) => r.deletedAt },
];
