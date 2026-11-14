# Indian Customs Exchange Rate Module

Official Indian Customs (CBIC / ICEGATE) currency conversion rates for
valuation under the Customs Act, 1962 — stored as an effective-dated,
import/export-separate register, with verification, history, audit and a
conversion calculator.

- Dashboard: `/dashboard/customs-rates`
- API: `GET /api/customs-rates?currency=USD&date=2026-11-14`
- CSV export: `GET /api/customs-rates/history?currency=USD&from=…&to=…`
- Scheduled check: `GET /api/cron/sync-customs-rates`
- Migration: `db/2026-11-14-customs-exchange-rate-module.sql`

---

## 1. What the official source actually provides

This matters because the module must never pretend an integration exists.

| Source | What it publishes | Machine-readable? |
|---|---|---|
| **ICEGATE ERAM** — `/new-initiatives/exchange-rate-automation-module` | A descriptive page: ICEGATE receives rates from SBI, publishes them on icegate.gov.in twice a month | **No.** No public API, JSON/CSV feed or rate table on that page (checked 2026-11-14) |
| **ICEGATE services screen** (`foservices.icegate.gov.in`) | The rates, rendered by a client-side Angular app | No public feed |
| **CBIC** (`cbic.gov.in`) | The rate notifications, and a link to ICEGATE | Documents/PDF, not a feed. It was not reachable from the build environment |

CBIC publishes on the **1st and 3rd Thursday** of the month; rates are put up
at **18:00 IST** and take effect **from midnight the next day**. Extra
notifications are issued when a currency moves more than ±5%.

Consequences implemented here:

1. The automatic engine **monitors** the official page and parses a published
   rate table/document **only if one appears**. It does not call an undocumented
   endpoint or bypass any access control.
2. When nothing machine-readable exists it records `source_unavailable` with the
   exact reason, and the dashboard asks an administrator to upload the
   notification.
3. **No substitute rates.** RBI reference rates, Google/XE/live forex and bank
   settlement rates are never written to this register.
4. An optional feed can be configured (`CUSTOMS_RATE_FEED_URL`) if an
   authorized official endpoint is ever issued. There is no default and no
   guessed URL.

> **Live-integration status:** the module has been exercised end-to-end against
> its own database contract, but no automatic import has been verified against
> an official ICEGATE/CBIC data feed, because no public machine-readable feed
> exists. Do not describe auto-import as "live" until one does.

---

## 2. Data model

`customs_exchange_rates` — one row per currency per notification:

| Column | Notes |
|---|---|
| `currency_code`, `currency_name`, `currency_unit` | unit is 1, 10, 100 or 1000 — stored, never guessed at read time |
| `import_rate`, `export_rate` | `numeric(18,8)`, positive, stored exactly as published (never rounded) |
| `effective_start_date`, `effective_end_date` | end stays NULL while the rate is open-ended; history uses ranges |
| `notification_no`, `notification_date` | official reference |
| `source`, `source_url`, `source_document_ref`, `source_checksum` | provenance; checksum is SHA-256 of the ingested file |
| `verification_status` | `pending` · `verified` · `rejected` · `source_unavailable` · `extraction_failed` · `superseded` |
| `extraction_confidence`, `validation_notes`, `raw_payload` | why a row is pending |
| `verified_by`, `verified_by_name`, `verified_at`, `supersedes_id` | approval trail |

Companion tables:

- `customs_exchange_rate_audit` — append-only: insert / approve / reject /
  supersede / upload / sync, with actor.
- `customs_rate_sync_log` — every attempt: outcome, provider, counts, message.
- `customs_rate_snapshot` — the **old** per-currency cache used by the Exchange
  Rate Master page (`src/lib/fx/customs.ts`). The migration renames the previous
  `customs_exchange_rates` snapshot to this name; no rows are dropped.

Integrity rules enforced in the database:

- one **verified** row per (currency, effective date);
- one row per (source checksum, currency) — a re-uploaded document cannot
  duplicate figures;
- a **verified** row's rates, currency, unit, dates and notification cannot be
  updated, and a verified row cannot be deleted (trigger
  `customs_exchange_rates_guard`). Corrections are new rows that supersede the
  old one, which is archived as `superseded`;
