// 2026-11-21 — Marketplace channel metrics for the Store Ad Spend Daily
// Entry (Amazon / eBay / Etsy). Pure functions only: the entry form, the
// save action and the chart all call these, so what is typed, what is saved
// and what is drawn can never disagree.
//
// The user's list, implemented exactly:
//   AMAZON  clicks (manual), impressions (manual), CTR = IF(VIEW=0,0,
//           CLICKS*100/VIEW), visiting (manual). The impression figure is
//           also the formula's VIEW — the two names in the request describe
//           the same "how many times the ad was seen" number, so the field
//           is labelled "Impressions / Views" and CTR derives from it.
//   EBAY    visits, impressions, clicks.
//   ETSY    visits daily + monthly, monthly conversion rate, revenue,
//           orders, ads clicks, today's spend, and the monthly spend
//           percentage based on revenue.
//
// CTR and the Etsy monthly spend % are NEVER stored — both are computed from
// the stored inputs here, so a corrected input immediately corrects the
// derived figure everywhere (form preview, chart, report).

export type StoreChannel = "amazon" | "etsy" | "ebay" | "other";

/** Which metric block a store gets. Same name matching the rest of the
 *  module already uses (storeMarketplace() in ad-spend-stats.ts). */
export function storeChannel(storeName: string | null | undefined): StoreChannel {
  const name = storeName ?? "";
  if (/amazon/i.test(name)) return "amazon";
  if (/etsy/i.test(name)) return "etsy";
  if (/ebay/i.test(name)) return "ebay";
  return "other";
}

/** One day's typed channel metrics (already parsed; null = not recorded). */
export type ChannelMetrics = {
  clicks: number | null;
  impressions: number | null;
  visits: number | null;
  /** 2026-11-21 (round 2) — the ad platform's own daily revenue, so the
   *  report can show a real ROAS/ACoS for Amazon and eBay instead of 0. */
  ad_revenue_usd: number | null;
  etsy_visits_daily: number | null;
  etsy_visits_monthly: number | null;
  etsy_conversion_rate_monthly: number | null;
  etsy_revenue_usd: number | null;
  etsy_orders: number | null;
  etsy_ad_clicks: number | null;
};

export const EMPTY_CHANNEL_METRICS: ChannelMetrics = {
  clicks: null,
  impressions: null,
  visits: null,
  ad_revenue_usd: null,
  etsy_visits_daily: null,
  etsy_visits_monthly: null,
  etsy_conversion_rate_monthly: null,
  etsy_revenue_usd: null,
  etsy_orders: null,
  etsy_ad_clicks: null,
};

/** The columns each channel's entry block owns. A save only writes those, so
 *  an Amazon entry can never blank an Etsy store's numbers (and vice versa). */
export const CHANNEL_METRIC_KEYS: Record<StoreChannel, (keyof ChannelMetrics)[]> = {
  amazon: ["clicks", "impressions", "visits", "ad_revenue_usd"],
  ebay: ["visits", "impressions", "clicks", "ad_revenue_usd"],
  etsy: [
    "etsy_visits_daily",
    "etsy_visits_monthly",
    "etsy_conversion_rate_monthly",
    "etsy_revenue_usd",
    "etsy_orders",
    "etsy_ad_clicks",
  ],
  other: [],
};

/**
 * Optional number input → number | null, undefined when the text is not a
 * non-negative number. Blank means "not recorded" (null), never 0.
 */
export function parseMetricNumber(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === "") return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

/** CTR% = clicks ÷ impressions × 100, and 0 when there were no impressions
 *  (the request's IF(VIEW=0,0, …)) — never NaN/infinity. */
export function ctrPct(clicks: number | null | undefined, impressions: number | null | undefined): number {
  const c = Number(clicks ?? 0);
  const v = Number(impressions ?? 0);
  if (!Number.isFinite(c) || !Number.isFinite(v) || v <= 0) return 0;
  return (c * 100) / v;
}

/** Etsy monthly spend % based on revenue: month spend ÷ revenue × 100.
 *  null when no revenue was recorded, so "unknown" stays unknown. */
export function monthlySpendPct(monthSpendUsd: number, revenueUsd: number | null | undefined): number | null {
  const revenue = Number(revenueUsd ?? 0);
  if (!Number.isFinite(revenue) || revenue <= 0) return null;
  const spend = Number(monthSpendUsd ?? 0);
  if (!Number.isFinite(spend)) return null;
  return (spend * 100) / revenue;
}

/** A stored spend row, as far as the charts care. */
export type ChannelMetricRow = {
  store_id: string;
  spend_date: string;
  spend_usd?: number | null;
  clicks?: number | null;
  impressions?: number | null;
  visits?: number | null;
  ad_revenue_usd?: number | null;
  etsy_visits_daily?: number | null;
  etsy_visits_monthly?: number | null;
  etsy_revenue_usd?: number | null;
  etsy_ad_clicks?: number | null;
};

/** One chart column for one store/day (Amazon country rows are summed). */
export type ChannelPoint = {
  date: string;
  clicks: number;
  impressions: number;
  visits: number;
  etsyVisitsDaily: number;
  etsyVisitsMonthly: number;
  etsyRevenueUsd: number;
  etsyAdClicks: number;
  spendUsd: number;
  /** Derived CTR% for the day. */
  ctr: number;
};

/** Group a store's rows by date (newest last) into chart points, keeping
 *  only the last `lastNDays` dates. Country rows of one Amazon day sum up. */
export function channelPointsFor(rows: ChannelMetricRow[], storeId: string, lastNDays = 14): ChannelPoint[] {
  const byDate = new Map<string, ChannelPoint>();
  for (const r of rows) {
    if (r.store_id !== storeId) continue;
    const p =
      byDate.get(r.spend_date) ??
      ({
        date: r.spend_date,
        clicks: 0,
        impressions: 0,
        visits: 0,
        etsyVisitsDaily: 0,
        etsyVisitsMonthly: 0,
        etsyRevenueUsd: 0,
        etsyAdClicks: 0,
        spendUsd: 0,
        ctr: 0,
      } satisfies ChannelPoint);
    p.clicks += Number(r.clicks ?? 0);
    p.impressions += Number(r.impressions ?? 0);
    p.visits += Number(r.visits ?? 0);
    p.etsyVisitsDaily += Number(r.etsy_visits_daily ?? 0);
    p.etsyVisitsMonthly += Number(r.etsy_visits_monthly ?? 0);
    p.etsyRevenueUsd += Number(r.etsy_revenue_usd ?? 0);
    p.etsyAdClicks += Number(r.etsy_ad_clicks ?? 0);
    p.spendUsd += Number(r.spend_usd ?? 0);
    byDate.set(r.spend_date, p);
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-Math.max(1, lastNDays))
    .map((p) => ({ ...p, ctr: ctrPct(p.clicks, p.impressions) }));
}

/** Sum a store's spend for one YYYY-MM prefix (month-to-date spend, used by
 *  the Etsy monthly spend %). */
export function monthSpendFor(rows: ChannelMetricRow[], storeId: string, month: string): number {
  return rows
    .filter((r) => r.store_id === storeId && r.spend_date.startsWith(month))
    .reduce((sum, r) => sum + Number(r.spend_usd ?? 0), 0);
}

/** "1.2K" style compact number for the chart labels. */
export function compact(n: number): string {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v)) return "0";
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(Math.round(v));
}
