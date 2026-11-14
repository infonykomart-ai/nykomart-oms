import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findNotificationDate,
  findNotificationNo,
  normalizeDateInput,
  parseCsvRates,
  parseFeedJson,
  parseNotificationText,
  splitDelimitedRows,
} from "./parse";

// Figures are arbitrary test fixtures, not official customs rates.

const CSV = [
  "Currency,Currency Unit,Import Rate,Export Rate,Effective Start Date,Notification No,Notification Date",
  'US Dollar,1,"90.12345678","88.65432100",2026-11-07,30/2026,2026-11-06',
  "Euro,1,92.50000000,91.25000000,2026-11-07,30/2026,2026-11-06",
  "Japanese Yen (100),100,0.59000000,0.58000000,2026-11-07,30/2026,2026-11-06",
].join("\n");

test("CSV: reads currencies, keeps quoted decimals exactly, and the notification", () => {
  const result = parseCsvRates(CSV);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0].currencyCode, "USD");
  assert.equal(result.rows[0].exportRate, "88.65432100");
  assert.equal(result.rows[0].effectiveStartDate, "2026-11-07");
  assert.equal(result.rows[0].notificationNo, "30/2026");
  assert.equal(result.rows[2].currencyCode, "JPY");
  assert.equal(result.rows[2].currencyUnit, 100);
});

test("CSV: tab-separated files with different header spelling also work", () => {
  const tsv = [
    "Currency Code\tImport\tExport\tEffective From",
    "GBP\t110.11111111\t108.99999999\t2026-11-07",
    "AED\t24.60000000\t24.10000000\t2026-11-07",
  ].join("\n");
  const result = parseCsvRates(tsv);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.rows.map((r) => r.currencyCode), ["GBP", "AED"]);
});

test("CSV: a file with no rate column is rejected with a clear message", () => {
  const result = parseCsvRates("Currency,Effective Start Date\nUSD,2026-11-07");
  assert.equal(result.rows.length, 0);
  assert.match(result.errors.join(" "), /No rate column/i);
});

test("CSV: a file with no currency column is rejected", () => {
  const result = parseCsvRates("Import Rate,Export Rate\n90,88");
  assert.equal(result.rows.length, 0);
  assert.match(result.errors.join(" "), /No currency column/i);
});

test("CSV: unsupported currency is reported, supported rows still parse", () => {
  const csv = [
    "Currency,Import Rate,Export Rate,Effective Start Date",
    "XYZ,1,2,2026-11-07",
    "USD,90,88,2026-11-07",
  ].join("\n");
  const result = parseCsvRates(csv);
  assert.match(result.errors.join(" "), /not supported/i);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].currencyCode, "USD");
});

test("CSV: a missing effective date can fall back to the supplied date", () => {
  const csv = "Currency,Import Rate,Export Rate\nUSD,90,88";
  const result = parseCsvRates(csv, { effectiveStartDate: "2026-11-07" });
  assert.equal(result.rows[0].effectiveStartDate, "2026-11-07");
});

test("splitDelimitedRows handles quoted commas, quotes and newlines", () => {
  const rows = splitDelimitedRows('a,"b,c","d""e"\n"x\ny",z,1', ",");
  assert.deepEqual(rows[0], ["a", "b,c", 'd"e']);
  assert.deepEqual(rows[1], ["x\ny", "z", "1"]);
});

test("notification text: extracts notification number and publication date", () => {
  const text = "CUSTOMS Notification No. 30/2026 dated 06/11/2026, effective from 07/11/2026.";
  assert.equal(findNotificationNo(text), "30/2026");
  assert.equal(findNotificationDate(text), "2026-11-06");
});

test("notification text: reads one row per currency, keeping import and export apart", () => {
  const text = [
    "CUSTOMS Notification No. 30/2026 dated 06/11/2026",
    "1 US Dollar 90.1234 88.6543",
    "2 Euro 92.5000 91.2500",
    "3 Japanese Yen (100) 0.5900 0.5800",
  ].join("\n");

  const result = parseNotificationText(text);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 3);

  const usd = result.rows.find((r) => r.currencyCode === "USD");
  assert.ok(usd);
  assert.equal(usd.importRate, "90.1234");
  assert.equal(usd.exportRate, "88.6543");
  assert.equal(usd.effectiveStartDate, "2026-11-06");
  assert.equal(usd.notificationNo, "30/2026");

  const jpy = result.rows.find((r) => r.currencyCode === "JPY");
  assert.equal(jpy?.currencyUnit, 100);
});

test("notification text: a covering letter with no rate table produces an error, not rows", () => {
  const result = parseNotificationText("This notification amends the earlier notification. No table here.");
  assert.equal(result.rows.length, 0);
  assert.match(result.errors.join(" "), /No currency rows/i);
});

test("feed JSON: tolerates alternate field names", () => {
  const json = JSON.stringify({
    data: [
      { currency: "USD", import: 90.1, export_rate: "88.6", date: "2026-11-07", notification_no: "30/2026" },
      { currencyName: "Euro", importRate: 92.5, exportRate: 91.25, effectiveDate: "2026-11-07" },
    ],
  });
  const result = parseFeedJson(json);
  assert.equal(result.rows.length >= 1, true);
  assert.equal(result.rows[0].currencyCode, "USD");
  assert.ok(result.rows.some((r) => r.currencyCode === "EUR"));
});

test("feed JSON: invalid JSON is reported", () => {
  const result = parseFeedJson("<html>not json</html>");
  assert.equal(result.rows.length, 0);
  assert.match(result.errors.join(" "), /valid JSON/i);
});

test("normalizeDateInput accepts ISO and DD/MM/YYYY", () => {
  assert.equal(normalizeDateInput("2026-11-07"), "2026-11-07");
  assert.equal(normalizeDateInput("07/11/2026"), "2026-11-07");
  assert.equal(normalizeDateInput("7-11-2026"), "2026-11-07");
});
