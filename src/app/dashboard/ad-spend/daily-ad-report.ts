// 2026-11-21 — the user's Amazon / Etsy / eBay advertisement sheet: one row
// per day, per store (Amazon per marketplace country), with the organic sales
// numbers on the left and the ad-platform numbers on the right, exactly like
// the screenshots they shared:
//
//   DATE | TOTAL ORD | TOTAL SPEND | VISIT | ORDER | ORD AMT |
//   VIEWS | CLICKS | CTR | BUDGET | SPEND | REVENUE | AD ORDER
//
// Pure math only, like ad-spend-stats.ts / daily-sheet-stats.ts: page.tsx
// fetches the spend rows + orders, this module decides every number, and the
// table component only renders what it is handed. Organic order counts use
// the same base-PO rule as the Daily Order Sheet (PO-A926-1/2 + -2/2 = ONE
// order), and an order belongs to the day its PO date falls on.
import {
  AMAZON_COUNTRIES,
  amazonCodeForCountryLabel,
  amazonCountryLabel,
  isAmazonStore,
} from "./amazon-countries";
import { basePoKey, canonicalCountry } from "./daily-sheet-stats";
import { ctrPct, type ChannelMetricRow, type StoreChannel } from "./channel-metrics";

/** A stored store_ad_spend row, as far as this report cares. */
export type DailyAdSpendRow = ChannelMetricRow & {
  country_code?: string | null;
  budget_usd?: number | null;
  ad_orders?: number | null;
};

/** One system order line, as far as this report cares. */
export type DailyAdOrderRow = {
  id: string;
  ref_no: string | null;
  store_id: string;
  order_date: string | null;
  po_date: string | null;
  order_value_usd: number | null;
  /** Also on amazon-countries.ts's path — buyer country wins, else destination. */
  buyer_country: string | null;
  destination_country: string | null;
};

export type DailyAdReportRow = {
  date: string;
  /** Organic orders + ad-platform attributed orders. */
  totalOrders: number;
  totalSpendUsd: number;
  visits: number;
  orders: number;
  orderAmountUsd: number;
  views: number;
  clicks: number;
  ctr: number;
  budgetUsd: number;
  spendUsd: number;
  revenueUsd: number;
  adOrders: number;
  /** false for a day with no ad entry and no order — rendered as a 0 row. */
  hasData: boolean;
};

export type DailyAdReportGroup = {
  /** "" = all countries of the store (non-Amazon stores only ever have ""). */
  countryCode: string;
  label: string;
  /** Oldest → newest. */
  rows: DailyAdReportRow[];
  totals: Omit<DailyAdReportRow, "date">;
};

export type DailyAdReportStore = {
  storeId: string;
  storeName: string;
  channel: StoreChannel;
  isAmazon: boolean;
  groups: DailyAdReportGroup[];
};

type SpendAgg = {
  budget: number;
  spend: number;
  clicks: number;
  views: number;
  visits: number;
  etsyVisitsDaily: number;
  revenue: number;
  adOrders: number;
};

type OrderAgg = { poKeys: Set<string>; amount: number };

const emptySpend = (): SpendAgg => ({
  budget: 0,
  spend: 0,
  clicks: 0,
  views: 0,
  visits: 0,
  etsyVisitsDaily: 0,
  revenue: 0,
  adOrders: 0,
});

const emptyOrder = (): OrderAgg => ({ poKeys: new Set<string>(), amount: 0 });

