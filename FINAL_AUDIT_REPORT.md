# Final Audit Report — 2026-11-04

Repository: `infonykomart-ai/nykomart-oms` (Nykomart OMS)
Baseline commit: `409140b` (`main`)
Audit type: full-repository, non-destructive; no production data or secrets touched.
Companion files: [`AUDIT_REPORT.md`](AUDIT_REPORT.md) (findings) · [`SECURITY.md`](SECURITY.md) (policy + gaps)

---

## 1. Health assessment

**Overall: Good, with one previously-critical exposure now closed.**

| Dimension | Before | After | Grade |
|---|---|---|---|
| Production dependency security | 1 critical, 7 high | **0 critical, 0 high** (16 moderate, dev toolchain only) | A− |
| Authentication / authorization | Solid model, but cron routes failed open without `CRON_SECRET` | Fail-closed, constant-time gate in one shared helper | A− |
| Output encoding (XSS) | HR letter bodies rendered unsanitized HTML | Allowlist-sanitised on write and on read | A− |
| Transport / browser hardening | No response headers at all | Baseline OWASP headers on every route; CSP still open | B |
| Code quality | Lint clean except 2 permanent warnings | **0 lint problems**, no `@ts-ignore`, no `console.log` in app paths | A− |
| Test coverage | 109 tests, pure domain logic only | 116 tests; still **no authorization tests** | C+ |
| Build / CI | CI present but no dependency gate | Audit gate, least-privilege token, concurrency, Dependabot groups | A− |
| Documentation | README/SECURITY strong; no audit trail | AUDIT_REPORT, FINAL_AUDIT_REPORT, README/SECURITY/CHANGES updated | A− |
| Ops debt | 2 migrations unapplied in production | Unchanged — operational, not code | C |

The single most important line in this report: **`next@16.3.0` was running with two
unauthenticated RCE advisories on a public-facing deployment.** That is fixed by
the version bump in this audit and should be deployed immediately.

## 2. Verification log (what was actually run)

Every command below was executed after the changes, on this working tree.

| Check | Command | Result |
|---|---|---|
| Lint (whole repo) | `npm run lint` | 0 problems (was 2 warnings) |
| Unit tests | `npm test` | **116 pass / 0 fail** (109 before + 7 sanitizer tests) |
| Focused type-check | `tsc -p` over `next.config.ts`, all `api/**` routes, `lib/auth`, `lib/hr-letters`, HR letter pages/components, returns, agreements, orders, backup | exit 0 |
| Production compile (Next 16.4.5, webpack) | `next build --webpack --debug-build-paths "app/dashboard/orders/**,app/dashboard/returns/**,app/dashboard/hr-letters/**,app/dashboard/agreements/**,app/api/**"` | **✓ Compiled successfully in 24.6 s** |
| Production compile (earlier route set) | `… --debug-build-paths "app/api/cron/**,app/dashboard/hr-letters/**"` | **✓ Compiled successfully in 27.5 s** |
| Runtime smoke (dev server, Next 16.4.5) | `GET /` → 200, `/login` → 200, `/dashboard/{orders,returns,hr-letters}` → 307 to login | no compile errors in logs |
| Security headers | `curl -I /` | `X-Content-Type-Options`, `X-Frame-Options`, `Permissions-Policy`, `Strict-Transport-Security`, `X-DNS-Prefetch-Control` present |
| Dependency audit (prod) | `npm audit --omit=dev` | **0 vulnerabilities** |
| Dependency audit (all) | `npm audit` | 16 moderate, dev toolchain only |
| `xlsx` 0.20.3 round-trip | `XLSX.write` → `XLSX.read` → `sheet_to_json` | values, sheet names and JSON conversion intact |

### Checks that could NOT be completed here (limitations, not passes)

1. **Whole-project `tsc --noEmit`** — OOM-killed (exit 137) in this sandbox. It
   runs on the GitHub Actions runner (`ci.yml`) and is unchanged in scope; the
   focused type-check above covered every file this audit touched plus their
   dependants.
