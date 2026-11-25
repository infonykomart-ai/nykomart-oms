"use client";

// Daily entry — Budget (USD) + Spend (USD) per store per day, plus the
// marketplace channel numbers for that store type.
//
// 2026-11-25 — CREATE vs EDIT are separate now.
//   • New entry: Save. If that store+date(+country) already has a row the
//     action refuses and names the existing figures (no silent overwrite, no
//     duplicate row) — the Edit button on that row is the way to change it.
//   • Edit: the row's own values load into the same form, the button becomes
//     "Update", and Cancel Edit leaves the row untouched.
//   • Delete asks first, names the exact entry, and is a soft delete: an
//     admin can restore it from the panel at the bottom.
//   • Recent Entries now filters (store/date range/search), pages, and its
//     filters drive the CSV / Excel export links, so the file matches the
//     list on screen.
//
// 2026-10-15 — "AMAZON ME ALAG ALAG COUNTRY KE HISAB SE BUDGT & SPEND HOTA
// HAI": picking an Amazon store reveals a required Country field (the 12
// marketplace countries from amazon-countries.ts), and the same day can
// then hold one row per country. Non-Amazon stores (Etsy / eBay / Website)
// never see the field — their single row per day is unchanged.
//
// 2026-11-21 — channel metrics per store type, as requested:
//   AMAZON clicks + impressions/views + visiting, with CTR = clicks*100/views
//   EBAY   visits + impressions + clicks
//   ETSY   visits daily + monthly, monthly conversion rate, revenue, orders,
//          ads clicks, today's spend, monthly spend % of revenue
// CTR and the Etsy spend % are shown live but never typed or stored.

import { useActionState, useState, useTransition, type ReactNode } from "react";
import {
  saveAdSpendAction,
  updateAdSpendEntryAction,
  deleteAdSpendAction,
  restoreAdSpendEntryAction,
  type AdSpendFormState,
} from "./actions";
import { AMAZON_COUNTRIES, amazonCountryLabel, isAmazonStore } from "./amazon-countries";
import { formatIST } from "@/lib/format-ist";
import { ChannelChart } from "./ad-spend-chart";
import type { DailyAdSpendRow } from "./daily-ad-report";
import { ctrPct, monthSpendFor, monthlySpendPct, storeChannel } from "./channel-metrics";

const initialState: AdSpendFormState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

type Company = { id: string; name: string };
type Store = { id: string; name: string; company_id: string };
export type RecentEntry = {
  id: string;
  storeId: string;
  storeName: string;
  companyName: string;
  date: string;
  countryCode: string;
  budget: number;
  spend: number;
  /** Ad-platform attributed orders for that day, null when not recorded. */
  adOrders: number | null;
  /** 2026-11-21 — channel metrics (null = not recorded). */
  clicks: number | null;
  impressions: number | null;
  visits: number | null;
  etsyVisitsDaily: number | null;
  etsyVisitsMonthly: number | null;
  etsyConversionRateMonthly: number | null;
  etsyRevenueUsd: number | null;
  etsyOrders: number | null;
  etsyAdClicks: number | null;
  /** Ad platform's own daily revenue (Amazon / eBay), null = not recorded. */
  adRevenueUsd: number | null;
  /** First saved (store_ad_spend.created_at) and last changed (updated_at). */
  enteredAt: string;
  created: string;
  updated: string;
};

export type EntryFilters = { storeId: string; from: string; to: string; q: string };

/** The channel block's controlled inputs, kept as strings so a blank box
 *  stays blank ("not recorded") instead of becoming 0. */
type MetricForm = {
  clicks: string;
  impressions: string;
  visits: string;
  ad_revenue_usd: string;
  etsy_visits_daily: string;
  etsy_visits_monthly: string;
  etsy_conversion_rate_monthly: string;
  etsy_revenue_usd: string;
  etsy_orders: string;
  etsy_ad_clicks: string;
};

