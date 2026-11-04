# Repository Audit — 2026-11-04

Scope: the whole `nykomart-oms` repository at commit `409140b` (branch `main`).
This is the working inventory produced during the audit; the health assessment
and the verification log are in [`FINAL_AUDIT_REPORT.md`](FINAL_AUDIT_REPORT.md).
Status legend: **Fixed** = changed in this audit, **Open** = real issue left in
place (with reason), **Accepted** = known and deliberately not changing now.

---

## 1. Stack and structure (Phase 1)

| Item | Value |
|---|---|
| Framework | Next.js 16 App Router (`src/`), React 19, TypeScript strict |
| Styling | Tailwind CSS v4 via `@tailwindcss/postcss` |
| Backend | Next.js Server Actions + Route Handlers (`src/app/api/**`, 27 routes) |
| Database | Supabase Postgres 16, `db/schema.sql` cumulative + 154 dated migrations |
| Auth | Supabase Auth + employees/roles/capabilities, session refresh in `src/proxy.ts` |
| PDF/files | `@react-pdf/renderer`, `pdfjs-dist`, `pdf-parse`, `sharp`, `xlsx` |
| Hosting | Vercel; 2 crons in `vercel.json` + GitHub Actions weekly backup |
| Package manager | npm (`package-lock.json` only) |
| Source files | 738 `.ts`/`.tsx`, 13 test files, 109 → 116 tests |
| CI | `.github/workflows/ci.yml` (build job + Postgres schema job), `weekly-backup.yml` |

Directory shape: `src/app/dashboard/<section>/{page.tsx,actions.ts}` per module,
`src/lib/<domain>`, `src/components`, generated `src/types/database.ts`.

## 2. Error inventory (Phase 2)

Baseline before any change:

| Check | Result |
|---|---|
| `npm run lint` | 0 errors, **2 warnings** (`bill-payment/merge-actions.ts`, unused `_prev` / `_formData`) |
| `npm test` | 109 pass / 0 fail |
| `npx tsc --noEmit` (whole project) | Not runnable here — OOM-killed in the audit sandbox (exit 137); runs in CI on a 7 GB runner |
| `next build` (Turbopack) | Failed on Vercel at `6579bbc`: `export const` in a `"use server"` module (fixed in `409140b`) |
| `npm audit` | 1 **critical** (next 16.3.0 RCE advisories), 7 high (sharp, xlsx, zod, js-yaml, nanoid, brace-expansion, source-map-js), 16 moderate |

## 3. Issues found and resolution (Phases 3–5)

### 3.1 Critical — Next.js 16.3.0 (Fixed)

`16.3.0` is inside three advisories: unauthenticated RCE in the Image
Optimization API (SVG and AVIF paths), unauthenticated RCE in `use cache`
functions returning typed arrays, and an App Router Server Actions DoS
(GHSA-2464-fhr4-w9xw, GHSA-673q-mjm6-r5xr, GHSA-p3m5-59mp-jv5r). All are patched
only from `16.4.1`.

