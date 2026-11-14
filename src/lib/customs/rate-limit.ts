// Small in-memory rate limiter for the customs-rates API.
//
// This app has no Redis/upstash dependency, so the limiter is per server
// instance and resets on deploy/cold start. That is deliberate and documented
// as best-effort: it stops a single client from hammering the endpoint inside
// one instance, while the real access control remains session + capability.
export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export type RateLimiter = {
  check: (key: string) => RateLimitResult;
  reset: () => void;
};

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  now?: () => number;
}): RateLimiter {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  const now = opts.now ?? (() => Date.now());

  return {
    check(key: string): RateLimitResult {
      const current = now();
      // Opportunistic cleanup so a long-lived instance does not grow forever.
      if (buckets.size > 1000) {
        for (const [k, v] of buckets) {
          if (v.resetAt <= current) buckets.delete(k);
        }
      }

      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= current) {
        buckets.set(key, { count: 1, resetAt: current + opts.windowMs });
        return { allowed: true, remaining: opts.limit - 1, retryAfterSeconds: 0 };
      }
      if (bucket.count >= opts.limit) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - current) / 1000)),
        };
      }
      bucket.count += 1;
      return { allowed: true, remaining: opts.limit - bucket.count, retryAfterSeconds: 0 };
    },
    reset() {
      buckets.clear();
    },
  };
}
