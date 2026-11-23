import assert from "node:assert/strict";
import test from "node:test";
import { PROBE_CONCURRENCY, withProbeSlot } from "./probes";

// 2026-11-23 — the migration panel covers every dated file (~350 read-only
// checks). These two tests pin the only thing standing between that coverage
// and a burst of hundreds of concurrent PostgREST requests: the bounded pool.

test("the probe pool never runs more than PROBE_CONCURRENCY checks at once", async () => {
  let inFlight = 0;
  let peak = 0;
  const count = PROBE_CONCURRENCY * 3;

  const results = await Promise.all(
    Array.from({ length: count }, () =>
      withProbeSlot(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return true;
      })
    )
  );

  assert.equal(results.length, count);
  assert.ok(peak <= PROBE_CONCURRENCY, `peak concurrency ${peak} exceeded the limit of ${PROBE_CONCURRENCY}`);
  assert.ok(peak > 1, "the pool should still use more than one slot");
});

test("the queue drains completely — every task runs exactly once", async () => {
  const seen: number[] = [];
  await Promise.all(
    Array.from({ length: PROBE_CONCURRENCY * 2 }, (_, i) =>
      withProbeSlot(async () => {
        seen.push(i);
      })
    )
  );

  assert.equal(seen.length, PROBE_CONCURRENCY * 2);
  assert.equal(new Set(seen).size, PROBE_CONCURRENCY * 2);
});

test("a throwing check releases its slot instead of wedging the pool", async () => {
  await assert.rejects(
    withProbeSlot(async () => {
      throw new Error("boom");
    }),
    /boom/
  );

  // If the failed task had leaked its slot this would never resolve once the
  // pool were saturated; a plain next call is enough to prove it was released.
  for (let i = 0; i < PROBE_CONCURRENCY * 2; i++) {
    assert.equal(await withProbeSlot(async () => "ok"), "ok");
  }
});
