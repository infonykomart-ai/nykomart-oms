"use client";

import { useActionState, useState, useTransition } from "react";
import { saveAdSpendAction, deleteAdSpendAction, type AdSpendFormState } from "./actions";
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
type RecentEntry = {
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
  /** When these numbers were last saved (store_ad_spend.updated_at). */
  enteredAt: string;
};

/** The channel block's controlled inputs, kept as strings so a blank box
 *  stays blank ("not recorded") instead of becoming 0. */
type MetricForm = {
  clicks: string;
  impressions: string;
  visits: string;
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
  etsy_visits_daily: "",
  etsy_visits_monthly: "",
  etsy_conversion_rate_monthly: "",
  etsy_revenue_usd: "",
  etsy_orders: "",
  etsy_ad_clicks: "",
};

// Daily entry — Budget (USD) + Spend (USD) per store per day, plus the
// marketplace channel numbers for that store type.
// Re-submitting the same store+date overwrites that day's numbers (see
// saveAdSpendAction's upsert), so this doubles as the "edit" screen: pick
// the same store/date again, type the corrected numbers, save. The list on
// the right (last 30 entries across all stores) is there so a mistake is
// visible without having to remember which store/date it was on, and can
// be cleared outright via Delete.
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
export function AdSpendEntrySection({
  companies,
  stores,
  recentEntries,
  channelRows,
  month,
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
}) {
  const [state, formAction, pending] = useActionState(saveAdSpendAction, initialState);
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

  const ctr = ctrPct(Number(metrics.clicks || 0), Number(metrics.impressions || 0));
  const etsySpendPct = monthlySpendPct(
    monthSpendFor(channelRows, storeId, month),
    Number(metrics.etsy_revenue_usd || 0)
  );

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Enter Budget / Spend</h2>
          {state.error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
          {state.success && <p className="mb-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">Saved.</p>}
          <form
            key={formKey}
            action={(fd) => {
              formAction(fd);
              setFormKey((k) => k + 1);
              setMetrics(EMPTY_METRIC_FORM);
            }}
            className="space-y-3"
          >
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
                  defaultValue={new Date().toISOString().slice(0, 10)}
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
                <input id="as_budget" name="budget_usd" type="number" step="0.01" min="0" defaultValue="0" className={inputClass} />
              </div>
              <div>
                <label className={labelClass} htmlFor="as_spend">
                  {channel === "etsy" ? "Today's spend (USD)" : "Spend (USD)"}
                </label>
                <input id="as_spend" name="spend_usd" type="number" step="0.01" min="0" defaultValue="0" className={inputClass} />
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
                  placeholder="e.g. 12 — leave blank if not recorded"
                  className={inputClass}
                />
                <p className="mt-1 text-[10px] text-slate-400">
                  Blank = not recorded. Enter 0 when the spend ran but no order was attributed to it. The Report tab uses this to separate ad orders from organic ones.
                </p>
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
                    <p className="text-[10px] text-slate-400">
                      This month&apos;s spend ÷ revenue × 100 — calculated automatically, never typed.
                    </p>
                  </div>
                </div>
              </fieldset>
            )}

            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
            >
              {pending ? "Saving..." : "Save"}
            </button>
          </form>
          <p className="mt-3 text-xs text-slate-400">
            {isAmazon
              ? "Amazon store — enter one row per marketplace country (US, UK, Germany …). The store and country stay selected after Save so you can go country by country; re-saving the same store + date + country overwrites that day's numbers."
              : channel === "etsy"
                ? "Etsy store — visits, conversion rate, revenue, orders and ads clicks are the Etsy Stats figures; leave a box blank when it was not recorded."
                : channel === "ebay"
                  ? "eBay store — visits, impressions and clicks for the day; leave a box blank when it was not recorded."
                  : "Pick an Amazon, Etsy or eBay store to get its channel metrics block — other stores keep just Budget/Spend."}
            {" "}QTY ORD / USD are not entered here — see the <strong>Report</strong> tab for the combined view against live
            Order Entry data.
          </p>
        </div>

        <RecentEntries entries={recentEntries} storeIsAmazon={storeIsAmazon} />
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
  if (e.clicks !== null && e.impressions !== null) parts.push(`CTR ${ctrPct(e.clicks, e.impressions).toFixed(2)}%`);
  if (e.etsyVisitsDaily !== null) parts.push(`${e.etsyVisitsDaily} visits/day`);
  if (e.etsyVisitsMonthly !== null) parts.push(`${e.etsyVisitsMonthly} visits/mo`);
  if (e.etsyConversionRateMonthly !== null) parts.push(`${e.etsyConversionRateMonthly}% conv.`);
  if (e.etsyRevenueUsd !== null) parts.push(`$${e.etsyRevenueUsd.toFixed(2)} revenue`);
  if (e.etsyOrders !== null) parts.push(`${e.etsyOrders} orders`);
  if (e.etsyAdClicks !== null) parts.push(`${e.etsyAdClicks} ad clicks`);
  return parts;
}

function RecentEntries({
  entries,
  storeIsAmazon,
}: {
  entries: RecentEntry[];
  storeIsAmazon: Map<string, boolean>;
}) {
  const [deleteError, setDeleteError] = useState<Record<string, string>>({});
  const [deletedIds, setDeletedIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  function handleDelete(id: string, label: string) {
    if (!window.confirm(`Delete the entry for ${label}?`)) return;
    setDeleteError((prev) => ({ ...prev, [id]: "" }));
    startTransition(async () => {
      const result = await deleteAdSpendAction(id);
      if (result.error) setDeleteError((prev) => ({ ...prev, [id]: result.error! }));
      else setDeletedIds((prev) => new Set(prev).add(id));
    });
  }

  const visible = entries.filter((e) => !deletedIds.has(e.id));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-slate-700">Recent Entries</h2>
      <div className="max-h-[36rem] space-y-1.5 overflow-y-auto">
        {visible.map((e) => {
          // Older rows (and every non-Amazon store) carry no country.
          const country = e.countryCode ? (amazonCountryLabel(e.countryCode) || e.countryCode) : "";
          const isAmazon = storeIsAmazon.get(e.storeId) ?? /amazon/i.test(e.storeName);
          const metricsText = metricSummary(e);
          return (
            <div key={e.id} className="rounded-lg border border-slate-200 px-3 py-2 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-medium text-slate-900">{e.storeName}</div>
                  <div className="text-slate-400">
                    {e.companyName} · {e.date}
                    {country && <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-700">{country}</span>}
                    {isAmazon && !country && <span className="ml-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">no country</span>}
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
                {/* 2026-10-19 — when the entry was made (IST), not just the
                    spend date: re-saving the same store+date+country
                    overwrites the row, so this is the last entry time. */}
                <p className="text-[10px] text-slate-400">Entered {formatIST(e.enteredAt)}</p>
                <p className="ml-auto text-red-600">{deleteError[e.id]}</p>
                <button
                  type="button"
                  disabled={isPending}
                  onClick={() => handleDelete(e.id, `${e.storeName}${country ? ` · ${country}` : ""} · ${e.date}`)}
                  className="shrink-0 rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
        {visible.length === 0 && <p className="text-xs text-slate-400">No entries yet.</p>}
      </div>
    </div>
  );
}
