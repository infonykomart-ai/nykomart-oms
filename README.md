# Nyko Mart / Rugara / CASA ARRA — Order Management System

A private, multi-company Order Management System built for three real, currently-operating
export/marketplace businesses under one owner — **Nyko Mart**, **Rugara**, and **CASA ARRA**
(Jaipur, Rajasthan, India). They manufacture/source home-textile goods (rugs, kurtis, fabric
items) and sell through Amazon, eBay, Etsy (multiple shops per company), and direct/website
orders, exporting internationally.

This is a full rewrite of an earlier Google Sheets + Apps Script system into a real web
application — **Next.js (App Router, TypeScript) + PostgreSQL via Supabase**, deployed on Vercel.
Every business rule from the original system was ported over deliberately (see `db/SCHEMA_NOTES.md`
for the sheet → table mapping), not redesigned from scratch.

This repository and the software it contains are **proprietary** — see [`LICENSE`](./LICENSE).
It is not open source and is not intended for reuse outside these three companies.

**Developed by**: Mr. Gajanand Bhankariwal, Logistic Team Leader — bhankariwal@gmail.com · +91 99830 00552.

## Live deployment

- **Production**: https://nykomart-oms-oohq.vercel.app/ (Vercel, auto-deploys from `main`)
- **Database**: PostgreSQL via [Supabase](https://supabase.com) (Postgres + Auth + Storage)

## What it does

A day-to-day back office covering the full order lifecycle across all three companies, from one
login (a single sign-in can be granted access to one, two, or all three companies):

- **Order entry & lifecycle** — multi-currency order capture, automatic PO/RF/RG numbering per
  company, Hold/Cancel with reason tracking, buyer-batch grouping, order detail/view/download pages.
- **Dispatch & shipments** — Order Shipments & Packages (multi-package/multi-AWB tracking per
  order), Bulk Tracking Update via CSV, Shipglobal label creation, courier webhook ingestion
  (Delhivery, Shiprocket, UPS, and a generic webhook), a manual courier-rate card and freight cost
  estimator.
- **Documents** — Credit/Debit Notes, Washing Entry, Internal Invoice, Purchase/Freight/Duty
  Bills, CSB-V/CSB-IV export invoices with origin declarations, Shipment Chalan.
- **Finance** — Bill Pass Register (unified vendor/courier/salary payable ledger) with a two-level
  approval workflow, Party Ledger, Office Expenses, Bill Payment, Backup Export (one-click
  all-orders-and-invoices Excel export).
- **Inventory & stock** — raw-material Stock In/Out (Chalan-No.-mandatory), finished-goods
  inventory with auto-restock on refund, reorder alerts.
- **Reports** — a filterable, column-picker-driven Reports hub (Orders, Purchase Bill,
  Freight/Duty Bill, Outstanding Balances, Party Ledger, Sale & Profit, Salary/Attendance, SKU ×
  Country × Size, Returns/Refunds), each exportable to CSV/Excel/Word/PDF or sent via Email/WhatsApp.
- **HR & attendance** — auto punch-in/out on login/logout, Daily Work Report (auto-save, carry
  forward of unfinished work, work-hours anomaly detection), leave requests + coverage-based
  temporary store access, salary/advance tracking, HR letters & certificates, a task
  assignment/tracking system.
- **CRM** — company-wide order-status overview, data-quality alerts, top-buyer tracking, a P&L
  dashboard.
- **Admin** — Employees, Roles & Permissions (capability-based, not hardcoded roles), Company/Item
  master data, Help Center, an **Audit Log** for sensitive actions, and a small **Automation Rules
  engine** (trigger → condition → action, currently order Hold/Cancel → internal remark/tag).
- **Security** — capability-based access control re-checked server-side on every action, Row-Level
  Security on every table, encrypted marketplace/courier credentials, HMAC-verified courier
  webhooks, and optional **two-factor authentication (TOTP)** per login.
- **Personalization** — a per-employee dashboard theme system (5 presets + custom accent colour).

## Stack

- **Frontend + backend**: Next.js (App Router, Server Actions)
- **Database**: PostgreSQL via [Supabase](https://supabase.com) (also provides auth + file storage)
- **Styling**: Tailwind CSS
- **Hosting**: [Vercel](https://vercel.com) — Hobby plan, auto-deploys from `main`

## Local setup

```bash
npm install
cp .env.example .env.local   # fill in your Supabase project's URL + keys
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Database schema

`db/schema.sql` is the full PostgreSQL schema (70+ tables, RLS enabled on every one, trigger-based
document numbering) — apply it to a fresh Supabase project via the SQL Editor, or
`psql "$SUPABASE_DB_URL" -f db/schema.sql`. Read `db/SCHEMA_NOTES.md` first — it explains the
design decisions and the mapping from the original spreadsheet system.

Dated files in `db/` (e.g. `db/2026-08-24-audit-log.sql`) are one-time incremental migrations —
apply each once, in date order, against the live database; `db/schema.sql` is the cumulative
source of truth and is kept in sync as each migration ships.

### Local schema checks (no live Supabase needed)

Schema/type changes are validated against a disposable local Postgres before ever touching real
data:

```bash
createdb oms_test
psql -d oms_test -f db/schema.sql        # should apply with zero errors
GEN_TYPES_DB_URL="postgresql://postgres:postgres@localhost:5432/oms_test" \
  node scripts/gen-types.mjs             # regenerates src/types/database.ts
npx tsc --noEmit                          # type-check
npm run build                             # full production build
```

`scripts/gen-types.mjs` is a stand-in for `supabase gen types typescript` (that CLI subcommand
needs a working Docker daemon, not always available) — re-run it after every `db/schema.sql`
change, and sanity-check the diff before trusting it (this project has schema/type drift between
`db/schema.sql` and the live production database in a few known places — check with the project
owner before assuming a regenerated file is safe to apply wholesale).

## Project structure

```
src/
  app/                 App Router pages (one route per module, under app/dashboard/*)
  components/          Shared UI (dashboard header/sidebar, theme, form primitives)
  lib/
    supabase/            Browser + server Supabase clients
    auth/                requireCapability() / getAuthedEmployee() — server-side capability gate
    audit/               Audit log helper
    automation/          Automation rules engine (trigger → condition → action)
    attendance/          Punch, carry-over, work-hours calculations
  types/database.ts     Generated from db/schema.sql — do not hand-edit
db/
  schema.sql             Full PostgreSQL schema (cumulative source of truth)
  SCHEMA_NOTES.md         Design rationale + old-system -> new-table mapping
  YYYY-MM-DD-*.sql        Dated, idempotent incremental migrations
scripts/
  gen-types.mjs           Local type generator (see above)
```

## Company reference data

| Company | Order Ref Prefix | Master Invoice Prefix | GSTIN | Location |
|---|---|---|---|---|
| Nyko Mart | PO NO. | NYM | 08CVAPS0200H1Z0 | Jaipur, Rajasthan |
| CASA ARRA | RF NO. | CASA | 08AUXPR4630C1ZA | Jaipur, Rajasthan |
| Rugara | RG NO. | RA | 08BDHPL8126K1Z6 | Jaipur, Rajasthan |

## Business rules ported from the original system

Every rule the business explicitly relies on is preserved — see comments in `db/schema.sql`'s
"BUSINESS RULES ENFORCED IN APPLICATION CODE" block and `src/lib/auth/require-capability.ts`:

- No stock movement without a Chalan No.
- Duplicate-order detection: same buyer + same Order No. already dispatched reuses the existing
  PO/RF/RG No. instead of creating a new one.
- PO/RF/RG numbers and document numbers (Credit Note, Debit Note, invoices, etc.) are reserved
  atomically, only at actual save time — never at form-preview time — so there are no permanent
  gaps in the sequence.
- Capability-based access control is re-checked server-side on every privileged action, never
  trusting a client-side check alone.
- Company scoping is enforced server-side on every write, not just filtered in the UI.

## Operating rules for anyone working on this codebase

- Code changes ship via GitHub's web UI upload (not a direct `git push`) and are verified against
  `origin/main` afterward — never trust an unverified "it's pushed" claim.
- Database-altering SQL (`INSERT`/`UPDATE`/`DELETE`/`CREATE TABLE`/`ALTER TABLE`, etc.) is never
  executed directly against the live database — it ships as a dated `.sql` file under `db/`, run
  manually by an authorized person via the Supabase SQL Editor, and re-verified afterward.
- Every migration file is idempotent (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, etc.)
  and dry-run tested against a local/disposable Postgres before delivery.
