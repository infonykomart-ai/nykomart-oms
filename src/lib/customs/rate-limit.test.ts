import { test } from "node:test";
import assert from "node:assert/strict";
import { createRateLimiter } from "./rate-limit";

test("allows up to the limit, then blocks with a retry hint", () => {
  let now = 1_000_000;
  const limiter = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => now });

  assert.equal(limiter.check("emp-1").allowed, true);
  assert.equal(limiter.check("emp-1").allowed, true);
  const blocked = limiter.check("emp-1");
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.remaining, 0);
  assert.ok(blocked.retryAfterSeconds >= 1);

  now += 60_000;
  assert.equal(limiter.check("emp-1").allowed, true);
});

test("limits are per key", () => {
  const now = 5_000;
  const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now });
  assert.equal(limiter.check("a").allowed, true);
  assert.equal(limiter.check("a").allowed, false);
  assert.equal(limiter.check("b").allowed, true);
});