const EMPTY_METRIC_FORM: MetricForm = {
  clicks: "",
  impressions: "",
  visits: "",
  ad_revenue_usd: "",
  etsy_visits_daily: "",
  etsy_visits_monthly: "",
  etsy_conversion_rate_monthly: "",
  etsy_revenue_usd: "",
  etsy_orders: "",
  etsy_ad_clicks: "",
};

const asText = (value: number | null) => (value === null ? "" : String(value));

export function AdSpendEntrySection({
  companies,
  stores,
  recentEntries,
  channelRows,
  month,
  filters,
  total,
  page,
  pageSize,
  canRestore,
  deletedEntries,
}: {
  companies: Company[];
  stores: Store[];
  recentEntries: RecentEntry[];
  /** The login's stored ad rows — feeds the trend chart (it slices its own
   *  14 days) and the Etsy monthly spend % tile. The 30-day advertisement
   *  report now has its own tab (daily-ad-report-table.tsx). */
  channelRows: DailyAdSpendRow[];
  /** YYYY-MM used by the Etsy monthly spend % tile. */
  month: string;
  /** Store / date range / search currently applied to Recent Entries. */
  filters: EntryFilters;
  total: number;
  page: number;
  pageSize: number;
  canRestore: boolean;
  deletedEntries: RecentEntry[];
}) {
  const [saveState, saveAction, savePending] = useActionState(saveAdSpendAction, initialState);
  // Update is driven by hand rather than useActionState: leaving Edit mode is
  // a consequence of the result, and doing that in an effect would cascade
  // renders (the react-hooks rule this file's lint enforces).
  const [updateState, setUpdateState] = useState<AdSpendFormState>(initialState);
  const [updatePending, startUpdate] = useTransition();
  const pending = savePending || updatePending;

  // 2026-08-08: default to a company that actually has a store this
  // employee can enter for (relevant once ad-spend is scoped to a store-
  // restricted login — see page.tsx's canSeeAllStores) rather than always
  // picking companies[0], which could have zero stores in `stores` for a
  // scoped user and leave the Store dropdown looking empty on first load.
  const [companyId, setCompanyId] = useState(stores[0]?.company_id ?? companies[0]?.id ?? "");
  const [formKey, setFormKey] = useState(0); // bump to reset the form after a successful save
  // The Store select stays uncontrolled (it resets with the form), but the
  // chosen id is mirrored here purely so the Amazon-only Country field can
  // appear/disappear as the store changes.
  const [storeId, setStoreId] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [metrics, setMetrics] = useState<MetricForm>(EMPTY_METRIC_FORM);
  /** The row being edited, null while entering a new day. */
  const [editing, setEditing] = useState<RecentEntry | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  /** Update's own error/success wins while a row is being edited. */
  const state = editing ? updateState : saveState;

  const companyStores = stores.filter((s) => s.company_id === companyId);
  const selectedStore = stores.find((s) => s.id === storeId);
  const isAmazon = isAmazonStore(selectedStore?.name);
  const channel = storeChannel(selectedStore?.name);
  // Recent entries remember the store they were entered for, so a day with
  // several Amazon country rows shows which is which.
  const storeIsAmazon = new Map(stores.map((s) => [s.id, isAmazonStore(s.name)]));

  const setMetric = (key: keyof MetricForm, value: string) =>
    setMetrics((prev) => ({ ...prev, [key]: value }));

  function metricField(key: keyof MetricForm, label: string, step = "1", hint?: string) {
    return (
      <div>
        <label className={labelClass} htmlFor={`as_${key}`}>{label}</label>
        <input
          id={`as_${key}`}
          name={key}
          type="number"
          step={step}
          min="0"
          value={metrics[key]}
          onChange={(e) => setMetric(key, e.target.value)}
          placeholder="—"
          className={inputClass}
        />
        {hint && <p className="mt-0.5 text-[10px] text-slate-400">{hint}</p>}
      </div>
    );
  }

  function startEdit(entry: RecentEntry) {
    setEditing(entry);
    setDeleteError(null);
    setUpdateState(initialState);
    setCompanyId(stores.find((s) => s.id === entry.storeId)?.company_id ?? companyId);
    setStoreId(entry.storeId);
    setCountryCode(entry.countryCode);
    setMetrics({
      clicks: asText(entry.clicks),
      impressions: asText(entry.impressions),
      visits: asText(entry.visits),
      ad_revenue_usd: asText(entry.adRevenueUsd),
      etsy_visits_daily: asText(entry.etsyVisitsDaily),
      etsy_visits_monthly: asText(entry.etsyVisitsMonthly),
      etsy_conversion_rate_monthly: asText(entry.etsyConversionRateMonthly),
      etsy_revenue_usd: asText(entry.etsyRevenueUsd),
      etsy_orders: asText(entry.etsyOrders),
      etsy_ad_clicks: asText(entry.etsyAdClicks),
    });
    setFormKey((k) => k + 1);
    if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function cancelEdit() {
    setEditing(null);
    setUpdateState(initialState);
    setMetrics(EMPTY_METRIC_FORM);
    setFormKey((k) => k + 1);
  }

  const ctr = ctrPct(Number(metrics.clicks || 0), Number(metrics.impressions || 0));
  const etsySpendPct = monthlySpendPct(
    monthSpendFor(channelRows, storeId, month),
    Number(metrics.etsy_revenue_usd || 0)
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className={`rounded-xl border bg-white p-4 ${editing ? "border-amber-400 ring-1 ring-amber-200" : "border-slate-200"}`}>
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">
              {editing ? "Edit entry" : "Enter Budget / Spend"}
            </h2>
            {editing && (
              <span className="rounded bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                {editing.storeName} · {editing.date}
                {editing.countryCode ? ` · ${amazonCountryLabel(editing.countryCode) || editing.countryCode}` : ""}
              </span>
            )}
          </div>
          {state.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
          {!editing && saveState.success && (
            <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">Saved.</p>
          )}
          {editing && updateState.success && (
            <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">Entry updated.</p>
          )}
          <form
            key={editing ? `edit-${editing.id}-${formKey}` : `new-${formKey}`}
            action={(fd) => {
              if (editing) {
                startUpdate(async () => {
                  const result = await updateAdSpendEntryAction(initialState, fd);
                  setUpdateState(result);
                  if (result.success) {
                    setEditing(null);
                    setMetrics(EMPTY_METRIC_FORM);
                    setFormKey((k) => k + 1);
                  }
                });
              } else {
                saveAction(fd);
                setFormKey((k) => k + 1);
                setMetrics(EMPTY_METRIC_FORM);
              }
            }}
            className="space-y-3"
          >
            {editing && <input type="hidden" name="entry_id" value={editing.id} />}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass} htmlFor="as_company">Company *</label>
                <select
                  id="as_company"
                  value={companyId}
                  onChange={(e) => {
                    setCompanyId(e.target.value);
                    setStoreId("");
                    setMetrics(EMPTY_METRIC_FORM);
                  }}
                  className={inputClass}
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="as_store">Store *</label>
                {/* Controlled (value={storeId}) on purpose: the form itself
                    is re-mounted after each save so Budget/Spend/Date reset,
                    but the chosen Store/Country stay put — otherwise an
                    Amazon day would mean re-picking the store 12 times, once
                    per country. */}
                <select
                  id="as_store"
                  name="store_id"
                  required
                  value={storeId}
                  onChange={(e) => {
                    setStoreId(e.target.value);
                    setCountryCode("");
                    setMetrics(EMPTY_METRIC_FORM);
                  }}
                  className={inputClass}
                >
                  <option value="" disabled>Select store</option>
                  {companyStores.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass} htmlFor="as_date">Date *</label>
                <input
                  id="as_date"
                  name="spend_date"
                  type="date"
                  required
                  defaultValue={editing?.date ?? new Date().toISOString().slice(0, 10)}
                  className={inputClass}
                />
              </div>
              {/* 2026-10-15 — Amazon-only Country. Rendered (and required)
                  only when the selected store is an Amazon store; the action
                  enforces the same rule server-side. */}
              {isAmazon ? (
                <div>
                  <label className={labelClass} htmlFor="as_country">Country * (Amazon)</label>
                  <select
                    id="as_country"
                    name="country_code"
                    required
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className={inputClass}
                  >
                    <option value="" disabled>Select country</option>
                    {AMAZON_COUNTRIES.map((c) => (
                      <option key={c.code} value={c.code}>{c.label} · {c.currency}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div />
              )}
              <div>
                <label className={labelClass} htmlFor="as_budget">
                  {channel === "etsy" ? "Monthly budget (USD)" : "Budget (USD)"}
                </label>
                <input
                  id="as_budget"
                  name="budget_usd"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editing ? editing.budget.toFixed(2) : "0"}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="as_spend">
                  {channel === "etsy" ? "Today's spend (USD)" : "Spend (USD)"}
                </label>
                <input
                  id="as_spend"
                  name="spend_usd"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={editing ? editing.spend.toFixed(2) : "0"}
                  className={inputClass}
                />
              </div>
              {/* 2026-11-20 — optional: the ad platform's own attributed-order
                  count, which is the only honest source for the report's
                  ad-vs-organic split (the orders table has no ad flag). */}
              <div className="col-span-2">
                <label className={labelClass} htmlFor="as_ad_orders">Ad orders — from the ad platform (optional)</label>
                <input
                  id="as_ad_orders"
                  name="ad_orders"
                  type="number"
                  step="1"
                  min="0"
                  defaultValue={editing?.adOrders ?? ""}
                  placeholder="e.g. 12 — leave blank if not recorded"
                  className={inputClass}
                />
              </div>
            </div>

            {/* 2026-11-21 — the selected store's own marketplace metrics. */}
            {channel === "amazon" && (
              <fieldset className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                <legend className="px-1 text-xs font-semibold text-amber-800">Amazon — daily ad metrics</legend>
                <div className="grid grid-cols-2 gap-3">
                  {metricField("clicks", "Clicks")}
                  {metricField("impressions", "Impressions / Views")}
                  {metricField("visits", "Visiting")}
                  {metricField("ad_revenue_usd", "Ad revenue (USD)", "0.01", "ROAS / ACoS is calculated from this.")}
                  <div className="rounded-lg border border-amber-200 bg-white px-3 py-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">CTR %</div>
                    <div className="text-sm font-bold text-slate-900">{ctr.toFixed(2)}%</div>
                    <p className="text-[10px] text-slate-400">= Clicks × 100 ÷ Impressions (0 when views = 0)</p>
                  </div>
                </div>
              </fieldset>
            )}

            {channel === "ebay" && (
              <fieldset className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                <legend className="px-1 text-xs font-semibold text-amber-800">eBay — daily metrics</legend>
                <div className="grid grid-cols-2 gap-3">
                  {metricField("visits", "Visits")}
                  {metricField("impressions", "Impressions")}
                  {metricField("clicks", "Clicks")}
                  {metricField("ad_revenue_usd", "Ad revenue (USD)", "0.01", "ROAS / ACoS is calculated from this.")}
                  <div className="rounded-lg border border-amber-200 bg-white px-3 py-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">CTR %</div>
                    <div className="text-sm font-bold text-slate-900">{ctr.toFixed(2)}%</div>
                    <p className="text-[10px] text-slate-400">= Clicks × 100 ÷ Impressions</p>
                  </div>
                </div>
              </fieldset>
            )}

            {channel === "etsy" && (
              <fieldset className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
                <legend className="px-1 text-xs font-semibold text-amber-800">Etsy — metrics</legend>
                <div className="grid grid-cols-2 gap-3">
                  {metricField("etsy_visits_daily", "Visits (daily)")}
                  {metricField("etsy_visits_monthly", "Visits (monthly)")}
                  {metricField("etsy_conversion_rate_monthly", "Conversion rate (monthly, %)", "0.01")}
                  {metricField("etsy_revenue_usd", "Revenue (USD, monthly)", "0.01")}
                  {metricField("etsy_orders", "Orders (monthly)")}
                  {metricField("etsy_ad_clicks", "Ads clicks")}
                  <div className="col-span-2 rounded-lg border border-amber-200 bg-white px-3 py-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Monthly spend % based on revenue
                    </div>
                    <div className="text-sm font-bold text-slate-900">
                      {etsySpendPct === null ? "— (enter monthly revenue)" : `${etsySpendPct.toFixed(1)}%`}
                    </div>
                  </div>
                </div>
              </fieldset>
            )}

            <div className="flex gap-2">
              <button
                type="submit"
                disabled={pending}
                className="flex-1 rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {pending ? "Saving..." : editing ? "Update" : "Save"}
              </button>
              {editing && (
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={pending}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancel Edit
                </button>
              )}
            </div>
          </form>
        </div>

        <RecentEntries
          entries={recentEntries}
          storeIsAmazon={storeIsAmazon}
          stores={stores}
          filters={filters}
          total={total}
          page={page}
          pageSize={pageSize}
          editingId={editing?.id ?? null}
          onEdit={startEdit}
          deleteError={deleteError}
          setDeleteError={setDeleteError}
        />
      </div>

      {storeId && (
        <ChannelChart
          storeId={storeId}
          storeName={selectedStore?.name ?? ""}
          channel={channel}
          month={month}
          rows={channelRows}
        />
      )}

      {canRestore && deletedEntries.length > 0 && <DeletedEntries entries={deletedEntries} />}
    </div>
  );
}

/** Short metric summary for a Recent Entry row — only the numbers that were
 *  actually recorded, so a blank stays blank. */
function metricSummary(e: RecentEntry): string[] {
  const parts: string[] = [];
  if (e.clicks !== null) parts.push(`${e.clicks} clicks`);
  if (e.impressions !== null) parts.push(`${e.impressions} views`);
  if (e.visits !== null) parts.push(`${e.visits} visits`);
  if (e.adRevenueUsd !== null) parts.push(`$${e.adRevenueUsd.toFixed(2)} ad revenue`);
  if (e.clicks !== null && e.impressions !== null) parts.push(`CTR ${ctrPct(e.clicks, e.impressions).toFixed(2)}%`);
  if (e.etsyVisitsDaily !== null) parts.push(`${e.etsyVisitsDaily} visits/day`);
  if (e.etsyVisitsMonthly !== null) parts.push(`${e.etsyVisitsMonthly} visits/mo`);
  if (e.etsyConversionRateMonthly !== null) parts.push(`${e.etsyConversionRateMonthly}% conv.`);
  if (e.etsyRevenueUsd !== null) parts.push(`$${e.etsyRevenueUsd.toFixed(2)} revenue`);
  if (e.etsyOrders !== null) parts.push(`${e.etsyOrders} orders`);
  if (e.etsyAdClicks !== null) parts.push(`${e.etsyAdClicks} ad clicks`);
  return parts;
}

function FilterField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function RecentEntries({
  entries,
  storeIsAmazon,
  stores,
  filters,
  total,
  page,
  pageSize,
  editingId,
  onEdit,
  deleteError,
  setDeleteError,
}: {
  entries: RecentEntry[];
  storeIsAmazon: Map<string, boolean>;
  stores: Store[];
  filters: EntryFilters;
  total: number;
  page: number;
  pageSize: number;
  editingId: string | null;
  onEdit: (entry: RecentEntry) => void;
  deleteError: string | null;
  setDeleteError: (message: string | null) => void;
}) {
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  // 2026-11-25 — ticked rows for "Export selected". Kept per page render:
  // navigation re-fetches the list, and a stale tick from another page would
  // be a selection the user can no longer see.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  function handleDelete(entry: RecentEntry, label: string) {
    if (!window.confirm(`Delete the entry for ${label}? It will be removed from every report and can be restored by an admin.`)) {
      return;
    }
    setDeleteError(null);
    startTransition(async () => {
      const result = await deleteAdSpendAction(entry.id);
      if (result.error) setDeleteError(result.error);
      else setDeletedIds((prev) => new Set(prev).add(entry.id));
    });
  }

  const visible = entries.filter((e) => !deletedIds.has(e.id));
  const selectedOnPage = visible.filter((e) => selectedIds.has(e.id)).length;
  const allSelected = visible.length > 0 && selectedOnPage === visible.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = Math.min(total, (page - 1) * pageSize + visible.length);

  // One filter query for pagination links and both export buttons, so the
  // file always matches the rows on screen.
  const filterQuery = () => {
    const qs = new URLSearchParams({ tab: "entry" });
    if (filters.storeId) qs.set("store", filters.storeId);
    if (filters.from) qs.set("from", filters.from);
    if (filters.to) qs.set("to", filters.to);
    if (filters.q) qs.set("q", filters.q);
    return qs;
  };
  const pageHref = (target: number) => {
    const qs = filterQuery();
    qs.set("page", String(target));
    return `/dashboard/ad-spend?${qs.toString()}`;
  };
  const exportHref = (format: "csv" | "xlsx", ids?: string[]) => {
    const qs = filterQuery();
    qs.delete("tab");
    if (ids && ids.length > 0) qs.set("ids", ids.join(","));
    qs.set("format", format);
    return `/api/ad-spend/export?${qs.toString()}`;
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-700">Recent Entries</h2>
        <span className="text-[11px] text-slate-400">
          {total === 0 ? "No matching entries" : `${firstRow}–${lastRow} of ${total}`}
        </span>
      </div>

      {/* Filters are a plain GET form: the URL is the single source of truth,
          so the same filters survive a reload and feed the export links. */}
      <form method="get" action="/dashboard/ad-spend" className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <input type="hidden" name="tab" value="entry" />
        <FilterField label="Store">
          <select name="store" defaultValue={filters.storeId} className={inputClass}>
            <option value="">All stores</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </FilterField>
        <FilterField label="From">
          <input type="date" name="from" defaultValue={filters.from} className={inputClass} />
        </FilterField>
        <FilterField label="To">
          <input type="date" name="to" defaultValue={filters.to} className={inputClass} />
        </FilterField>
        <FilterField label="Search">
          <input
            type="search"
            name="q"
            defaultValue={filters.q}
            placeholder="Store or 2026-11"
            className={inputClass}
          />
        </FilterField>
        <div className="col-span-2 flex flex-wrap gap-2 sm:col-span-4">
          <button type="submit" className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800">
            Apply
          </button>
          <a
            href="/dashboard/ad-spend?tab=entry"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Clear
          </a>
          <span className="ml-auto flex gap-2">
            <a
              href={exportHref("xlsx")}
              className="rounded-lg border border-green-300 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-800 hover:bg-green-100"
            >
              ⬇ Excel (.xlsx)
            </a>
            <a
              href={exportHref("csv")}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              ⬇ CSV
            </a>
          </span>
        </div>
      </form>

      {deleteError && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{deleteError}</p>}

      {selectedIds.size > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <span className="font-semibold">{selectedIds.size} selected</span>
          <a
            href={exportHref("xlsx", [...selectedIds])}
            className="rounded border border-green-300 bg-white px-2 py-1 font-medium text-green-800 hover:bg-green-100"
          >
            ⬇ Export selected (.xlsx)
          </a>
          <a
            href={exportHref("csv", [...selectedIds])}
            className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-50"
          >
            ⬇ Export selected (CSV)
          </a>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="ml-auto rounded px-2 py-1 font-medium text-emerald-800 underline-offset-2 hover:underline"
          >
            Clear selection
          </button>
        </div>
      )}

      <label className="mb-1.5 flex items-center gap-2 text-[11px] text-slate-500">
        <input
          type="checkbox"
          checked={allSelected}
          onChange={() =>
            setSelectedIds(allSelected ? new Set() : new Set(visible.map((e) => e.id)))
          }
          aria-label="Select every entry on this page"
        />
        Select all on this page ({visible.length})
      </label>

      <div className="max-h-[36rem] space-y-1.5 overflow-y-auto">
        {visible.map((e) => {
          // Older rows (and every non-Amazon store) carry no country.
          const country = e.countryCode ? (amazonCountryLabel(e.countryCode) || e.countryCode) : "";
          const isAmazon = storeIsAmazon.get(e.storeId) ?? /amazon/i.test(e.storeName);
          const metricsText = metricSummary(e);
          const edited = e.updated && e.created && e.updated !== e.created;
          return (
            <div
              key={e.id}
              className={`rounded-lg border px-3 py-2 text-xs ${
                editingId === e.id ? "border-amber-400 bg-amber-50/40" : "border-slate-200"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selectedIds.has(e.id)}
                    onChange={() => toggleSelected(e.id)}
                    aria-label={`Select ${e.storeName} ${e.date}`}
                  />
                  <div>
                    <div className="font-medium text-slate-900">{e.storeName}</div>
                    <div className="text-slate-400">
                      {e.companyName} · {e.date}
                      {country && <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">{country}</span>}
                      {isAmazon && !country && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">no country</span>}
                    </div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-slate-700">Budget ${e.budget.toFixed(2)}</div>
                  <div className="text-slate-700">Spend ${e.spend.toFixed(2)}</div>
                  {e.adOrders !== null && <div className="text-slate-500">{e.adOrders} ad order(s)</div>}
                </div>
              </div>
              {metricsText.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {metricsText.map((m) => (
                    <span key={m} className="rounded bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-600 ring-1 ring-slate-200">{m}</span>
                  ))}
                </div>
              )}
              <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
                <p className="text-[10px] text-slate-400">
                  Entered {e.created ? formatIST(e.created) : formatIST(e.enteredAt)}
                  {edited && <span className="ml-1 text-slate-400">· edited {formatIST(e.updated)}</span>}
                </p>
                <div className="ml-auto flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => onEdit(e)}
                    className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleDelete(e, `${e.storeName}${country ? ` · ${country}` : ""} · ${e.date}`)}
                    className="rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          );
        })}
        {visible.length === 0 && <p className="text-xs text-slate-400">No entries match these filters.</p>}
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 pt-2 text-xs">
          {page > 1 ? (
            <a href={pageHref(page - 1)} className="rounded border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50">
              ← Previous
            </a>
          ) : (
            <span className="px-2 py-1 text-slate-300">← Previous</span>
          )}
          <span className="text-slate-500">Page {page} of {pages}</span>
          {page < pages ? (
            <a href={pageHref(page + 1)} className="rounded border border-slate-300 px-2 py-1 font-medium text-slate-700 hover:bg-slate-50">
              Next →
            </a>
          ) : (
            <span className="px-2 py-1 text-slate-300">Next →</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Admin-only: recently deleted entries, restorable as they were. */
function DeletedEntries({ entries }: { entries: RecentEntry[] }) {
  const [restored, setRestored] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Deleted entries (admin)</h2>
      <p className="mb-2 text-[11px] text-slate-400">
        Deleted entries stay out of every report and export until restored here.
      </p>
      {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}
      <div className="space-y-1.5">
        {entries
          .filter((e) => !restored.has(e.id))
          .map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs">
              <div>
                <div className="text-slate-700">
                  {e.storeName} · {e.date}
                  {e.countryCode ? ` · ${amazonCountryLabel(e.countryCode) || e.countryCode}` : ""}
                </div>
                <div className="text-[10px] text-slate-400">
                  Budget ${e.budget.toFixed(2)} · Spend ${e.spend.toFixed(2)}
                  {e.updated ? ` · deleted ${formatIST(e.updated)}` : ""}
                </div>
              </div>
              <button
                type="button"
                disabled={isPending}
                onClick={() => {
                  setError(null);
                  startTransition(async () => {
                    const result = await restoreAdSpendEntryAction(e.id);
                    if (result.error) setError(result.error);
                    else setRestored((prev) => new Set(prev).add(e.id));
                  });
                }}
                className="shrink-0 rounded border border-green-300 bg-green-50 px-2 py-0.5 font-medium text-green-800 hover:bg-green-100 disabled:opacity-50"
              >
                Restore
              </button>
            </div>
          ))}
      </div>
    </div>
  );
}