- `get_customs_exchange_rate_as_of(currency, date)` returns the verified row in
  force on that date — execute is granted to `service_role` only.

---

## 3. Ingestion workflow

`src/lib/customs/ingest.ts`

1. Check the configured feed (if any), then ICEGATE, then CBIC availability.
2. Download only official-domain rate documents the page links (≤10 MB); parse
   PDF (layout text) or CSV.
3. Parse → `ExtractedRate[]` (`parse.ts`).
4. Validate every row (`validate.ts`): supported currency, positive rate,
   precision ≤ 8 decimals, explicit/derived unit, valid start/end dates,
   notification reference, duplicate detection inside the batch, and an
   "unexpected change" check (>20% move vs the last verified rate).
5. Store: official structured feed rows that are complete and clean may be
   written as `verified`; **everything parsed from a PDF or uploaded by an
   administrator is `pending`**.
6. Record an audit row per insert and a sync-log row per run.

The sync log's `source_unavailable` result is the normal outcome today, and is
shown on the dashboard as an alert with the reason, plus a pointer to upload.

### CSV format (administrator upload)

Any column order; header names are matched loosely (case/space/underscore
insensitive). Recognised headers:

```
Currency, Currency Unit, Import Rate, Export Rate,
Effective Start Date, Effective End Date,
Notification No, Notification Date
```

`Currency` accepts an ISO code (`USD`) or the CBIC name (`US Dollar`,
`Japanese Yen (100)`). Rates are read as decimal strings, so
`88.65432100` is stored exactly. A "fallback effective date" field on the form
covers files that omit the date.

### PDF upload

Accepts the CBIC notification PDF (or a `.txt` copy of its table). Extraction
reads lines containing a currency and its two rate columns; it is best-effort
by design, which is why PDF rows are always pending and show their confidence
and validation notes before approval.

---

## 4. API

```http
GET /api/customs-rates?currency=USD&date=2026-11-14
Cookie: <Supabase session>
```

Requires a signed-in employee whose role has `customs_rate_view` or
`customs_rate_admin`. Bulkhead: 60 requests/minute per employee (best-effort,
per server instance).

**200** (values illustrative placeholders — not actual rates):

```json
{
  "currency": "USD",
  "requestedDate": "2026-11-14",
  "effectiveFrom": "YYYY-MM-DD",
  "effectiveTo": null,
  "importRate": 0,
  "exportRate": 0,
  "currencyUnit": 1,
  "source": "ICEGATE / CBIC",
  "sourceRecord": "admin_csv",
  "sourceUrl": null,
  "sourceDocumentReference": "30-2026.pdf",
  "notificationNumber": "30/2026",
  "notificationDate": "YYYY-MM-DD",
  "verificationStatus": "verified",
  "verifiedAt": "YYYY-MM-DDTHH:MM:SSZ"
}
```

| Status | Meaning |
|---|---|
| 400 | missing/invalid currency or date (`supportedCurrencies` included) |
| 401 | no session |
| 403 | role lacks the capability |
| 404 | no **verified** rate covers that date — nothing is substituted |
| 429 | rate limit; `Retry-After` header |
| 503 | migration not applied |

`Cache-Control: private, no-store` on every response.

---

## 5. Verification & approval

1. Upload a CSV/PDF, or run a sync.
2. Dashboard → **Admin controls → Review pending rates**.
3. **Approve** writes `verification_status = verified`, stamps the approver and
   time. If a verified row already exists for the same currency and effective
   date with different figures, it is archived as `superseded` and the new row
   records `supersedes_id`.
4. **Reject** requires a reason; the row stays with `rejected` and the note.

Nothing pending is ever used by the API or calculator.

---

## 6. Calculator

`INR = amount × rate` — and when `currency_unit = 100`, `INR = amount × rate / 100`
using the row's stored unit. It shows the amount, code, rate, rate-per-unit,
effective date/period, notification and source. It is explicitly labelled as
the Customs rate, not a bank/RBI/payment rate.

---

## 7. Scheduling

`GET /api/cron/sync-customs-rates` requires `Authorization: Bearer $CRON_SECRET`
and is safe to call repeatedly (it only records checks; duplicates are blocked).
`src/lib/customs/schedule.ts` decides "is a check due?" (12-hour staleness, plus
Thursday after 18:00 IST unless that window was already checked).

