# Etsy International SEO Generator

One English rug listing → ten independently researched, locally written Etsy listings
(title ≤140, exactly 13 tags × ≤20 characters, full description, localized image alt text),
each passing a deterministic validation report, exportable as Excel / CSV / JSON.

Module path: **`/dashboard/etsy-seo`** · capability **`etsy_seo_generator`** · migration
**`db/2026-11-18-etsy-seo-generator.sql`**.

> This module lives inside the NYKO MART OMS rather than as a separate app, because the OMS
> already provides Supabase Postgres, Supabase Auth, company scoping, RBAC capabilities,
> audit logging and deployment. Re-implementing those would add risk without adding a
> feature. The spec's table names (`products`, `users`, `projects`) are prefixed `etsy_seo_`
> so they cannot collide with the OMS's own tables; "user" = the signed-in employee,
> "company" = the OMS company.

---

## 1. Architecture

```
Browser (dashboard/etsy-seo)
  │  Server Actions: saveSeoProject, saveListingEdits, uploadSeoImage, addSeoCategory
  │  POST /api/etsy-seo/generate             one language (title|description|tags|all)
  │  POST /api/etsy-seo/alt-text             one image → all ten languages (vision)
  │  POST /api/etsy-seo/research/keywords    one market
  │  POST /api/etsy-seo/research/competitors one competitor
  │  POST /api/etsy-seo/validate             deterministic revalidation (no AI)
  │  GET  /api/etsy-seo/export               json | csv | keywords | xlsx
  │  GET/PUT/POST /api/etsy-seo/settings     config + encrypted keys + provider test
  │  GET  /api/etsy-seo/usage                paginated usage + month-to-date totals
  ▼
lib/etsy/ai/ai-provider.manager.ts
  ├── GeminiProvider (@google/genai)         primary, retries, alternate model
  └── OpenRouterProvider (fetch)             optional backup
        ↓ every attempt (success OR error)
     etsy_seo_usage_logs (provider, model, tokens, cost, latency, error)
  ▼
lib/etsy/ai/schemas.ts   strict JSON parsing + hard-limit repair
  ▼
lib/etsy/seo-validation.ts   deterministic checks + 0–100 score (no AI)
  ▼
etsy_seo_listings / etsy_seo_listing_versions
```

Why one request per language: the ten-language run is a client loop. A slow or failing
market cannot discard the other nine, the UI gets real per-language progress, and no single
serverless invocation comes close to its timeout. Each listing records the provider, model
and `backup_used` flag, so a fallback is never silent.

### Provider fallback (spec §18)

1. Gemini, configured model → (transient error) exponential-backoff retry → (invalid JSON or
   schema violation) one repair pass quoting the exact failing checks.
2. Next configured Gemini model (default: `gemini-flash-lite-latest` as the alternate).
3. If backup is enabled **and** OpenRouter is configured: the same structured request goes to
   OpenRouter, validated by the same parser.
4. Anything else → the request fails with a real error. **No path returns success without a
   provider producing valid content**, and nothing is written to the listing tables until
   validation passes.

Model IDs come from Settings (`etsy_seo_settings.primary_model` / `backup_model`) or
`GEMINI_MODEL_ID` / `OPENROUTER_MODEL_ID`, with documented defaults as the last resort.
`checkHealth()` makes a real call (cached 5 minutes) — "key present" is never reported as
"working".

---

## 2. Database (ER overview)

```
companies ─┬─ etsy_seo_settings        (1:1  provider/backup/budget config)
           ├─ etsy_seo_credentials     (1:N  encrypted provider keys, unique per provider)
           ├─ etsy_seo_categories      (1:N  admin-extendable category list)
           └─ etsy_seo_projects        (1:N  one per English source listing)
                    ├─ etsy_seo_listings          (unique project_id+language_code → 10 rows)
                    │     └─ etsy_seo_listing_versions (history on every save/regeneration)
                    ├─ etsy_seo_keywords          (per market, verified flag, no invented metrics)
                    ├─ etsy_seo_competitors       (user-provided public info only)
                    ├─ etsy_seo_jobs              (progress/retry bookkeeping)
                    └─ etsy_seo_usage_logs        (every provider attempt, cost, latency)
```