**Fix:** `next` and `eslint-config-next` → `16.4.5` (pinned exact, matching the
repo's previous pinning style). `npm audit` now reports 0 critical / 0 high for
production dependencies.

Residual risk: a version bump changes the framework itself; every route was
recompiled locally with webpack (see FINAL report) and the app's own APIs are
unchanged, but production build/prerender is verified by the Vercel rebuild.

### 3.2 High — `sharp` 0.35.3 (Fixed)

libheif and librsvg memory-safety advisories, fixed in 0.35.5. **Fix:** `sharp`
→ `^0.35.5`.

### 3.3 High — `xlsx` 0.18.5 (Fixed by switching to the official distribution)

Prototype pollution (GHSA-4r6h-8v6p-xvw6) and ReDoS (GHSA-5pgg-2g8v-p4x9) in
`xlsx@0.18.5`; npm never published a fix (SheetJS moved to
`cdn.sheetjs.com`). **Fix:** dependency now resolves to
`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`. Verified with a
write→read round-trip (`XLSX.utils`, `XLSX.read`, `XLSX.write` are the only APIs
this repo uses, 43 call sites, all unchanged in 0.20).

Note for CI/Vercel: `npm ci` now reaches `cdn.sheetjs.com`; if that host is
blocked in a build environment the install fails loudly rather than silently
falling back to the vulnerable npm package.

### 3.4 High — cron routes fail open when `CRON_SECRET` is unset (Fixed)

All five `/api/cron/*` routes compared `authorization !== \`Bearer ${CRON_SECRET}\``.
With the env var missing, that template string is the literal `"Bearer undefined"`,
so anyone sending that header passed — on routes that rewrite orders, poll
tracking and write backups with the service-role client. The comparison was also
not constant-time.

**Fix:** shared `src/lib/auth/cron-auth.ts` → `isCronAuthorized()`, which returns
`false` when the secret is unset and uses `crypto.timingSafeEqual` otherwise.
All five routes now call it.

### 3.5 High — stored XSS in HR letter bodies (Fixed)

`hr_letters.body_text` is rich-text HTML from a `contentEditable` editor and was
rendered with `dangerouslySetInnerHTML` in two places
(`records/[id]/issued-letter-view.tsx`, `[slug]/letter-form.tsx`) with no
sanitisation. Pasting from an arbitrary web page could store
`<img onerror=…>`/`<script>`/`javascript:` links that fire for every HR user who
opens the letter, and the same HTML is fed to the Word/PDF export.

**Fix:** new `src/lib/hr-letters/sanitize-body-html.ts` (allowlist via
`sanitize-html@2.18.1`: only the editor's own tags, `style` limited to safe
properties, links limited to http/https/mailto/tel, images/scripts/iframes
dropped, `rel="noopener noreferrer nofollow"` forced). Applied on **write**
(`issueHrLetter`, `updateIssuedHrLetter`) and on **read** (issued-letter page),
so rows stored before this change are also safe. 7 new unit tests.

### 3.6 Medium — no security response headers (Fixed)

The app sent no `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`,
`Permissions-Policy`, `X-DNS-Prefetch-Control` or HSTS. **Fix:** a
`headers()` block in `next.config.ts` for `/:path*`. `X-Frame-Options` is
`SAMEORIGIN` (not `DENY`) because the Orders hub and every print preview embed
same-origin dashboard pages via `?embed=1`.

### 3.7 Low — 2 permanent lint warnings (Fixed)

`_prev` / `_formData` in `bill-payment/merge-actions.ts` are required by the
`useActionState` signature but intentionally unused. **Fix:** the ESLint config
now honours the codebase's existing leading-underscore convention
(`argsIgnorePattern`/`varsIgnorePattern`/`caughtErrorsIgnorePattern: "^_"`)
instead of leaving main permanently yellow. `npm run lint` is now 0 problems.

### 3.8 Transitive dev-only dependencies (Open, low)

`npm audit` still lists 16 moderate findings, all build/lint toolchain
(`brace-expansion`, `js-yaml`, `nanoid`, `source-map-js`, `minimatch` and their
parents under ESLint/Next tooling). They are not shipped to the browser bundle
and have no production exposure; `npm audit fix --force` would break the
toolchain majors. Tracked for the next toolchain upgrade.

### 3.9 Quality findings — no change (Accepted)

| Finding | Why it stays |
|---|---|
| `dangerouslySetInnerHTML` in `hr-letters/[slug]/letter-form.tsx` live preview | It renders the same editor state the sanitizer now guards on save; the preview is the user's own unsaved input in their own session. Sanitising on read covers every persisted string. |
| 97 `eslint-disable` comments | 28 `react-hooks/exhaustive-deps`, 25 `no-img-element` (remote/Storage URLs, print documents), 18 `set-state-in-effect`. Each is annotated; converting them is a refactor, not a fix. |
| Tracked scratch files (`CHANGES.txt`, `README-UPDATE.txt`, `UPDATED-FILES.txt`, `claude/*.md`, root `2026-09-20-*.sql`) | Owner-authored notes/history. Deleting them is destructive and was not requested; the stray root SQL is documented in `db/MIGRATIONS.md` guidance instead. |
| No rate limiting on most Server Actions / document routes | Requires shared state (Upstash/DB counter) not present in the project. `companion-chat` already limits per-employee. Listed in `SECURITY.md` as a gap. |
| No CSP | App Router inline bootstrap scripts need per-request nonces; shipping a blind policy would break the app. Documented as the next hardening step. |
| 74 tables of RLS policies are not covered by automated access-control tests | Out of reach without a seeded multi-company database fixture; flagged in `SECURITY.md` "Known gaps". |

## 4. Remaining migration debt (Open, operational)

Two dated migrations are committed but **not yet applied to production
Supabase**: `db/2026-11-03-vendor-agreements.sql` and
`db/2026-11-03b-return-approval.sql`. Until they run, the Returns page shows a
"run this migration" banner (refunds keep working) and the Agreement Generator
cannot create documents.