**Vercel:** this project already uses its two cron slots. Vercel's Hobby plan
caps a project at two cron jobs and rejects a deployment that adds a third, so
`vercel.json` deliberately has **not** been changed. On a plan that allows more,
add:

```json
{
  "path": "/api/cron/sync-customs-rates",
  "schedule": "30 12 * * *"
}
```

(12:30 UTC = 18:00 IST, right after the publication window.) On Hobby, replace
one existing entry or use the Supabase option below.

**Supabase (pg_cron + pg_net), if you prefer not to consume a Vercel slot:**

```sql
-- Run once in the Supabase SQL editor. Store the secret in Vault first.
select cron.schedule(
  'sync-customs-rates',
  '30 12 * * *',
  $$
    select net.http_get(
      url     := 'https://<your-domain>/api/cron/sync-customs-rates',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
      )
    );
  $$
);
```

Until either is configured, the dashboard's **Sync now** button performs the
same check on demand and the status card names the next expected check.

---

## 8. Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | yes | already required by the app |
| `CRON_SECRET` | for cron | bearer auth for `/api/cron/sync-customs-rates` |
| `CUSTOMS_RATE_FEED_URL` | optional | an **authorized** machine-readable feed; unset by default |
| `CUSTOMS_RATE_FEED_PROVIDER` | optional | `icegate` (default) / `cbic` (may auto-verify clean rows) / `mirror` (always pending) |

Never commit real keys. The service-role key is server-only and must not be
prefixed `NEXT_PUBLIC_`.

---

## 9. Security

- Session + capability on the API, CSV export, page and every action; all
  mutations call `requireCapability("customs_rate_admin")` server-side.
- RLS is enabled **and forced** on all three module tables with no
  `authenticated` policy, and `anon`/`authenticated` are revoked — access is
  service-role-only from capability-checked server code.
- Uploads: ≤10 MB, extension and PDF magic-byte checked, checksummed.
- Verified rates are immutable in the database; audit trail is append-only.
- No service-role key or rate document reaches the browser.

---

## 10. Tests

```bash
npm test          # node --import tsx --test "src/**/*.test.ts"
```

Module coverage:

| File | Covers |
|---|---|
| `src/lib/customs/validate.test.ts` | currencies, rates/precision, units, dates, confidence, CSV/PDF always pending, unexpected-change review, batch duplicates |
| `src/lib/customs/lookup.test.ts` | as-of-date selection, inclusive boundaries, unverified rows excluded, no backward fallback, date validation |
| `src/lib/customs/calculator.test.ts` | per-1 and per-100 conversion, rounding, invalid inputs |
| `src/lib/customs/parse.test.ts` | CSV/TSV headers, quoted fields, notification text, feed JSON, date normalisation |
| `src/lib/customs/schedule.test.ts` | staleness + Thursday publication window |
| `src/lib/customs/rate-limit.test.ts` | limit, block, window reset, per-key isolation |

Database-level behaviour (unique verified index, immutability trigger, audit)
is enforced by the migration. Run the migration on a scratch database and
attempt to update a verified rate's `export_rate` — it must raise.

---

## 11. Deployment checklist

1. Run `db/2026-11-14-customs-exchange-rate-module.sql` in the Supabase SQL
   editor (it renames the old snapshot table and creates the register).
2. Confirm **Admin → Database / Migrations** no longer lists this file as
   pending.
3. Grant `customs_rate_view` / `customs_rate_admin` to any additional roles via
   **Roles & Permissions** (Admin, MD and — for viewing — Finance and Logistics
   are seeded).
4. Set `CRON_SECRET` if you enable the scheduled route.
5. Deploy, open `/dashboard/customs-rates`, upload the current official
   notification, approve the rows, then verify the API for a date inside and
   outside the notification's range.

### Rollback

No down-migration. The rename is the only destructive-looking step and it
preserves every row. To reverse it manually:

```sql
-- only if you have NOT yet written any rows into the new register
DROP TABLE IF EXISTS customs_exchange_rates CASCADE;
ALTER TABLE customs_rate_snapshot RENAME TO customs_exchange_rates;
```
