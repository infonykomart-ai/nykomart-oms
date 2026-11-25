// 2026-11-25 — The Daily Entry list/export query, exercised for real.
//
// These run the actual listAdSpendEntries against a stub PostgREST client: they
// pin the two rules that are easy to break and invisible in the UI —
//   • a ticked-row export returns exactly those rows, scoped to the login's
//     stores, and no search/date filter can drop one of them;
//   • on a database without the soft-delete columns the list still returns
//     rows instead of going blank.
import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SELECTED_IDS,
  listAdSpendEntries,
  parseEntryFilters,
  parseSelectedIds,
} from "./entries";

const ID_A = "11111111-1111-1111-1111-111111111111";
const ID_B = "22222222-2222-2222-2222-222222222222";

type Call = { method: string; args: unknown[] };
type StubOptions = { failWithSoftDeleteFilter?: boolean };

function fakeClient(rows: unknown[], options: StubOptions = {}) {
  const calls: Call[] = [];
  let usedSoftDeleteFilter = false;

  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  const record = (method: string) => (...args: unknown[]) => {
    calls.push({ method, args });
    if (method === "is" && args[0] === "deleted_at") usedSoftDeleteFilter = true;
    return builder;
  };
  Object.assign(builder, {
    select: record("select"),
    in: record("in"),
    order: record("order"),
    is: record("is"),
    gte: record("gte"),
    lte: record("lte"),
    range: async (...args: unknown[]) => {
      const failsNow = Boolean(options.failWithSoftDeleteFilter) && usedSoftDeleteFilter;
      usedSoftDeleteFilter = false;
      calls.push({ method: "range", args });
      return failsNow
        ? { data: null, count: null, error: { message: 'column "deleted_at" does not exist' } }
        : { data: rows, count: rows.length, error: null };
    },
  });

  const client = { from: record("from") };
  return { client: client as never, calls };
}

const argsOf = (calls: Call[], method: string) => calls.filter((c) => c.method === method).map((c) => c.args);

test("a selection keeps only real ids and collapses duplicates", () => {
  assert.deepEqual(parseSelectedIds(`${ID_A}, ${ID_B},${ID_A},not-an-id,`), [ID_A, ID_B]);
  assert.deepEqual(parseSelectedIds(""), []);
  assert.deepEqual(parseSelectedIds(null), []);
  // A hand-built URL cannot ask for the whole table.
  const many = Array.from(
    { length: MAX_SELECTED_IDS + 50 },
    (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, "0")}`
  ).join(",");
  assert.equal(parseSelectedIds(many).length, MAX_SELECTED_IDS);
});

test("export-selected queries exactly the ticked rows inside the store scope", async () => {
  const { client, calls } = fakeClient([{ id: ID_A }]);
  const result = await listAdSpendEntries(client, {
    storeIds: ["s1"],
    // A search/date range that matches nothing must not win over the ticks.
    q: "no-such-store",
    from: "2026-01-01",
    to: "2026-01-31",
    ids: [ID_A],
    page: 1,
    pageSize: MAX_SELECTED_IDS,
  });

  assert.equal(result.rows.length, 1);
  assert.deepEqual(argsOf(calls, "in"), [
    ["store_id", ["s1"]],
    ["id", [ID_A]],
  ]);
  assert.deepEqual(argsOf(calls, "is"), [["deleted_at", null]]);
  assert.equal(argsOf(calls, "gte").length, 0, "no date range is applied to a ticked-row export");
  assert.equal(argsOf(calls, "lte").length, 0);
});

test("the normal list still applies the search and the date range", async () => {
  const { client, calls } = fakeClient([{ id: ID_A }]);
  await listAdSpendEntries(client, {
    storeIds: ["s1", "s2"],
    q: "alpha",
    from: "2026-11-01",
    storeName: (id) => (id === "s1" ? "Alpha Store" : "Beta Store"),
  });

  assert.deepEqual(argsOf(calls, "in"), [["store_id", ["s1"]]]);
  assert.deepEqual(argsOf(calls, "gte"), [["spend_date", "2026-11-01"]]);
});

test("a database without deleted_at still lists its rows", async () => {
  const { client, calls } = fakeClient([{ id: ID_A }], { failWithSoftDeleteFilter: true });
  const result = await listAdSpendEntries(client, { storeIds: ["s1"] });

  assert.equal(result.rows.length, 1);
  // Two attempts: with the soft-delete filter, then without it.
  assert.equal(argsOf(calls, "range").length, 2);
});

test("filters never widen scope and clamp a broken page number", () => {
  const filters = parseEntryFilters({ store: "s9", page: "-4", from: "yesterday" }, ["s1"]);
  assert.equal(filters.storeId, "");
  assert.equal(filters.page, 1);
  assert.equal(filters.from, "");
  assert.equal(filters.pageSize, 25);
});
