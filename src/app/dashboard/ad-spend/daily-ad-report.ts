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
//
// 2026-11-21 (round 2) — the user asked for a MONTH selector (not a fixed
// 30-day window) and a corner TOTAL of everything, so the builder now takes
// an explicit list of dates (isoMonthDates below) and also returns, per
// store: ROAS / ACoS, the days whose ad entry is missing, budget pacing and
// data-quality flags. Still pure — every one of those is tested.
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
  /** 2026-11-21 (round 2) — the ad platform's own daily revenue (Amazon /
   *  eBay). NULL on older rows; the Etsy monthly figure still comes from
   *  etsy_revenue_usd. See db/2026-11-21b-ad-spend-report-upgrades.sql. */
  ad_revenue_usd?: number | null;
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
  /** Revenue ÷ spend (0 when nothing was spent). */
  roas: number;
  /** Spend ÷ revenue × 100 (0 when there is no revenue). */
  acos: number;
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

/** A store's monthly target (store_ad_targets) — both fields optional. */
export type DailyAdTarget = {
  monthlyBudgetUsd: number | null;
  roasTarget: number | null;
};

export const EMPTY_AD_TARGET: DailyAdTarget = { monthlyBudgetUsd: null, roasTarget: null };

/** How the month's spend is tracking against its budget. */
export type DailyAdPacing = {
  monthBudgetUsd: number;
  spendUsd: number;
  /** Days in the selected month (whole month, not just the elapsed part). */
  daysInMonth: number;
  /** Days the selected range actually covers (today clamps the current month). */
  daysElapsed: number;
  /** Budget × daysElapsed ÷ daysInMonth — where spend should be right now. */
  expectedToDateUsd: number;
  /** Spend ÷ daysElapsed × daysInMonth. */
  projectedUsd: number;
  /** Spend vs the expected-to-date figure, as a percentage. */
  pacePct: number | null;
  /** Projected spend is over the month budget. */
  overBudget: boolean;
};

export type DailyAdAnomaly = {
  date: string;
  kind: "spend-no-orders" | "clicks-over-views" | "ctr-drop";
  message: string;
};

export type DailyAdReportStore = {
  storeId: string;
  storeName: string;
  companyName: string;
  channel: StoreChannel;
  isAmazon: boolean;
  groups: DailyAdReportGroup[];
  totals: Omit<DailyAdReportRow, "date">;
  /** Dates in range where the store had orders but no ad entry at all. */
  missingEntryDates: string[];
  /** Only when the store has a monthly budget target. */
  pacing: DailyAdPacing | null;
  target: DailyAdTarget;
  /** At most 5 per store / group. */
  anomalies: DailyAdAnomaly[];
};

