import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDailyAdReport,
  buildPacing,
  buildStoreTotals,
  findAnomalies,
  isoDaysBack,
  isoMonthDates,
  monthOptions,
  type DailyAdOrderRow,
  type DailyAdSpendRow,
} from "./daily-ad-report";

const today = "2026-11-21";

function order(over: Partial<DailyAdOrderRow>): DailyAdOrderRow {
  return {
    id: "o1",
    ref_no: "PO-A1",
    store_id: "s1",
    order_date: "2026-11-20",
    po_date: "2026-11-20",
    order_value_usd: 100,
    buyer_country: null,
    destination_country: null,
    ...over,
  };
}

test("isoDaysBack ends at today with the requested number of days", () => {
  const days = isoDaysBack(today, 3);
  assert.deepEqual(days, ["2026-11-19", "2026-11-20", "2026-11-21"]);
});

test("a non-Amazon store: orders dedupe by base PO and use the PO date", () => {
  const orders = [
    order({ id: "a", ref_no: "PO-9-1/2", po_date: "2026-11-20" }),
    order({ id: "b", ref_no: "PO-9-2/2", po_date: "2026-11-20" }),
    order({ id: "c", ref_no: "PO-10", po_date: null, order_date: "2026-11-19" }),
  ];
  const store = buildDailyAdReport({
    stores: [{ id: "s1", name: "Etsy NYKO" }],
    spendRows: [],
    orderRows: orders,
    today,
  })[0];
  const rows = store.groups[0].rows;
  const day20 = rows.find((r) => r.date === "2026-11-20")!;
  assert.equal(day20.orders, 1, "two parts of one PO count once");
  assert.equal(day20.orderAmountUsd, 200);
  assert.equal(rows.find((r) => r.date === "2026-11-19")!.orders, 1);
  assert.equal(store.groups[0].totals.orders, 2);
});

test("ad metrics come from the spend row; TOTAL ORD adds ad orders and CTR derives", () => {
  const spend: DailyAdSpendRow[] = [
    {
      store_id: "s1",
      spend_date: "2026-11-20",
      budget_usd: 100,
      spend_usd: 40,
      clicks: 8,
      impressions: 800,
      visits: 5,
      ad_orders: 2,
    },
  ];
  const store = buildDailyAdReport({
    stores: [{ id: "s1", name: "eBay NYKO" }],
    spendRows: spend,
    orderRows: [order({})],
    today,
  })[0];
  const row = store.groups[0].rows.find((r) => r.date === "2026-11-20")!;
  assert.equal(row.totalOrders, 3, "1 organic + 2 ad orders");
  assert.equal(row.ctr, 1);
  assert.equal(row.totalSpendUsd, 40);
  assert.equal(row.visits, 5);
});

test("Amazon splits ad metrics and organic orders by marketplace country", () => {
  const spend: DailyAdSpendRow[] = [
    { store_id: "s1", spend_date: "2026-11-20", country_code: "US", clicks: 10, impressions: 1000, spend_usd: 12 },
    { store_id: "s1", spend_date: "2026-11-20", country_code: "CA", clicks: 0, impressions: 250, spend_usd: 3 },
  ];
  const orders: DailyAdOrderRow[] = [
    order({ id: "us", store_id: "s1", buyer_country: "USA", order_value_usd: 50 }),
    order({ id: "ca", store_id: "s1", buyer_country: "Canada", order_value_usd: 20 }),
  ];
  const store = buildDailyAdReport({ stores: [{ id: "s1", name: "Amazon USA" }], spendRows: spend, orderRows: orders, today })[0];
  const us = store.groups.find((g) => g.countryCode === "US")!;
  const ca = store.groups.find((g) => g.countryCode === "CA")!;
  assert.equal(us.totals.orders, 1);
  assert.equal(us.totals.orderAmountUsd, 50);
  assert.equal(us.totals.clicks, 10);
  assert.equal(ca.totals.clicks, 0);
  assert.equal(ca.totals.orderAmountUsd, 20);
  assert.equal(ca.totals.visits, 0);
});

test("the all-stores total adds each store exactly once and re-derives CTR", () => {
  const spend: DailyAdSpendRow[] = [
    { store_id: "s1", spend_date: "2026-11-20", clicks: 5, impressions: 500, spend_usd: 10 },
    { store_id: "s2", spend_date: "2026-11-20", clicks: 5, impressions: 500, spend_usd: 20 },
  ];
  const orders: DailyAdOrderRow[] = [
    order({ id: "a", store_id: "s1", buyer_country: null }),
    order({ id: "b", store_id: "s2", buyer_country: null }),
  ];
  const report = buildDailyAdReport({
    stores: [
      { id: "s1", name: "Amazon USA" },
      { id: "s2", name: "eBay NYKO" },
    ],
    spendRows: spend,
    orderRows: orders,
    today,
  });
  const { perStore, grand } = buildStoreTotals(report);
  assert.equal(perStore.length, 2);
  assert.equal(grand.orders, 2);
  assert.equal(grand.orderAmountUsd, 200);
  assert.equal(grand.clicks, 10);
  assert.equal(grand.spendUsd, 30);
  assert.equal(grand.ctr, 1, "10 clicks / 1000 views");
});

