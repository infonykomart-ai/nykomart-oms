# Nyko Mart / Rugara / CASA ARRA — Order Management System

Full rewrite of the original Google Sheets + Apps Script OMS into a real
web app: **Next.js (App Router, TypeScript) + PostgreSQL via Supabase**,
deployed on Vercel. Replaces `gscript/Code.gs` + `gscript/Index.html` in the
repo root (kept there for reference during the migration, not deleted).

## Why this exists

The Sheets version works but degrades as data grows — live formulas
recalculating across thousands of rows, SUMPRODUCT/array formulas, and the
cell-count ceiling all get worse with scale. This rewrite keeps every
business rule from the old system (see `db/SCHEMA_NOTES.md` for the full
sheet → table mapping) on a real database instead.

## Status

Early build — see the project's task list for what's done vs. pending.
**"Poori parity" is the target**: nothing is considered launch-ready until
every module from the old system (order entry, dispatch, stock, bill pass,
P&L dashboard, HR/attendance, document generation, CRM, etc.) has a working
equivalent here.

## Stack

- **Frontend + Backend**: Next.js 16 (App Router, Server Actions, Turbopack)
- **Database**: PostgreSQL via [Supabase](https://supabase.com) (also
  provides auth + file storage)
- **Hosting**: [Vercel](https://vercel.com), auto-deploys from `main`

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in your Supabase project's URL + keys
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Database schema

`db/schema.sql` is the full PostgreSQL schema (45 tables, 11 views,
trigger-based document numbering) — apply it to a fresh Supabase project via
the SQL Editor, or `psql "$SUPABASE_DB_URL" -f db/schema.sql`. Read
`db/SCHEMA_NOTES.md` first — it explains every design decision and lists
open questions (most now resolved; a few genuinely deferred to a later
migration step).

### Local schema checks (no Supabase needed)

This repo's schema/type changes are validated against a local disposable
Postgres instead of a live Supabase project, so schema mistakes get caught
before ever touching real data:

```bash
createdb oms_test
psql -d oms_test -f db/schema.sql        # should apply with zero errors
GEN_TYPES_DB_URL="postgresql://postgres:postgres@localhost:5432/oms_test" \
  node scripts/gen-types.mjs             # regenerates src/types/database.ts
npx tsc --noEmit                          # type-check
npm run build                             # full production build
```

`scripts/gen-types.mjs` is a stand-in for `supabase gen types typescript`
(that CLI subcommand needs a working Docker daemon, which this sandbox
didn't have) — re-run it after every `db/schema.sql` change.

## Project structure

```
src/
  app/                 App Router pages (one route per module)
  components/          Shared UI (dashboard header/sidebar, form primitives)
  lib/
    supabase/           Browser + server Supabase clients
    auth/                requireCapability() — server-side capability gate,
                          the direct port of the old requireCapability_()
    capability-info.ts   Dashboard tile metadata (icons/labels/routes)
  types/database.ts     Generated from db/schema.sql — do not hand-edit
db/
  schema.sql             Full PostgreSQL schema
  SCHEMA_NOTES.md         Design rationale + old-sheet -> new-table mapping
scripts/
  gen-types.mjs           Local type generator (see above)
```

## Business rules ported from the old system

Every rule the user explicitly asked for is preserved — see comments in
`db/schema.sql`'s "BUSINESS RULES ENFORCED IN APPLICATION CODE" block and
`src/lib/auth/require-capability.ts`:

- No stock movement without a Chalan No.
- Duplicate-order detection: same buyer + same Order No. already dispatched
  reuses the existing PO/RF/RG No. instead of creating a new one.
- PO/RF/RG numbers and document numbers (Credit Note, Debit Note, etc.) are
  reserved atomically, only at actual save time — never at form-preview
  time — so no permanent gaps in the sequence.
- Capability-based access control re-checked server-side on every
  privileged action, never trusting a client-side check alone.
