import assert from "node:assert/strict";
import test from "node:test";
import {
  CHANNEL_METRIC_KEYS,
  channelPointsFor,
  ctrPct,
  monthSpendFor,
  monthlySpendPct,
  parseMetricNumber,
  storeChannel,
} from "./channel-metrics";

test("stores are classified by marketplace name", () => {
  assert.equal(storeChannel("NYKO Amazon US"), "amazon");
  assert.equal(storeChannel("Etsy - NYKO Home"), "etsy");
  assert.equal(storeChannel("eBay UK Store"), "ebay");
  assert.equal(storeChannel("Website"), "other");
  assert.equal(storeChannel(null), "other");
});

test("CTR is clicks ÷ impressions × 100 and 0 when nothing was seen", () => {
  assert.equal(ctrPct(10, 1000), 1);
  assert.equal(ctrPct(0, 1000), 0);
  assert.equal(ctrPct(10, 0), 0);
  assert.equal(ctrPct(null, null), 0);
  assert.equal(ctrPct(undefined, 500), 0);
});

test("blank metric input means not recorded, invalid input is rejected", () => {
  assert.equal(parseMetricNumber(""), null);
  assert.equal(parseMetricNumber("  "), null);
  assert.equal(parseMetricNumber("12"), 12);
  assert.equal(parseMetricNumber("1.5"), 1.5);
  assert.equal(parseMetricNumber("0"), 0);
  assert.equal(parseMetricNumber("-3"), undefined);
  assert.equal(parseMetricNumber("abc"), undefined);
});

test("Etsy monthly spend % is spend ÷ revenue and null without revenue", () => {
  assert.equal(monthlySpendPct(250, 1000), 25);
  assert.equal(monthlySpendPct(0, 1000), 0);
  assert.equal(monthlySpendPct(250, 0), null);
  assert.equal(monthlySpendPct(250, null), null);
});

test("each channel only owns its own metric columns", () => {
  assert.deepEqual(CHANNEL_METRIC_KEYS.amazon, ["clicks", "impressions", "visits"]);
  assert.deepEqual(CHANNEL_METRIC_KEYS.ebay, ["visits", "impressions", "clicks"]);
  assert.ok(CHANNEL_METRIC_KEYS.etsy.includes("etsy_revenue_usd"));
  assert.ok(!CHANNEL_METRIC_KEYS.amazon.includes("etsy_revenue_usd"));
  assert.deepEqual(CHANNEL_METRIC_KEYS.other, []);
});

test("channel chart points sum a store's days and compute CTR per day", () => {
  const rows = [
    { store_id: "s1", spend_date: "2026-11-20", clicks: 5, impressions: 1000, visits: 40, spend_usd: 10 },
    // second Amazon country row of the same day
    { store_id: "s1", spend_date: "2026-11-20", clicks: 5, impressions: 1000, visits: 10, spend_usd: 5 },
    { store_id: "s1", spend_date: "2026-11-21", clicks: 1, impressions: 0, visits: 3, spend_usd: 2 },
    { store_id: "s2", spend_date: "2026-11-20", clicks: 99, impressions: 99, visits: 99, spend_usd: 99 },
  ];
  const points = channelPointsFor(rows, "s1");
  assert.equal(points.length, 2);
  assert.deepEqual(points[0].date, "2026-11-20");
  assert.equal(points[0].clicks, 10);
  assert.equal(points[0].impressions, 2000);
  assert.equal(points[0].visits, 50);
  assert.equal(points[0].spendUsd, 15);
  assert.equal(points[0].ctr, 0.5);
  assert.equal(points[1].ctr, 0);
});

test("month-to-date spend only counts the requested store and month", () => {
  const rows = [
    { store_id: "s1", spend_date: "2026-11-01", spend_usd: 10 },
    { store_id: "s1", spend_date: "2026-11-30", spend_usd: 5 },
    { store_id: "s1", spend_date: "2026-12-01", spend_usd: 100 },
    { store_id: "s2", spend_date: "2026-11-02", spend_usd: 50 },
  ];
  assert.equal(monthSpendFor(rows, "s1", "2026-11"), 15);
});
