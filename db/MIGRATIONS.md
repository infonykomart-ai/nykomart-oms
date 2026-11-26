# Migrations — process, ledger and data policy

This is the operating manual for everything in `db/`. Read it before adding,
editing, or running anything here.

---

## 1. Two tracks, deliberately different

| Track | File shape | How it is applied | Re-runnable? |
|---|---|---|---|
| **Cumulative schema** | `db/schema.sql` | From scratch on a new database | Yes — it is the definition of a fresh DB |
| **One-time patches** | `db/YYYY-MM-DD[-letter]-name.sql` | By hand, in the Supabase SQL Editor, **once** | Written to be idempotent, but never replayed on a fresh schema |

`db/schema.sql` is the **single source of truth**. Every dated patch's changes
get folded back into it once shipped. The CI `schema-check` job exists to prove
that claim on every push: it applies `schema.sql` to a throwaway Postgres 16,
creates the Supabase roles (`authenticated`, `anon`, `service_role`) that the
RLS policies name, and runs `scripts/check-types-in-sync.mjs` to confirm the
committed `Database` types still cover the schema.

> **Why patches are not replayed:** a dated file is a delta against the DB *as
> it was on that date*. Running it on top of a schema that already has the
> change folded in fails with `already exists`, and the oldest files
> (`2026-08-05-*`) also reference Supabase's own `auth.users`, which does not
> exist in a plain Postgres. CI therefore validates `schema.sql` only — that is
> the meaningful regression test ("can a fresh environment be stood up from
> `schema.sql` alone"), not "replay 144 historical deltas".

---

## 2. Writing a new patch

1. **Name it** `db/YYYY-MM-DD-<slug>.sql` (add `a`, `b`, `c`… for several in one
   day). The date must be the date it is written, not the date it is run.
2. **Make it idempotent.** `IF NOT EXISTS` / `ON CONFLICT DO NOTHING` /
   `CREATE OR REPLACE`. Assume someone will run it twice.
3. **Header comment is mandatory.** Say what request it came from, what it
   changes, what it depends on (`MUST run AFTER …`), and what breaks if it is
   not applied.
4. **Update `schema.sql` in the same change.** The patch and the folded-back
   schema land together, or the CI `schema-check` job goes red.
5. **Add a probe entry** in `src/lib/migrations/probes.ts` (if it needs one; use
   `manualProbe()` for an index / RLS policy / data repair that the API cannot
   see). This is now enforced: `src/lib/migrations/coverage.test.ts` fails when
   a `db/*.sql` file has no probe entry.
6. **Regenerate the hash manifest** — `npm run migrations:manifest`. It writes
   `src/lib/migrations/manifest.ts` (file + SHA-256 for every patch), which the
   ledger compares against; the same test fails if it is stale.
7. **Verify before running it on production.** Read the plan it produces, run
   it against a restored snapshot first (see §5), and only then run it in the
   live SQL Editor.

---

## 3. How "is it applied?" is answered

Two layers, because they answer different questions.

**Layer 1 — probes: does the object exist?** Each tracked migration declares
the one object it creates (a column/table) or is marked `manual` when nothing is
API-visible (index, RLS policy, data repair):

- `src/lib/migrations/probes.ts` → `probeMigrations()` — powers the Admin page.
- `src/lib/db/schema-status.ts` → `SCHEMA_CHECKS` — the dashboard card's short list.

| Probe state | Meaning |
|---|---|
| `applied` | the object exists — the migration has been run |
| `missing` | PostgREST says the object does not exist — **run the SQL** |
| `unknown` | the check itself failed (network / auth / permissions) — **not** a pending migration |
| `manual` | nothing the API can verify — run it by hand if unsure |

Coverage is mechanical now: `src/lib/migrations/coverage.test.ts` fails when a
`db/*.sql` file has no probe entry, so a merged file cannot go invisible.

**Layer 2 — the ledger: which VERSION was applied?** Probes cannot tell a file
that was run from one that was **edited after it was run**. `schema_migrations`
(`db/2026-11-26-schema-migrations-ledger.sql`) records one row per file with the
file's SHA-256 at the moment it was recorded. `src/lib/migrations/manifest.ts`
(`npm run migrations:manifest`) holds the committed hashes, and
`src/lib/migrations/ledger.ts` compares the two:

| Ledger state | Meaning |
|---|---|
| recorded | applied per probe, hash matches the committed file |
| recordable | probe says applied, no ledger row yet — the page's button records it |
| drifted | the file changed after it was recorded — **re-run the current file** |
| conflict | recorded as applied, but this database does not have the object (restore / manual drop) |
| manual | nothing verifiable, so never recorded automatically |

A ledger row is only ever written after a fresh probe run confirms the object
is present ("/dashboard/admin/migrations" → *Record N verified files*), never
from memory. **Known limitation:** a `manual` file is therefore never recorded,
and a database that restored an old backup keeps its old hashes until the files
are re-run and re-recorded.

---

## 4. Rollback / forward-fix

There is no automated down-migration. The policy is **forward-fix**:

1. Never edit a patch that has already been run on production — its header
   becomes a lie. Write a new dated patch that corrects it.
2. If a patch has *not* been run yet, it is safe to edit in place.
3. Reversible DDL (add column, add index concurrently) can be undone with a
   follow-up patch; destructive DDL (drop column/table) requires an explicit
   backup snapshot taken immediately before.
4. `Admin → Backup` produces the snapshot used for both backup and restore.

---

## 5. Backups and restore testing

- **Schedule:** `.github/workflows/weekly-backup.yml` — Sunday 02:00 IST
  (`30 20 * * 6`), plus `workflow_dispatch` for a manual run.
- **What it does:** calls `/api/cron/backup-snapshot` with the `CRON_SECRET`
  bearer token. The route reads every table and writes
  `snapshot-<runId>.xlsx`, `snapshot-<runId>.pdf`, `manifest.json` to
  Cloudflare R2. **Nothing is stored in GitHub.**
- **Download:** `Admin → Backup` (via `/api/admin/backups/download`).
- **Required secrets:** `CRON_SECRET` (Actions secret, same value as the
  deployment's). R2 credentials live on the deployment only
  (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`,
  optional `R2_PREFIX`) — never in this repository.

**Restore is not the same as backup.** A backup that has never been restored is
an assumption. Before trusting it: download the newest snapshot, restore it into
a scratch database, and confirm row counts against the manifest. Do this at
least once before any production cutover, and ideally on a schedule.

---

## 6. Data policy — no production records in `db/`

**Rule: `db/` contains schema and migration *logic* only. Never real ledger
rows, payments, bills, orders, party/bank details, or employee records.**

This rule exists because this repository was public and the following had been
committed as SQL dumps. On 2026-10-26 they were **moved out of git** into
`.private-data/db/` (gitignored) — they still exist locally, they are simply no
longer tracked:

| Removed from `db/` | Kind of data |
|---|---|
| `2026-08-13i-etsy-ledger-lines-jan-jul-2026.sql` | Etsy ledger lines, Jan–Jul 2026 |
| `2026-08-13j-sale-profit-ledger...sql` | 493 real sale/P&L rows |
| `2026-08-17-payment-import-nyko.sql` | Nyko Mart bank payments (296 rows) |
| `2026-08-17-payment-import-rugara.sql` | Rugara bank payments |
| `2026-08-17-nyko-mart-bill-pass-import.sql` | 342 vendor bill-pass rows |
| `2026-08-17-rug-ara-bill-pass-import.sql` | 72 vendor bill-pass rows |
| `2026-08-17-party-master-cleanup-and-new-parties.sql` | Supplier / party names |
| `2026-08-17-dedupe-payment-import.sql` | Payment-row reconciliation |
| `2026-08-19-payment-ledger-reconciliation-round2.sql` | Bank reconciliation |
| `2026-08-18-aramex-ledger-reconciliation.sql` | Aramex account statement lines |
| `2026-08-18b-aramex-RJ2425004469-amount-fix.sql` | Single real invoice amount |
| `2026-08-20-rugara-freight-duty-import.sql` | 297 freight/duty rows |
| `2026-08-20-csb-filings-import.sql` | 71 CSB filing rows |
| `2026-08-20-vendor-ledger-round3-payments.sql` | Vendor payments |
| `2026-08-22-order-value-offline-file-fix.sql` | 655 order-value rows |
| `2026-08-12-party-bank-details.sql` | Vendor bank account details |
| `2026-08-12-courier-party-bank-details.sql` | Courier bank account details |
| `2026-08-05-employee-setup.sql` | 15 real employee logins + emails |
| `2026-08-05-diagnose-employee-link.sql` | Employee emails |
| `2026-08-05-fix-rd-lohra-role.sql` | Named individual's role |

**Important — deleting a file does not un-publish it.** These files remain in
git history (they were first committed well before this cleanup), so removing
them only stops *future* exposure. Truly erasing them requires a history rewrite
(`git filter-repo`) followed by a force-push, plus rotating anything that was
ever exposed. That is a coordinated, destructive operation and has deliberately
**not** been done — see `SECURITY.md`.

Where a one-time import genuinely has to be kept, put it in `.private-data/`
and reference it by name in the patch header instead of committing the rows.

**Never commit:** API keys, tokens, passwords, private keys, `.env*` files, or
database connection strings. Courier and marketplace credentials are encrypted
at rest by `src/lib/crypto/secret-box.ts` (AES-256-GCM) and read from
`process.env` — keep it that way.
