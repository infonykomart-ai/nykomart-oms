import assert from "node:assert/strict";
import test from "node:test";
import {
  buildDailyAdReport,
  buildStoreTotals,
  isoDaysBack,
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

test("Etsy monthly revenue is shown, never summed across daily entries", () => {
  const spend: DailyAdSpendRow[] = [
    { store_id: "s1", spend_date: "2026-11-19", etsy_revenue_usd: 500, etsy_visits_daily: 40 },
    { store_id: "s1", spend_date: "2026-11-20", etsy_revenue_usd: 500, etsy_visits_daily: 60 },
  ];
  const store = buildDailyAdReport({ stores: [{ id: "s1", name: "Etsy NYKO" }], spendRows: spend, orderRows: [], today })[0];
  assert.equal(store.groups[0].totals.revenueUsd, 500);
  assert.equal(store.groups[0].totals.visits, 100);
});