/** Continuous ISO dates ending at `today` (inclusive), oldest first. */
export function isoDaysBack(today: string, days: number): string[] {
  const end = new Date(`${today}T00:00:00Z`);
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/** The day an order belongs to: its PO date, else the order/entry date. */
function effectiveDate(o: DailyAdOrderRow): string {
  return (o.po_date || o.order_date || "").slice(0, 10);
}

/** The Amazon marketplace bucket an order's sales belong to ("" = Other). */
function orderCountryCode(o: DailyAdOrderRow): string {
  return amazonCodeForCountryLabel(canonicalCountry(o.buyer_country || o.destination_country));
}

/** Which manually-entered number is that channel's "visits" column. */
function visitsOf(channel: StoreChannel, agg: SpendAgg): number {
  if (channel === "etsy") return agg.etsyVisitsDaily;
  return agg.visits;
}

function channelOf(storeName: string): StoreChannel {
  if (isAmazonStore(storeName)) return "amazon";
  if (/etsy/i.test(storeName)) return "etsy";
  if (/ebay/i.test(storeName)) return "ebay";
  return "other";
}

function makeRow(date: string, spend: SpendAgg, order: OrderAgg, channel: StoreChannel): DailyAdReportRow {
  const orders = order.poKeys.size;
  const revenue = channel === "etsy" ? spend.revenue : 0;
  return {
    date,
    totalOrders: orders + spend.adOrders,
    totalSpendUsd: spend.spend,
    visits: visitsOf(channel, spend),
    orders,
    orderAmountUsd: order.amount,
    views: spend.views,
    clicks: spend.clicks,
    ctr: ctrPct(spend.clicks, spend.views),
    budgetUsd: spend.budget,
    spendUsd: spend.spend,
    revenueUsd: revenue,
    adOrders: spend.adOrders,
    hasData:
      orders > 0 ||
      order.amount !== 0 ||
      spend.spend !== 0 ||
      spend.budget !== 0 ||
      spend.clicks !== 0 ||
      spend.views !== 0 ||
      visitsOf(channel, spend) !== 0 ||
      spend.adOrders !== 0,
  };
}

function sumRows(rows: DailyAdReportRow[]): Omit<DailyAdReportRow, "date"> {
  const totals = {
    totalOrders: 0,
    totalSpendUsd: 0,
    visits: 0,
    orders: 0,
    orderAmountUsd: 0,
    views: 0,
    clicks: 0,
    ctr: 0,
    budgetUsd: 0,
    spendUsd: 0,
    revenueUsd: 0,
    adOrders: 0,
    hasData: rows.some((r) => r.hasData),
  };
  for (const r of rows) {
    totals.totalOrders += r.totalOrders;
    totals.totalSpendUsd += r.totalSpendUsd;
    totals.visits += r.visits;
    totals.orders += r.orders;
    totals.orderAmountUsd += r.orderAmountUsd;
    totals.views += r.views;
    totals.clicks += r.clicks;
    totals.budgetUsd += r.budgetUsd;
    totals.spendUsd += r.spendUsd;
    totals.adOrders += r.adOrders;
    // Etsy's revenue is a monthly figure repeated on each entry, so summing it
    // would multiply the month — the latest recorded figure is the honest one.
    if (r.revenueUsd !== 0) totals.revenueUsd = r.revenueUsd;
  }
  totals.ctr = ctrPct(totals.clicks, totals.views);
  return totals;
}

/**
 * Build the day-by-day advertisement report for every store in scope.
 * `days` calendar days ending at `today` are always present (zero rows for a
 * quiet day, like the sheet the user shared), but the table only starts at
 * the store's first day with data.
 */
export function buildDailyAdReport({
  stores,
  spendRows,
  orderRows,
  today,
  days = 30,
}: {
  stores: { id: string; name: string }[];
  spendRows: DailyAdSpendRow[];
  orderRows: DailyAdOrderRow[];
  today: string;
  days?: number;
}): DailyAdReportStore[] {
  const dates = isoDaysBack(today, Math.max(1, days));
  const dateSet = new Set(dates);

  return stores.map((store) => {
    const channel = channelOf(store.name);
    const isAmazon = channel === "amazon";
    const storeSpend = spendRows.filter((r) => r.store_id === store.id && dateSet.has(r.spend_date));
    const storeOrders = orderRows.filter((o) => o.store_id === store.id && dateSet.has(effectiveDate(o)));

    // Everything is bucketed once as (date, country) — country "" is the
    // whole store for Etsy/eBay/Website, and Amazon's combined "all" view.
    const spendBy = new Map<string, SpendAgg>();
    for (const r of storeSpend) {
      const code = isAmazon ? (r.country_code ?? "") : "";
      // A non-Amazon row has no country, so "its country" and "all" are the
      // same bucket — adding it twice would double every number.
      const keys = code ? [`${r.spend_date}|${code}`, `${r.spend_date}|`] : [`${r.spend_date}|`];
      for (const key of keys) {
        const agg = spendBy.get(key) ?? emptySpend();
        agg.budget += Number(r.budget_usd ?? 0);
        agg.spend += Number(r.spend_usd ?? 0);
        agg.clicks += Number(r.clicks ?? 0);
        agg.views += Number(r.impressions ?? 0);
        agg.visits += Number(r.visits ?? 0);
        agg.etsyVisitsDaily += Number(r.etsy_visits_daily ?? 0);
        agg.revenue = Number(r.etsy_revenue_usd ?? agg.revenue);
        agg.adOrders += Number(r.ad_orders ?? 0);
        spendBy.set(key, agg);
      }
    }

    const ordersBy = new Map<string, OrderAgg>();
    for (const o of storeOrders) {
      const date = effectiveDate(o);
      const code = isAmazon ? orderCountryCode(o) : "";
      const keys = code ? [`${date}|${code}`, `${date}|`] : [`${date}|`];
      for (const key of keys) {
        const agg = ordersBy.get(key) ?? emptyOrder();
        agg.poKeys.add(basePoKey(o.ref_no, o.id));
        agg.amount += Number(o.order_value_usd ?? 0);
        ordersBy.set(key, agg);
      }
    }

    // Which country groups to show: every Amazon country that has any spend
    // row or any order in the window (USA first — the shared sheets are
    // per-country), else the single combined group.
    const countries = isAmazon
      ? AMAZON_COUNTRIES.filter((c) =>
          [...spendBy.keys()].some((k) => k.endsWith(`|${c.code}`)) ||
          [...ordersBy.keys()].some((k) => k.endsWith(`|${c.code}`))
        ).map((c) => c.code)
      : [];
    const groupCodes = isAmazon ? (countries.length > 0 ? countries : [""]) : [""];

    const groups = groupCodes.map((code) => {
      const rows = dates
        .map((date) => {
          const key = `${date}|${code}`;
          return makeRow(date, spendBy.get(key) ?? emptySpend(), ordersBy.get(key) ?? emptyOrder(), channel);
        })
        // Start at the first day this group has a number; a brand-new store
        // then shows one row instead of a month of meaningless zeros.
        .filter((r, i, all) => r.hasData || all.slice(0, i).some((p) => p.hasData));
      return {
        countryCode: code,
        label: code ? amazonCountryLabel(code) : isAmazon ? "All Amazon countries" : store.name,
        rows,
        totals: sumRows(rows),
      };
    });

    return {
      storeId: store.id,
      storeName: store.name,
      channel,
      isAmazon,
      groups: groups.filter((g) => g.rows.length > 0),
    };
  });
}
