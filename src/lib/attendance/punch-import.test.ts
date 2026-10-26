import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDateCell, parseTimeCell, parsePunchRows, splitDelimitedText } from "./punch-import";

// ---------------------------------------------------------------------------
// parseDateCell — every date shape a TeamOffice/Excel export can throw at us
// ---------------------------------------------------------------------------

test("parseDateCell reads ISO, day-first and dotted dates", () => {
  assert.equal(parseDateCell("2026-10-01"), "2026-10-01");
  assert.equal(parseDateCell("01/10/2026"), "2026-10-01");
  assert.equal(parseDateCell("01-10-2026"), "2026-10-01");
  assert.equal(parseDateCell("1/10/2026"), "2026-10-01");
});

test("parseDateCell handles 2-digit years and month-first when month > 12", () => {
  assert.equal(parseDateCell("01/10/26"), "2026-10-01");
  // 13 can only be a month in day-first position -> swap to 01/13
  assert.equal(parseDateCell("01/13/2026"), "2026-01-13");
});

test("parseDateCell reads Excel serial dates (1900 date system)", () => {
  // 46023 == 2026-01-01, counted from 1899-12-30
  assert.equal(parseDateCell(46023), "2026-01-01");
  assert.equal(parseDateCell(45931), "2025-10-01");
});

test("parseDateCell returns null instead of guessing", () => {
  assert.equal(parseDateCell("not a date"), null);
  assert.equal(parseDateCell(""), null);
  assert.equal(parseDateCell(null), null);
  assert.equal(parseDateCell(40 / 0), null);
});

// ---------------------------------------------------------------------------
// parseTimeCell
// ---------------------------------------------------------------------------

test("parseTimeCell normalises 12h and 24h times to HH:MM", () => {
  assert.equal(parseTimeCell("09:29"), "09:29");
  assert.equal(parseTimeCell("9:29 AM"), "09:29");
  assert.equal(parseTimeCell("2:30 PM"), "14:30");
  assert.equal(parseTimeCell("12:15 am"), "00:15");
  assert.equal(parseTimeCell("14:39:00"), "14:39");
});

test("parseTimeCell rejects placeholders and impossible times", () => {
  assert.equal(parseTimeCell(" -- "), null);
  assert.equal(parseTimeCell("--"), null);
  assert.equal(parseTimeCell("N/A"), null);
  assert.equal(parseTimeCell("25:00"), null);
  assert.equal(parseTimeCell("9:75"), null);
  assert.equal(parseTimeCell("garden"), null);
  assert.equal(parseTimeCell(""), null);
});

// ---------------------------------------------------------------------------
// parsePunchRows — row-per-punch tables
// ---------------------------------------------------------------------------

const HEADER = ["Empcode", "Name", "Date", "IN", "OUT"];

test("parsePunchRows reads a headed sheet into normalised rows", () => {
  const out = parsePunchRows(
    [HEADER, ["0002", "RAVI KUMAR", "01/10/2026", "09:30", "18:00"]],
    null
  );
  assert.deepEqual(out.issues, []);
  assert.equal(out.rows.length, 1);
  assert.deepEqual(out.rows[0], {
    line: 2,
    code: "0002",
    name: "RAVI KUMAR",
    date: "2026-10-01",
    inTime: "09:30",
    outTime: "18:00",
  });
});

test("parsePunchRows skips rows with no IN/OUT and reports them", () => {
  const out = parsePunchRows(
    [
      HEADER,
      ["0002", "RAVI", "01/10/2026", "09:30", "18:00"],
      ["0003", "AJAY", "01/10/2026", "", ""],
      ["", "", "01/10/2026", "09:00", "18:00"],
    ],
    null
  );
  assert.equal(out.rows.length, 1);
  assert.ok(out.issues.some((i) => i.includes("Row 3") && i.includes("no IN/OUT time")));
  assert.ok(out.issues.some((i) => i.includes("Row 4") && i.includes("no employee code/name")));
});

test("parsePunchRows applies the fallback date when there is no Date column", () => {
  const out = parsePunchRows(
    [
      ["Empcode", "Name", "IN", "OUT"],
      ["0002", "RAVI", "09:30", "18:00"],
    ],
    "2026-10-06"
  );
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].date, "2026-10-06");
  assert.ok(out.issues[0].includes("No Date column found"));
  assert.ok(out.issues[0].includes("2026-10-06"));
});

test("parsePunchRows reports an unrecognised layout instead of shifting columns", () => {
  const out = parsePunchRows(
    [["weird", "sheet", "header"], ["0002", "RAVI", "09:30"]],
    null
  );
  assert.equal(out.rows.length, 0);
  assert.ok(out.issues.some((i) => i.includes("No header row found")));
});

test("parsePunchRows returns an issue for an empty paste", () => {
  const out = parsePunchRows([], null);
  assert.equal(out.rows.length, 0);
  assert.equal(out.issues.length, 1);
});

// ---------------------------------------------------------------------------
// splitDelimitedText
// ---------------------------------------------------------------------------

test("splitDelimitedText splits comma CSV and honours quoted cells", () => {
  const rows = splitDelimitedText('name,qty\n"Sharma, Ravi",5') as string[][];
  assert.deepEqual(rows, [["name", "qty"], ["Sharma, Ravi", "5"]]);
});

test("splitDelimitedText splits semicolon and tab exports", () => {
  assert.deepEqual(splitDelimitedText("a;b\n1;2") as string[][], [["a", "b"], ["1", "2"]]);
  assert.deepEqual(splitDelimitedText("a\tb\n1\t2") as string[][], [["a", "b"], ["1", "2"]]);
});
