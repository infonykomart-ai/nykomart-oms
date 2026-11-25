// 2026-11-25 — The retry sweep that runs from the scheduled job.
//
// Runs the real retryDueStatusMessages against a stub client: it must attempt
// sendable rows, park rows that can never send, and stop at its time budget
// instead of being killed mid-batch by the route's 60s cap.
import test from "node:test";
import assert from "node:assert/strict";
import { retryDueStatusMessages } from "./status-retry";

type Patch = Record<string, unknown>;

function fakeClient(rows: unknown[]) {
  const patches: { patch: Patch; id?: unknown }[] = [];
  let lastId: unknown;

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
      return { eq: async () => ({ error: null }) };
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
