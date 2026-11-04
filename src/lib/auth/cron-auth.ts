// 2026-11-04 (security audit) — one gate for every /api/cron/* route.
//
// The five cron routes each compared `authorization` to
// `Bearer ${process.env.CRON_SECRET}` inline. Two problems with that:
//
//   1. FAIL-OPEN WHEN UNCONFIGURED. With CRON_SECRET unset, the template
//      string evaluates to the literal "Bearer undefined", so any caller
//      sending exactly that header was let through — and these routes use
//      the service-role client to rewrite orders, tracking and backups.
//      An unset secret must mean "nobody", never "whoever guesses this".
//   2. `!==` on secrets is not constant-time; a shared helper makes the
//      timingSafeEqual comparison the default instead of per-route copy-paste.
import crypto from "crypto";

/** True only when CRON_SECRET is configured AND the request's bearer token matches it. */
export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const provided = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const providedBuf = Buffer.from(provided, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");
  // timingSafeEqual throws on length mismatch, so compare lengths first —
  // that leaks length only, which is already public (the "Bearer " prefix).
  return providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
}
