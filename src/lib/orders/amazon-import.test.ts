import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAmazonOrders, parseAmazonDate, parseAmount } from "./amazon-import";

// 2026-11-03 — Amazon bulk order import ("book.png" format). Two shapes are
// supported on purpose: Amazon's own report header row, and the per-order
// "Order No" book layout the office actually keeps. Both must produce the
// same normalized row so the create pass has a single code path.

test("an Amazon All-Orders header row is read as one order per row", () => {
  const aoa = [
    ["amazon-order-id", "purchase-date", "buyer-name", "ship-city", "ship-country", "currency", "item-price", "quantity-purchased", "sku"],
    ["171-1234567-1234567", "2026-10-02", "Jane Doe", "Austin", "US", "USD", "72.39", "1", "RUG-001"],
    ["171-7654321-7654321", "2026-10-03", "Ravi Patel", "Leeds", "GB", "GBP", "40.00", "2", ""],
  ];
  const parsed = parseAmazonOrders(aoa);
  assert.equal(parsed.shape, "amazon-report");
  assert.equal(parsed.rows.length, 2);
  assert.equal(parsed.rows[0].orderNo, "171-1234567-1234567");
  assert.equal(parsed.rows[0].orderDate, "2026-10-02");
  assert.equal(parsed.rows[0].qty, 1);
  assert.equal(parsed.rows[0].amount, 72.39);
  assert.equal(parsed.rows[0].currency, "USD");
  assert.equal(parsed.rows[0].address, "Jane Doe, Austin, US");
  assert.equal(parsed.rows[1].currency, "GBP");
});

test("the full Amazon All-Orders sheet maps every column the office exports", () => {
  // Headers exactly as in the sheet the owner uploads by hand.
  const headers = [
    "amazon-order-id",
    "merchant-order-id",
    "purchase-date",
    "last-updated-date",
    "order-status",
    "fulfillment-channel",
    "sales-channel",
    "ship-service-level",
    "product-name",
    "sku",
    "asin",
    "quantity",
    "currency",
    "item-price",
    "item-tax",
    "shipping-price",
    "item-promotion-discount",
    "order-item-id",
    "ship-city",
    "ship-state",
    "ship-postal-code",
    "ship-country",
    "fulfilled-by",
    "is-business-order",
  ];
  const aoa = [
    headers,
    [
      "171-1234567-1234567",
      "P-1001",
      "2026-10-02T08:15:00+00:00",
      "2026-10-02T09:00:00+00:00",
      "Shipped",
      "FBA",
      "Amazon.in",
      "Expedited",
      "Hand Tufted Wool Rug — Ivory 5x7",
      "RUG-001",
      "B0C4TEST01",
      "1",
      "INR",
      "72.39",
      "3.61",
      "5.00",
      "2.00",
      "171123456789012",
      "Jaipur",
      "Rajasthan",
      "302001",
      "IN",
      "Amazon",
      "false",
    ],
  ];
  const parsed = parseAmazonOrders(aoa);
  assert.equal(parsed.shape, "amazon-report");
  assert.equal(parsed.rows.length, 1);
  const row = parsed.rows[0];
  assert.equal(row.orderNo, "171-1234567-1234567");
  assert.equal(row.merchantOrderId, "P-1001");
  assert.equal(row.orderDate, "2026-10-02");
  assert.equal(row.orderStatus, "Shipped");
  assert.equal(row.channel, "FBA");
  assert.equal(row.productName, "Hand Tufted Wool Rug — Ivory 5x7");
  assert.equal(row.asin, "B0C4TEST01");
  assert.equal(row.itemId, "171123456789012");
  assert.equal(row.qty, 1);
  // Item price + shipping + tax − promotion discount = what the buyer paid.
  assert.equal(row.amount, 79);
  assert.equal(row.tax, 3.61);
  assert.equal(row.shipping, 5);
  assert.equal(row.discount, 2);
  assert.equal(row.currency, "INR");
  assert.equal(row.postalCode, "302001");
  assert.equal(row.country, "IN");
  assert.match(row.remark, /Status: Shipped/);
  assert.match(row.remark, /Amazon item 171123456789012/);
});

test("the Order-No book layout keeps the order's own amount when a Refund line follows", () => {
  const aoa = [
    ["Order No", "171-1234567-1234567", "02/10/2026", "Jane Doe", "5X7 FT", "2", "72.39", "USD"],
    ["Sale", "HAND TUFTED WOOL RUG", "Black"],
    ["Refund", "10.00"],
    ["Notes", "buyer ne size galat bataya"],
    ["Order No", "171-7654321-7654321", "03/10/2026", "Ravi Patel", "3X5 FT", "1", "40.00", "USD"],
  ];
  const parsed = parseAmazonOrders(aoa);
  assert.equal(parsed.shape, "ledger-blocks");
  assert.equal(parsed.rows.length, 2);
  const first = parsed.rows[0];
  assert.equal(first.orderNo, "171-1234567-1234567");
  assert.equal(first.orderDate, "2026-10-02");
  assert.equal(first.buyerName, "Jane Doe");
  assert.equal(first.size, "5X7 FT");
  assert.equal(first.qty, 2);
  // A refund line is money moving back, never subtracted from what the
  // order cost — it is carried as a remark for the human to act on.
  assert.equal(first.amount, 72.39);
  assert.match(first.remark, /Refund: 10\.00/);
  assert.match(first.remark, /buyer ne size galat bataya/);
  assert.equal(parsed.rows[1].qty, 1);
});

test("a sheet with no recognizable order shape is reported, not guessed", () => {
  const parsed = parseAmazonOrders([
    ["hello", "world"],
    ["1234", "5678"],
  ]);
  assert.equal(parsed.shape, "none");
  assert.equal(parsed.rows.length, 0);
  assert.equal(parsed.issues.length, 1);
});

test("date and amount cells are read in the formats the sheets use", () => {
  assert.equal(parseAmazonDate("02/10/2026"), "2026-10-02");
  assert.equal(parseAmazonDate("2026-10-02T09:31:00+05:30"), "2026-10-02");
  assert.equal(parseAmazonDate("2 Oct 2026"), "2026-10-02");
  assert.equal(parseAmazonDate("n/a"), null);
  assert.equal(parseAmount("$1,234.50"), 1234.5);
  assert.equal(parseAmount("USD 72.39"), 72.39);
  assert.equal(parseAmount("Jane Doe"), null);
});