Key constraints: `UNIQUE (project_id, language_code)` (one row per market),
`UNIQUE (company_id, sku)` on projects when a SKU is given,
`UNIQUE (listing_id, version)`, indexes on `(company_id, updated_at)` and
`(project_id, language_code)`.

Row Level Security is enabled on every table with company-scoped policies via
`etsy_seo_can_read_company()`. The application itself uses the service-role client only
**after** `requireCapability('etsy_seo_generator')` and scopes every query by company id;
RLS is defence in depth (a leaked anon key cannot read another company's copy). Credentials
are stored as AES-256-GCM ciphertext and are never selected into any response.

Storage: bucket **`etsy-product-images`** (public read, because the vision model fetches the
photo by URL; uploads always go through the capability-checked server action).

---

## 3. API contracts

All endpoints require a signed-in employee with `etsy_seo_generator`, return
`{ error, code?, issues? }` on failure, and are rate limited per employee.

| Method | Path | Body / query | Notes |
|---|---|---|---|
| POST | `/api/etsy-seo/generate` | `{ projectId, languageCode, field }` | `field`: `all` \| `title` \| `description` \| `tags`. Returns the saved listing + validation report. |
| POST | `/api/etsy-seo/alt-text` | `{ projectId, imageIndex }` | One vision call → ten alt texts; updates existing listings only. |
| POST | `/api/etsy-seo/research/keywords` | `{ projectId, languageCode, fileText? }` | AI suggestions (unverified) + optional user file (verified metrics). |
| POST | `/api/etsy-seo/research/competitors` | `{ projectId, languageCode, competitorUrl?, competitorTitle?, competitorTags?, competitorKeywords? }` | Patterns only; no private metrics claimed. |
| POST | `/api/etsy-seo/validate` | `{ projectId }` or `{ listingId }` | Deterministic, zero AI cost. |
| GET | `/api/etsy-seo/export` | `?projectId=&format=json\|csv\|keywords\|xlsx` | UTF-8 (CSV with BOM). |
| GET | `/api/etsy-seo/settings` | — | Never returns a key; reports the source of each key. |
| PUT | `/api/etsy-seo/settings` | `{ primaryModel?, backupEnabled?, backupModel?, monthlyBudgetUsd?, geminiApiKey?, openRouterApiKey? }` | Keys are encrypted before storage. |
| POST | `/api/etsy-seo/settings` | `{ test: "gemini" \| "openrouter" }` | Real provider health call. |
| GET | `/api/etsy-seo/usage` | `?page=&pageSize=&projectId=` | Month-to-date totals, unknown-cost count. |

Implemented as Server Actions (not listed above): create/update project, save listing edits
(with version history + revalidation), upload image, add category, delete project.

---

## 4. Validation & scoring (no AI)

`src/lib/etsy/seo-validation.ts` — pure functions, covered by
`src/lib/etsy/seo-validation.test.ts`.

| Category | Points | Checks |
|---|---|---|
| Title | 20 | exists, ≤140, not all caps, no repeated word, `% : & +` at most once |
| Keywords | 20 | primary in title, primary covered by tags, secondary keywords used |
| Tags | 20 | exactly 13, each ≤20, no duplicates, no empty slots |
| Description | 15 | exists, ≥400 chars, readable sections, no repeated paragraph |
| Localization | 10 | locale matches, correct script (JP/RU), no untranslated English |
| Alt text | 10 | one per image, ≤250 chars, not stuffed |
| Duplicates | 5 | primary keyword not stuffed, no repeated tag phrases |

`pass` requires every **mandatory** check (missing title/description, wrong tag count, tag
over 20, duplicates, locale mismatch, alt text over 250, repeated paragraph) to pass;
otherwise `warning` or `fail`. The score is a quality checklist — not Etsy's ranking score,
and the UI says so.

Etsy's published limits used here: title 140 characters, 13 tags per listing, 20 characters
per tag, alt text ~250 characters
(<https://help.etsy.com/hc/en-us/articles/360000336307>, <https://help.etsy.com/hc/en-us/articles/115015628707>).
The older `/dashboard/etsy-translations` module allowed 29-character tags; this module uses
the correct 20 and the shared validator now enforces 20 everywhere.

---

## 5. Research provenance

Every keyword row carries `source`, `verified`, `search_volume`, `competition`,
`confidence`, `source_url`, `researched_at`.

* `source = "ai"` → `verified = false`, all metrics `null`, displayed and exported as
  **"AI Suggested – Search Volume Not Verified"**.
* `source = "user_file"` with a real volume/competition → `verified = true`.
* Search-API / eRank / EverBee / Etsy autocomplete adapters are declared in
  `src/lib/etsy/research.ts` with the env vars they need. They report **not configured**
  until an approved integration is added — no adapter fabricates metrics, and no Etsy
  scraping is performed (Etsy does not publish an autocomplete API; using it needs written
  permission).

---

## 6. Environment variables

See the block at the end of `.env.example`. Required: `GEMINI_API_KEY` (plus the existing
Supabase trio). Optional: `GEMINI_MODEL_ID`, `OPENROUTER_API_KEY`, `OPENROUTER_MODEL_ID`,
`SEARCH_API_KEY`, `RESEARCH_PROVIDER_API_KEY`, `APP_BASE_URL`, `ENCRYPTION_KEY` (only if you
store company keys from Settings), and the `*_PRICE_*` cost overrides.

Keys are server-side only. A per-company key saved from Settings is encrypted with
`ENCRYPTION_KEY`; no endpoint or page ever returns it.

---

## 7. Local setup

```bash
npm ci
cp .env.example .env.local        # fill Supabase + GEMINI_API_KEY
# Supabase → SQL editor:
#   db/2026-11-18-etsy-seo-generator.sql   (tables, RLS, capability, bucket, categories)
#   db/2026-11-17-etsy-translations.sql    (only if you also use the older module)
#   db/2026-11-16c-office-asset-expenses.sql (P&L views, unrelated but re-runnable)
npm run dev
# → /dashboard/etsy-seo as an MD/Admin login (or grant etsy_seo_generator to another role)
```

Without `GEMINI_API_KEY` the page loads and shows the provider as missing; generation returns
HTTP 503 with a setup message instead of fake content.

## 8. Deployment (Vercel + Supabase)

1. Apply the migration in the production Supabase project (SQL editor).
2. Vercel env: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, optionally `OPENROUTER_API_KEY` +
   `OPENROUTER_MODEL_ID`, `OPENROUTER_PRICE_*`, `ENCRYPTION_KEY`, `APP_BASE_URL`.
3. Deploy; open `/dashboard/etsy-seo` → AI usage & settings → **Test Gemini** and, if
   configured, **Test OpenRouter**.
4. Generate one language end-to-end and export the workbook before announcing the module.

### When generation fails: what the UI tells you

`lib/etsy/ai/diagnostics.ts` maps every provider failure to one diagnosis — a headline,
the env var to fix and whether a retry can help. API responses carry the same fields
(`error`, `code`, `title`, `fix`, `envVars`, `provider`, `retryable`, `detail`), and the UI
shows `error` plus `Fix: …`; no response ever contains a key.

| Diagnosis | `code` | What to fix |
|---|---|---|
| Gemini rejected the API key | `invalid_api_key` | Replace `GEMINI_API_KEY` (401/403), then redeploy |
| OpenRouter rejected the API key | `invalid_api_key` | Replace `OPENROUTER_API_KEY`; a company key in Settings overrides env |
| API key missing | `provider_not_configured` | Add `GEMINI_API_KEY` (or `OPENROUTER_API_KEY`) and redeploy |
| Model id missing | `model_not_configured` | Set `OPENROUTER_MODEL_ID` — a key alone is not usable |
| Model not found / retired | `model_not_found` | Correct `GEMINI_MODEL_ID` / `OPENROUTER_MODEL_ID` (exact slug) |
| Quota or credits used up | `quota_exceeded` | Wait or raise quota; top up OpenRouter credits. 429, retryable |
| Provider unavailable (5xx) | `provider_unavailable` | Retry; automatic backup covers it when configured |
| Timed out | `timeout` | Retry; prefer a Flash/Lite model. 504, retryable |
| Output failed the JSON contract twice | `invalid_output` | Retry; choose a stronger model if it repeats |

`Settings → Test Gemini / Test OpenRouter` returns the same mapping, so a failed health
check names the broken setting instead of dumping the vendor body.

**Rollback:** revert the deployment to the previous build. The module is additive — dropping
it leaves every other OMS screen working. To remove its data:
`DROP TABLE etsy_seo_usage_logs, etsy_seo_jobs, etsy_seo_competitors, etsy_seo_keywords,
etsy_seo_listing_versions, etsy_seo_listings, etsy_seo_projects, etsy_seo_credentials,
etsy_seo_settings, etsy_seo_categories CASCADE;` and delete the `etsy-product-images`
bucket. The `etsy_seo_generator` capability row can stay (it simply stops resolving).

---

## 9. Tests

```bash
npm test        # node:test via tsx
npx tsc --noEmit
npm run lint
npm run build
```

Covered: title 140/141/empty/all-caps, tags 13/12/14, tag 20/21, duplicates, empty slots,
locale mismatch, wrong script (RU/JA), alt text 250/251, repeated paragraphs, ten-language
set (missing/duplicate/unsupported/wrong locale), provider matrix (Gemini success, timeout
retry, rate limit → OpenRouter, alternate Gemini model, invalid JSON repair, auth error,
backup disabled, all providers failing), CSV/JSON export with Japanese and Russian text.

The alt-text vision path has its own suite (`src/lib/etsy/ai/alt-text-vision.test.ts`):
the photo really being inlined into the Gemini request, all ten languages in one reply,
unknown-language entries dropped, over-250-character text cut at a word boundary, a reply
missing a language getting exactly one repair pass (and failing loudly if the repair also
misses one), plus `fetchImageForVision` rejecting non-images, 404s and photos over 8 MB.

### Live smoke test (real API)

```bash
GEMINI_API_KEY=… npm run smoke:etsy-seo                    # German listing + export
ETSY_SMOKE_LANGUAGE=ja GEMINI_API_KEY=… npm run smoke:etsy-seo
```

Runs one real generation through the same prompt → manager → parser → validator pipeline
the route uses, then writes the JSON, CSV (UTF-8 BOM) and XLSX exports to
`artifacts/etsy-seo-smoke/` (git-ignored) and prints provider, model, tokens, latency and
estimated cost. Set `OPENROUTER_API_KEY` + `OPENROUTER_MODEL_ID` to exercise the real
backup. It refuses to run without a key (exit 2) and fails if the API key appears in any
exported file or if the listing fails validation. It spends credits — one call, plus a
repair attempt or the fallback when needed.

**Still needs a live check**: the visual UI. Model quality can only be judged from the
smoke-test output.

## 10. Known limitations

* WhatsApp/Etsy upload is not automated: exports are copy/download, Etsy has no public
  listing-create API for this use case.
* Search-API / eRank / EverBee adapters are interfaces only until an approved API is chosen;
  keywords are therefore AI-suggested unless a file with real metrics is uploaded.
* The rate limiter is per serverless instance (the durable cost control is the monthly
  budget in Settings).
* Generation is a foreground client loop of ten requests; there is no queue worker. A closed
  tab stops the loop (already-saved languages are kept).
* Version history is stored but the UI shows the latest version only (previous rows are
  available with a query).
* `estimated_cost_usd` is `NULL` for models without a published price — the UI shows "—".