type SpendAgg = {
  budget: number;
  spend: number;
  clicks: number;
  views: number;
  visits: number;
  etsyVisitsDaily: number;
  revenue: number;
  adRevenue: number;
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
  adRevenue: 0,
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

/** The month's dates (YYYY-MM-DD, oldest first). The current month stops at
 *  `today`; a future month has no days yet; a past month is whole. */
export function isoMonthDates(month: string, today?: string): string[] {
  if (!/^\d{4}-\d{2}$/.test(month)) return [];
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return [];
  if (today && month > today.slice(0, 7)) return [];
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lastDay = today && month === today.slice(0, 7) ? Math.min(Number(today.slice(8, 10)), daysInMonth) : daysInMonth;
  const out: string[] = [];
  for (let d = 1; d <= lastDay; d++) out.push(`${month}-${String(d).padStart(2, "0")}`);
  return out;
}

/** Last `count` months (oldest first), ending at today's month. */
export function monthOptions(today: string, count = 12): string[] {
  const [y, m] = today.slice(0, 7).split("-").map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-11" → "Nov 2026". */
export function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return `${MONTHS[m - 1] ?? m} ${y}`;
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

/** The day's revenue figure: Etsy's monthly number or the ad platform's own
 *  daily revenue (Amazon/eBay). */
function revenueOf(channel: StoreChannel, agg: SpendAgg): number {
  return channel === "etsy" ? agg.revenue : agg.adRevenue;
}

function makeRow(date: string, spend: SpendAgg, order: OrderAgg, channel: StoreChannel): DailyAdReportRow {
  const orders = order.poKeys.size;
  const revenue = revenueOf(channel, spend);
  const spendUsd = spend.spend;
  return {
    date,
    totalOrders: orders + spend.adOrders,
    totalSpendUsd: spendUsd,
    visits: visitsOf(channel, spend),
    orders,
    orderAmountUsd: order.amount,
    views: spend.views,
    clicks: spend.clicks,
    ctr: ctrPct(spend.clicks, spend.views),
    budgetUsd: spend.budget,
    spendUsd,
    revenueUsd: revenue,
    adOrders: spend.adOrders,
    roas: roasOf(revenue, spendUsd),
    acos: acosOf(spendUsd, revenue),
    hasData:
      orders > 0 ||
      order.amount !== 0 ||
      spend.spend !== 0 ||
      spend.budget !== 0 ||
      spend.clicks !== 0 ||
      spend.views !== 0 ||
      visitsOf(channel, spend) !== 0 ||
      spend.adOrders !== 0 ||
      revenue !== 0,
  };
}

/** Revenue ÷ spend; 0 when nothing was spent (never Infinity). */
export function roasOf(revenueUsd: number, spendUsd: number): number {
  const revenue = Number(revenueUsd ?? 0);
  const spend = Number(spendUsd ?? 0);
  if (!Number.isFinite(revenue) || !Number.isFinite(spend) || spend <= 0) return 0;
  return revenue / spend;
}

/** Spend ÷ revenue × 100; 0 when there is no revenue (never Infinity). */
export function acosOf(spendUsd: number, revenueUsd: number): number {
  const revenue = Number(revenueUsd ?? 0);
  const spend = Number(spendUsd ?? 0);
  if (!Number.isFinite(revenue) || !Number.isFinite(spend) || revenue <= 0) return 0;
  return (spend * 100) / revenue;
}

export type DailyAdTotals = Omit<DailyAdReportRow, "date">;

function blankTotals(): DailyAdTotals {
  return {
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
    roas: 0,
    acos: 0,
    hasData: false,
  };
}

/** One store's (or country's) totals from its daily rows. Etsy's monthly
 *  revenue is repeated on every row, so it is the latest figure — never a
 *  sum over days. Every other channel records a daily revenue, so it sums. */
function sumRows(rows: DailyAdReportRow[], channel: StoreChannel): DailyAdTotals {
  const totals = blankTotals();
  totals.hasData = rows.some((r) => r.hasData);
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
    if (channel === "etsy") {
      if (r.revenueUsd !== 0) totals.revenueUsd = r.revenueUsd;
    } else {
      totals.revenueUsd += r.revenueUsd;
    }
  }
  totals.ctr = ctrPct(totals.clicks, totals.views);
  totals.roas = roasOf(totals.revenueUsd, totals.spendUsd);
  totals.acos = acosOf(totals.spendUsd, totals.revenueUsd);
  return totals;
}

/** Add up totals blocks. Each store's block has already de-duplicated its own
 *  monthly figure, so revenue can simply be summed across stores — that is
 *  what makes the all-stores total correct for Amazon + Etsy together. CTR,
 *  ROAS and ACoS are re-derived from the summed inputs. */
export function combineTotals(list: DailyAdTotals[]): DailyAdTotals {
  const out = blankTotals();
  out.hasData = list.some((t) => t.hasData);
  for (const t of list) {
    out.totalOrders += t.totalOrders;
    out.totalSpendUsd += t.totalSpendUsd;
    out.visits += t.visits;
    out.orders += t.orders;
    out.orderAmountUsd += t.orderAmountUsd;
    out.views += t.views;
    out.clicks += t.clicks;
    out.budgetUsd += t.budgetUsd;
    out.spendUsd += t.spendUsd;
    out.adOrders += t.adOrders;
    out.revenueUsd += t.revenueUsd;
  }
  out.ctr = ctrPct(out.clicks, out.views);
  out.roas = roasOf(out.revenueUsd, out.spendUsd);
  out.acos = acosOf(out.spendUsd, out.revenueUsd);
  return out;
}

/** One line per store for the "all stores + total" view (admin / MD). */
export type DailyAdStoreTotal = {
  storeId: string;
  storeName: string;
  companyName: string;
  channel: StoreChannel;
  totals: DailyAdTotals;
};

/**
 * The all-stores summary: each store's total plus the grand total.
 * Stores with no data in the window are left out (they would only add zeros).
 */
export function buildStoreTotals(report: DailyAdReportStore[]): {
  perStore: DailyAdStoreTotal[];
  grand: DailyAdTotals;
} {
  const perStore = report
    .filter((s) => s.groups.length > 0)
    .map((s) => ({
      storeId: s.storeId,
      storeName: s.storeName,
      companyName: s.companyName,
      channel: s.channel,
      totals: s.totals,
    }));
  return { perStore, grand: combineTotals(perStore.map((s) => s.totals)) };
}

/** Budget pacing for one store's month. Null without a monthly budget. */
export function buildPacing({
  budgetUsd,
  spendUsd,
  dates,
}: {
  budgetUsd: number | null;
  spendUsd: number;
  dates: string[];
}): DailyAdPacing | null {
  if (budgetUsd === null || !Number.isFinite(budgetUsd) || budgetUsd <= 0) return null;
  if (dates.length === 0) return null;
  const month = dates[0].slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const daysElapsed = dates.length;
  const spend = Number(spendUsd ?? 0);
  const expectedToDateUsd = (budgetUsd * daysElapsed) / daysInMonth;
  const projectedUsd = daysElapsed > 0 ? (spend / daysElapsed) * daysInMonth : 0;
  return {
    monthBudgetUsd: budgetUsd,
    spendUsd: spend,
    daysInMonth,
    daysElapsed,
    expectedToDateUsd,
    projectedUsd,
    pacePct: expectedToDateUsd > 0 ? (spend * 100) / expectedToDateUsd : null,
    overBudget: projectedUsd > budgetUsd,
  };
}

/** Data-quality flags for a group's days (spend with no order, impossible
 *  CTR, and a CTR that is less than half the store's own average). */
export function findAnomalies(rows: DailyAdReportRow[], max = 5): DailyAdAnomaly[] {
  const withViews = rows.filter((r) => r.views >= 100);
  const avgCtr =
    withViews.length > 0 ? withViews.reduce((sum, r) => sum + r.ctr, 0) / withViews.length : 0;
  const out: DailyAdAnomaly[] = [];
  for (const r of [...rows].reverse()) {
    if (out.length >= max) break;
    // The checks are independent: a day can be both overspent with no order
    // and have a broken CTR, and hiding one behind the other would lose it.
    if (r.clicks > r.views && r.clicks > 0) {
      out.push({ date: r.date, kind: "clicks-over-views", message: "Clicks are more than views — check the entry." });
    }
    if (out.length >= max) break;
    if (r.spendUsd > 0 && r.totalOrders === 0) {
      out.push({ date: r.date, kind: "spend-no-orders", message: "Spend recorded with no order." });
    }
    if (out.length >= max) break;
    if (r.views >= 100 && avgCtr > 0 && r.ctr < avgCtr / 2) {
      out.push({
        date: r.date,
        kind: "ctr-drop",
        message: `CTR ${r.ctr.toFixed(2)}% — less than half the average ${avgCtr.toFixed(2)}%.`,
      });
    }
  }
  return out;
}

/**
 * Build the day-by-day advertisement report for every store in scope.
 * `dates` is the month's dates (isoMonthDates); `today`/`days` are the older
 * fixed-window form. A quiet day is still a zero row, like the sheet the user
 * shared, but the table only starts at the store's first day with data.
 */
export function buildDailyAdReport({
  stores,
  spendRows,
  orderRows,
  dates,
  today,
  days = 30,
  targets = {},
}: {
  stores: { id: string; name: string; companyName?: string }[];
  spendRows: DailyAdSpendRow[];
  orderRows: DailyAdOrderRow[];
  dates?: string[];
  today?: string;
  days?: number;
  targets?: Record<string, DailyAdTarget>;
}): DailyAdReportStore[] {
  const dateList = dates ?? (today ? isoDaysBack(today, Math.max(1, days)) : []);
  const dateSet = new Set(dateList);
  const first = dateList[0];
  const last = dateList[dateList.length - 1];

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
        agg.adRevenue += Number(r.ad_revenue_usd ?? 0);
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
      const rows = dateList
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
        totals: sumRows(rows, channel),
      };
    });

    const totals = combineTotals(groups.map((g) => g.totals));
    const target = targets[store.id] ?? EMPTY_AD_TARGET;

    // Days with an order but no ad entry at all: the report can never be
    // right about them, so the tab calls them out (missing-entry alert).
    const spendDates = new Set(storeSpend.map((r) => r.spend_date));
    const orderDates = new Set(storeOrders.map(effectiveDate).filter((d) => d >= (first ?? "") && d <= (last ?? "")));
    const missingEntryDates = [...orderDates].filter((d) => !spendDates.has(d)).sort();

    return {
      storeId: store.id,
      storeName: store.name,
      companyName: store.companyName ?? "",
      channel,
      isAmazon,
      groups: groups.filter((g) => g.rows.length > 0),
      totals,
      missingEntryDates,
      pacing: buildPacing({ budgetUsd: target.monthlyBudgetUsd, spendUsd: totals.spendUsd, dates: dateList }),
      target,
      anomalies: groups.flatMap((g) => findAnomalies(g.rows)).slice(0, 5),
    };
  });
}