test("a month select uses the whole past month but stops the current month at today", () => {
  assert.deepEqual(isoMonthDates("2026-10", today), ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25", "2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
  assert.equal(isoMonthDates("2026-11", today).length, 21, "current month ends today");
  assert.deepEqual(isoMonthDates("2026-12", today), [], "a future month has no days yet");
  assert.deepEqual(monthOptions("2026-11", 3), ["2026-09", "2026-10", "2026-11"]);
});

test("Amazon daily ad revenue feeds ROAS and ACoS instead of staying 0", () => {
  const spend: DailyAdSpendRow[] = [
    { store_id: "s1", spend_date: "2026-11-20", spend_usd: 40, ad_revenue_usd: 200, clicks: 10, impressions: 1000 },
  ];
  const store = buildDailyAdReport({
    stores: [{ id: "s1", name: "Amazon USA" }],
    spendRows: spend,
    orderRows: [],
    today,
  })[0];
  assert.equal(store.totals.revenueUsd, 200);
  assert.equal(store.totals.roas, 5);
  assert.equal(store.totals.acos, 20);
});

test("a day with an order but no ad entry is flagged as missing", () => {
  const store = buildDailyAdReport({
    stores: [{ id: "s1", name: "Etsy NYKO" }],
    spendRows: [{ store_id: "s1", spend_date: "2026-11-21", spend_usd: 1 }],
    orderRows: [
      order({ id: "a", po_date: "2026-11-20" }),
      order({ id: "b", ref_no: "PO-2", po_date: "2026-11-21" }),
    ],
    today,
  })[0];
  assert.deepEqual(store.missingEntryDates, ["2026-11-20"]);
});

test("budget pacing projects month-end spend and warns on overspend", () => {
  const pacing = buildPacing({ budgetUsd: 1000, spendUsd: 400, dates: isoMonthDates("2026-11", today) })!;
  assert.equal(pacing.daysInMonth, 30);
  assert.equal(pacing.daysElapsed, 21);
  assert.equal(pacing.expectedToDateUsd, 700);
  assert.equal(Math.round(pacing.projectedUsd), 571);
  assert.equal(pacing.overBudget, false);
  assert.equal(buildPacing({ budgetUsd: null, spendUsd: 10, dates: ["2026-11-01"] }), null);

  const over = buildPacing({ budgetUsd: 100, spendUsd: 90, dates: isoMonthDates("2026-11", today) })!;
  assert.equal(over.overBudget, true);
});

test("anomalies catch spend without orders, impossible clicks and a CTR crash", () => {
  const store = buildDailyAdReport({
    stores: [{ id: "s1", name: "Amazon USA" }],
    spendRows: [
      { store_id: "s1", spend_date: "2026-11-19", spend_usd: 10, clicks: 5, impressions: 1000 },
      { store_id: "s1", spend_date: "2026-11-20", spend_usd: 10, clicks: 1, impressions: 1000 },
      { store_id: "s1", spend_date: "2026-11-21", spend_usd: 10, clicks: 30, impressions: 10 },
    ],
    orderRows: [],
    today,
  })[0];
  const kinds = store.anomalies.map((a) => a.kind);
  assert.ok(kinds.includes("spend-no-orders"));
  assert.ok(kinds.includes("ctr-drop"));
  assert.ok(kinds.includes("clicks-over-views"));
  assert.equal(findAnomalies([]).length, 0);
});

test("the all-stores total keeps each store's monthly Etsy revenue exactly once", () => {
  const report = buildDailyAdReport({
    stores: [
      { id: "s1", name: "Etsy NYKO" },
      { id: "s2", name: "Amazon USA" },
    ],
    spendRows: [
      { store_id: "s1", spend_date: "2026-11-19", etsy_revenue_usd: 500 },
      { store_id: "s1", spend_date: "2026-11-20", etsy_revenue_usd: 500 },
      { store_id: "s2", spend_date: "2026-11-20", ad_revenue_usd: 300 },
    ],
    orderRows: [],
    today,
  });
  const { perStore, grand } = buildStoreTotals(report);
  assert.equal(perStore.find((s) => s.storeId === "s1")!.totals.revenueUsd, 500);
  assert.equal(grand.revenueUsd, 800);
});

test("Etsy monthly revenue is shown, never summed across daily entries", () => {
  const spend: DailyAdSpendRow[] = [
    { store_id: "s1", spend_date: "2026-11-19", etsy_revenue_usd: 500, etsy_visits_daily: 40 },
    { store_id: "s1", spend_date: "2026-11-20", etsy_revenue_usd: 500, etsy_visits_daily: 60 },
  ];
  const store = buildDailyAdReport({ stores: [{ id: "s1", name: "Etsy NYKO" }], spendRows: spend, orderRows: [], today })[0];
  assert.equal(store.groups[0].totals.revenueUsd, 500);
  assert.equal(store.groups[0].totals.visits, 100);
});
