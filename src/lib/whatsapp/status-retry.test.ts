// 2026-11-25 — The retry sweep that runs from the scheduled job.
//
// Runs the real retryDueStatusMessages against a stub client: it must attempt
// sendable rows, park rows that can never send, and stop at its time budget
// instead of being killed mid-batch by the route's 60s cap.
import test from "node:test";
import assert from "node:assert/strict";
import {
  STATUS_BACKLOG_ALERT_HOURS,
  STATUS_RETRY_BATCH,
  retryDueStatusMessages,
  statusMessageBacklog,
} from "./status-retry";

type Patch = Record<string, unknown>;

function fakeClient(rows: unknown[], opts: { claimable?: boolean } = {}) {
  const patches: { patch: Patch; id?: unknown }[] = [];
  let lastId: unknown;
  // 2026-11-26 — deliverQueuedMessage now CLAIMS the row (a conditional
  // update) before sending; `claimable: false` stands in for a row another
  // attempt already took, so the "do not send twice" path can be tested.
  const claimable = opts.claimable ?? true;

  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: (column: string, value: unknown) => {
      if (column === "id") lastId = value;
      return chain;
    },
    in: () => chain,
    lte: () => chain,
    lt: () => chain,
    order: () => chain,
    limit: async () => ({ data: rows, error: null }),
    update: (patch: Patch) => {
      patches.push({ patch, id: lastId });
      const write: Record<string, unknown> = {};
      Object.assign(write, {
        eq: (column: string, value: unknown) => {
          if (column === "id") lastId = value;
          return write;
        },
        in: () => write,
        lt: () => write,
        select: () => write,
        maybeSingle: async () => ({ data: claimable ? { id: lastId } : null, error: null }),
        // Plain `update(...).eq("id", …)` writes are awaited directly.
        then: (resolve: (value: unknown) => unknown) => resolve({ error: null }),
      });
      return write;
    },
  });

  const client = { from: () => chain } as never;
  return { client, patches };
}

test("sendable rows are attempted; a row with no number is parked as skipped", async () => {
  const { client, patches } = fakeClient([
    { id: "m1", customer_phone: null, message_text: "Hold this order PO-1", retry_count: 0 },
    { id: "m2", customer_phone: "919876543210", message_text: "Hold this order PO-2", retry_count: 0 },
  ]);

  const summary = await retryDueStatusMessages(client, { batch: 10 });

  assert.equal(summary.due, 2);
  assert.equal(summary.attempted, 1);
  assert.equal(summary.skipped, 1); // no phone → parked, never retried again
  // No WHAPI_TOKEN in the test environment, so the send attempt records a
  // failure instead of pretending the message went out.
  assert.equal(summary.failed, 1);
  assert.equal(summary.sent, 0);
  assert.equal(summary.deferred, 0);

  const parked = patches.find((p) => p.patch.delivery_status === "skipped");
  assert.ok(parked, "the numberless row must be marked skipped");
  assert.equal(parked?.patch.next_attempt_at, null);
});

test("a row another attempt already claimed is never sent again", async () => {
  const { client, patches } = fakeClient(
    [{ id: "m1", customer_phone: "919876543210", message_text: "Hold this order PO-1", retry_count: 0 }],
    { claimable: false }
  );

  const summary = await retryDueStatusMessages(client, { batch: 10 });

  assert.equal(summary.sent, 0, "an unclaimable row must not reach the sender");
  // Only the claim attempts were written: no send outcome, no re-park.
  assert.ok(patches.every((p) => p.patch.delivery_status === "processing"));
});

test("backlog counts every due row and flags an ageing queue", async () => {
  const now = new Date("2026-11-26T12:00:00Z");
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    lt: () => chain,
    lte: () => chain,
    order: () => chain,
    limit: async () => ({ data: [{ created_at: "2026-11-26T08:00:00Z" }], count: 120, error: null }),
  });

  const backlog = await statusMessageBacklog({ from: () => chain } as never, { now });

  assert.equal(backlog.pending, 120);
  assert.equal(backlog.oldestHours, 4);
  assert.equal(backlog.behind, true);
  assert.ok(120 > STATUS_RETRY_BATCH);
  assert.ok((backlog.oldestHours ?? 0) >= STATUS_BACKLOG_ALERT_HOURS);
});

test("an empty backlog is not behind", async () => {
  const now = new Date("2026-11-26T12:00:00Z");
  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    lt: () => chain,
    lte: () => chain,
    order: () => chain,
    limit: async () => ({ data: [], count: 0, error: null }),
  });

  const backlog = await statusMessageBacklog({ from: () => chain } as never, { now });

  assert.equal(backlog.pending, 0);
  assert.equal(backlog.oldestCreatedAt, null);
  assert.equal(backlog.oldestHours, null);
  assert.equal(backlog.behind, false);
});

test("the time budget defers the rest of the batch", async () => {
  const { client, patches } = fakeClient([
    { id: "m1", customer_phone: null, message_text: "a", retry_count: 0 },
    { id: "m2", customer_phone: null, message_text: "b", retry_count: 0 },
  ]);

  const summary = await retryDueStatusMessages(client, { budgetMs: 0 });

  assert.equal(summary.due, 2);
  assert.equal(summary.attempted, 0);
  assert.equal(summary.skipped, 0);
  assert.equal(summary.deferred, 2);
  assert.equal(patches.length, 0, "nothing is written when the budget is already spent");
});