2. **Full `next build`** (Turbopack, and webpack's type-check/prerender phase) —
   also OOM-killed in this sandbox after the compile step reported success. The
   compile phase, which is what actually broke on Vercel at `6579bbc`, passes.
   Final confirmation is the Vercel rebuild of this commit.
3. **Live database / RLS verification** — no Supabase credentials are available
   in this workspace, so no authenticated UI walkthrough, no RLS policy test and
   no migration application against production was performed.
4. **No penetration test** was run against the deployed site.

## 3. Changes delivered

**Dependency security (Phase 5)**
- `next` + `eslint-config-next` 16.3.0 → **16.4.5** (exact pins; clears 2 RCE + 1 DoS advisory).
- `sharp` 0.35.3 → **0.35.5**; `xlsx` npm 0.18.5 → **official SheetJS 0.20.3 tarball**.
- CI now fails on any high/critical advisory in shipped dependencies.

**Application security (Phase 4)**
- `src/lib/auth/cron-auth.ts` — fail-closed, constant-time cron authorization; wired into all 5 cron routes.
- `src/lib/hr-letters/sanitize-body-html.ts` — allowlist HTML sanitizer, applied on write and on read; 7 tests.
- `next.config.ts` — baseline security headers on `/:path*`.

**Quality & CI (Phases 3, 8)**
- ESLint honours the existing `^_` unused-argument convention → repo is warning-free.
- `ci.yml`: `permissions: contents: read`, concurrency cancellation, job timeouts, production audit gate.
- `.github/dependabot.yml`: weekly, grouped dependency PRs (Next/React move together).

**Documentation (Phases 2, 7, 10)**
- New `AUDIT_REPORT.md` and this file.
- `SECURITY.md`: hardening table + expanded known-gaps list.
- `README.md`: CI section, security model, spreadsheet dependency note.
- `CHANGES.txt`: full round entry in the repo's own format.

## 4. What remains — prioritised

| Priority | Item | Why it matters |
|---|---|---|
| P0 | Deploy this commit; rebuild on Vercel | The Next RCE advisories are only closed once it is live. |
| P0 | Apply `db/2026-11-03-vendor-agreements.sql` and `db/2026-11-03b-return-approval.sql` in Supabase | Vendor agreements + return approvals are inert until then. |
| P1 | Make the repository **private** and decide on the history rewrite | Real business records are still in git history (see `SECURITY.md` open incident). |
| P1 | Add automated authorization tests (company A cannot read company B) | The only class of bug left that can leak data between tenants, and it is currently untested. |
| P2 | Content-Security-Policy with per-request nonces | Last missing browser-hardening layer; needs care with App Router inline scripts. |
| P2 | Rate limiting on document/PDF routes and sensitive Server Actions | Authenticated CPU-abuse path; needs shared state (DB counter or Upstash). |
| P3 | Toolchain upgrade to clear the 16 moderate dev advisories | Dev-only exposure; Dependabot will now surface it. |
| P3 | Convert the 97 annotated `eslint-disable`s (18 `set-state-in-effect`, 25 `no-img-element`) | Readability/maintainability, no functional risk. |

## 5. Scoring

| Metric | Score |
|---|---|
| Buildability | 9/10 (compile verified; full build + prerender left to CI/Vercel) |
| Security posture | 8/10 (critical CVEs closed, headers + XSS + cron fixed; no RLS/authz tests, no CSP) |
| Code quality | 9/10 (strict TS, zero lint problems, no suppressions of type safety) |
| Test coverage | 5/10 (strong on domain maths, absent on access control and UI) |
| CI/CD maturity | 8/10 (gates, audit, schema check, Dependabot; no preview deploys/e2e) |
| Documentation | 9/10 |
| **Overall** | **8.0 / 10 — production-ready, with the two P0 items above as the gate.** |
