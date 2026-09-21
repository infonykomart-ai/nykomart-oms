# Nykomart OMS

Multi-company order-management system for an export business (Nyko Mart / Rugara / CASA ARRA) —
orders, dispatch & courier tracking, marketplace reconciliation (Etsy / eBay / Amazon / WooCommerce),
freight & duty bill reconciliation, inventory, HR, and a full P&L.

Replaces a Google-Apps-Script + Google-Sheets system; the sheet's business rules were carried over
into Postgres functions and Next.js server actions.

## Tech stack

| Layer      | Choice |
| ---------- | ------ |
| Framework  | Next.js 16 (App Router, Server Actions, `src/` layout), React 19, TypeScript strict |
| Styling    | Tailwind CSS v4 |
| Database   | Supabase (Postgres 16) — schema lives in **`db/schema.sql`** as the single cumulative source of truth |
| Auth       | Supabase Auth (email/password) + an `employees` table; session refresh in `src/proxy.ts` |
| Hosting    | Vercel (2 cron jobs via `vercel.json`) |
| PDF/images | `@react-pdf/renderer`, `pdfjs-dist` + `pdf-parse` (courier-bill import), `sharp` |
| Types      | `src/types/database.ts` — **generated**, see below |

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in real values (Supabase project Settings → API)
npm run dev
```

Environment variables are documented inline in `.env.example` — Supabase keys, encryption key,
cron secret, and per-courier tracking credentials (Delhivery, UPS, FedEx, Shiprocket, Aramex,
Shipglobal, DHL), plus Whapi/Telegram order-notification tokens.

## Database & schema workflow (important)

- `db/schema.sql` is the **only** thing needed to stand up a fresh database — every dated
  `db/2026-*.sql` migration is a one-time patch for the live Supabase DB whose changes get
  **folded back** into `schema.sql` once shipped. Never replay dated migrations on top of a
  fresh `schema.sql`.
- `src/types/database.ts` is auto-generated from the live schema by `scripts/gen-types.mjs`
  (introspects tables/views/enums/CHECK-unions/FKs/RPCs). It must be regenerated after any
  `schema.sql` change or CI fails:

  ```bash
  # with a local Postgres loaded with db/schema.sql:
  GEN_TYPES_DB_URL=postgresql://postgres:postgres@localhost:5432/oms_test node scripts/gen-types.mjs
  ```

## CI

`.github/workflows/ci.yml` runs on every push/PR to `main`:

1. **build** — `npm run lint`, `npx tsc --noEmit`, `npm run build`
2. **schema-check** — applies `db/schema.sql` to a throwaway Postgres 16, regenerates the
   database types, and fails if `src/types/database.ts` differs from what's committed.

## Application structure

```
src/
├── proxy.ts                 # auth gate: refreshes session, bounces signed-out users off /dashboard
├── app/
│   ├── login/               # sign-in page
│   ├── dashboard/           # ~38 sections (orders, documents, invoices, inventory, crm, reports…)
│   │   └── <section>/{page.tsx, actions.ts}   # page + server-actions convention
│   └── api/
│       ├── webhooks/courier/  # Delhivery / Shiprocket / UPS / generic push webhooks (HMAC-verified)
│       ├── cron/              # sync-orders, poll-fedex-tracking (Vercel cron, CRON_SECRET-gated)
│       ├── whapi-send-order/, telegram-send-order/   # per-company order-notification channels
│       └── …                  # PDF/document routes, photo proxy, shipglobal label
├── components/              # shared UI (incl. A4-sized edit/view dialogs, charts)
├── lib/                     # domain logic
│   ├── courier-bills/       # PDF text extraction + FedEx/UPS/DHL bill parsers, reconciliation match
│   ├── couriers/            # FedEx/Aramex/DHL/Shipglobal APIs, per-company credential resolution
│   ├── order-packages/      # multi-package/AWB model + dispatch-summary resync
│   ├── crypto/              # AES-256-GCM secret box for stored marketplace/courier keys
│   ├── security/            # SSRF-safe external fetch
│   └── fy-date.ts           # FY-anchored date validation used by every entry form
└── types/database.ts        # GENERATED Supabase-style types
```

## Core domain concepts

- **Multi-company**: every row is company-scoped; employees get company access lists and
  capability-based permissions (`capabilities` / `role_capabilities` tables, auto-synced from the
  app registry on the Roles & Permissions page — see `src/lib/capability-sync.ts`).
- **Orders → shipments → packages**: an order can have multiple AWBs (`order_shipments`) and each
  AWB multiple physical boxes (`order_packages`, volumetric weight = L×W×H/5000).
  `dispatch_invoices` is an auto-resynced order-level summary.
- **Courier bill reconciliation**: FedEx/UPS freight & duty bills are imported via PDF upload,
  parsed per AWB (base/fuel/remote/other/GST breakup; bill-level GST prorated across AWBs),
  assigned to shipments, and reconciled against booked/dispatch estimates in the Courier Bill
  Report (per-row weights, diff, shipping-% and category-wise breakdown).
- **Marketplace reconciliation**: Etsy ledger / eBay tax lines / Amazon transactions are imported
  and matched to orders by order number; portal fees offset the P&L's 25% estimate when matched.
- **P&L**: accrual/bill-basis, per company and per month, with expense breakdown and
  courier/duty credit-note netting (`pl_dashboard_*` views in `schema.sql`).

## Security model (summary)

- All ~74 tables RLS-enabled; the anon key has **zero** direct table access — everything goes
  through Server Actions / Route Handlers that verify identity (`src/proxy.ts`,
  `src/lib/auth/`) and capability + company scope before writing.
- Courier webhooks are HMAC/timing-safe-verified and fail closed when unconfigured; cron routes
  check `CRON_SECRET`.
- Stored marketplace/courier API keys are encrypted at rest.

## Conventions

- Keep business rules in app code (server actions) or Postgres functions — documented in
  `db/schema.sql` comments, which are unusually detailed; read the section around a table before
  changing it.
- New form fields: add the column via a dated `db/2026-*.sql` migration **and** fold it into
  `db/schema.sql`, regenerate types, then wire the server action + form.
- Validate all business dates with `validateDateFields()` (`src/lib/fy-date.ts`).
- `npx tsc --noEmit` must stay clean; lint with `npm run lint`.
