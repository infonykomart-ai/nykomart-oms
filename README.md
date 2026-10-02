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

**Telegram punch notifications (2026-09-30)** — punch in/out confirmations are sent as personal
Telegram DMs, one per employee (the WhatsApp channel for this flow is OFF):

- `TELEGRAM_BOT_TOKEN` — bot token from @BotFather; shared with the order-photo Telegram sends
  (`src/app/api/telegram-send-order/route.ts`).
- `TELEGRAM_BOT_USERNAME` — the bot's @handle without `@`; used to build the deep link
  `https://t.me/<username>?start=<employee id>` that employees open from the Attendance page to
  connect their own Telegram (pressing Start is what lets the app capture their chat id into
  `employees.telegram_chat_id`).
- Sending code: `src/lib/attendance/telegram-notify.ts`; connect/Test actions live in
  `src/app/dashboard/attendance/actions.ts`; admin Test button on the Employees page.
- Destination mode (2026-10-01): default is a **personal DM per employee**. Set
  `TELEGRAM_ATTENDANCE_MODE=group` + `TELEGRAM_ATTENDANCE_CHAT_ID=<group chat id>` (the bot
  must be a member of that group) to post every punch to ONE shared Telegram group instead,
  employee name prefixed — group mode needs **no per-employee connect/Start step** at all.
  Unset/typo'd config always falls back to DM.
- The Employees page's Telegram cell has a **🔗 Copy link** button that copies that
  employee's personal `t.me/<bot>?start=<id>` deep link so admins can WhatsApp it to them.

**Attendance reporting suite (2026-10-01)** — TeamOffice-style reports under
`/dashboard/attendance/admin` (nav strip in its header): **Dashboard** (today's stat cards +
daily-status donut + present-per-day bar chart), **Daily / Monthly / Periodic / Yearly
reports** (company/employee filters, PDF/Excel/Word/CSV export via the shared ExportBar),
and **Import Punch Report** (`.../admin/import`) — drop in a TeamOffice (or any
Empcode/Date/IN/OUT) CSV/XLSX to backfill punches recorded outside the app; imported rows
land in `attendance` (source `TeamOffice Import`, device columns + match/mismatch flags)
so reports and the salary pipeline count those days like any web punch. Logout still
records the evening Punch Out (with an explicit confirm dialog when today's punch is open);
not logging out means no punch out.

**TeamOffice parity round 2 (2026-10-02)** — the rest of the Report menu + the data it
needs (all under the same nav strip):

- **📍 Location Report** (`.../admin/location-report`) — per-day work location: the
  `attendance.store_id` store name when set, else the Web-Punch GPS fix, else "—".
- **📡 GPS Report** (`.../admin/gps-report`) — punch-wise coordinates + Google Maps link;
  rows without coords still list, so it doubles as a missing-location audit. Coordinates
  come from the **Web Punch buttons**, which now ask the browser for a one-shot
  geolocation fix (best-effort — denied/timeout punches WITHOUT coords, never blocked;
  server-side login/logout punches and imports have no browser, so they stay NULL).
- **🌴 Leave Report** (`.../admin/leave-report`) — per-employee leave days (paid/unpaid
  split + leave-type breakdown) and Approved/Pending/Rejected `leave_requests` counts
  for the period.
- **🏖️ COFF Report** (`.../admin/coff-report`) — compensatory off, DERIVED not stored:
  days actually worked on a weekly-off day/holiday minus Leave days under a leave type
  named COFF/Comp Off (balance can go negative, shown as-is).
- **💰 Salary Report** (`.../admin/salary-report`, gated `salary_admin`) — month-wise
  per-employee table (attendance counts, gross, attendance deduction, PF/ESI/PT, net,
  paid status). Every figure reuses the exact payroll functions `/dashboard/salary`
  uses, so the two can never disagree; paying still happens on `/dashboard/salary`.
- **📒 Month Summary** (`.../admin/month-summary`) — the calendar-style sheet: one
  employee × one month as a Mon-first wall calendar (per-day status badge + IN/OUT),
  totals strip, day-wise table, Print/PDF + export.
- **Department column + filter** — every report row now carries a Department column,
  and the Monthly/Daily/Periodic/Yearly filters gained a Department dropdown (all
  report types ride the shared `range-report.ts` engine + `ReportResults` renderer).
  Originally a free-text field; superseded by the structured departments entity in
  round 3 below.
- Migrations to run once on the live DB: `db/2026-10-02-employee-department.sql` and
  `db/2026-10-02-attendance-punch-geo.sql` (both idempotent; already folded into
  `db/schema.sql`, types regenerated).

**TeamOffice parity round 3 (2026-10-02)** — Department as a real entity, the GPS
approval workflow, and the last two report menus:

- **🏢 Department master** (`/dashboard/admin/departments`, gated `employee_admin`) —
  structured `departments` table (unique per company) with add / rename /
  activate-deactivate; delete is intentionally not offered so history keeps pointing
  at a real row. Employees now pick a department from a select — `employees.department_id`
  FK replaces the free-text `employees.department` column, and existing free-text values
  are migrated into departments rows by `db/2026-10-02b-departments-entity.sql`. Every
  report resolves the FK to the department name, so renames propagate everywhere.
- **🛰️ GPS Approvals** (`.../admin/gps-approvals`, gated `attendance_admin`) —
  workflow over the Web-Punch coordinates: a punch with a GPS fix lands as **Pending**,
  the queue shows IN/OUT times + a 🗺️ map link, and an admin approves or rejects with an
  optional remark (who decided + when are recorded). Approved/Rejected rows are never
  re-opened by later punches (a punch-out only flips `None → Pending`); the GPS Report
  gained a GPS Review status column.
- **🧾 Salary Details** (`.../admin/salary-details`, gated `salary_admin`) — the salary
  *master* sheet: each employee's salary structure as of a chosen month (CTC split,
  live PF/ESI/PT, preview net). Read-only by design — attendance-based payroll figures
  live in the Salary Report, and paying still happens on `/dashboard/salary`.
- **🧩 Other Report** (`.../admin/other-report`) — the three odds-and-ends reports on
  the shared range engine: **Source Report** (punch counts per `attendance_source` +
  GPS-captured days per employee), **Department rollup** (day counts folded per
  department), and **Hours report** (worked days, total/average hours, OT > 15 min,
  short days).
- Migrations to run once on the live DB: `db/2026-10-02b-departments-entity.sql` and
  `db/2026-10-02c-attendance-gps-approval.sql` (both idempotent, safe whether or not the
  round-2 migrations already ran; folded into `db/schema.sql`, types regenerated).

**B2B Export ERP (2026-10-02)** — the gaps in the existing `/dashboard/b2b`
register filled in as a full export ERP (the register, its PI/CI/PL documents
and its mode-wise payments keep working unchanged — a nav strip links the
whole suite). Same gate: `b2b_inquiry` capability, company-scoped, audited.
All formulas live in one shared module, `src/lib/b2b/erp.ts`, used by both
server pages and client previews so they can never disagree.

- **🎛️ Control Center** (`.../b2b/control-center`) — the spec's home screen:
  sales month/quarter/FY, orders, new enquiries, pending quotations,
  production pending/in-progress, QC pending, ready/in-transit/delivered,
  receivable + overdue, stock value + raw-material value (average-cost
  valuation), gross/net profit, plus the 🟡🔴🟢 **automatic-alert panel**
  (overdue payments, delayed shipments, production deadlines near, stock
  below minimum, QC rejections, follow-ups due, buyers not responding,
  orders ready to dispatch), monthly-sales line, pipeline donut, product &
  country bars, Top-5 buyers/products, country-wise dashboard.
- **👥 Buyers** (`.../b2b/buyers`) — customer/buyer CRM with the spec's
  profile fields; lifetime value, outstanding and overdue are COMPUTED
  from orders + payment schedules (never stored), per-buyer dashboard
  modal with AOV, paid, last order and follow-up scheduling.
- **📦 Products** (`.../b2b/products`) — product master for the five export
  types with **auto-SKU** (`CD-1001` Cotton Dhurrie / `CR-` Carpet / `JR-`
  Jute Rug / `CK-` Cotton Kurti / `TC-` Table Cover — prefix per type,
  counter starts 1001), type-specific spec fields (jsonb), 4 price points
  with live margin, stock + min-stock reorder alerts, and a **BOM editor**
  with the live requirement engine (qty × consumption × 1+wastage%).
- **🧮 Quotation Engine** (`.../b2b/engine`) — pick an open inquiry +
  product lines; product cost, packing, freight, other costs, discount,
  total cost, net selling, gross profit and margin % compute live, with a
  target-margin **suggested price** for enquiries. Freight/incoterm are
  always entered values — the system never guesses a rate. Save writes the
  engine columns onto the inquiry's 1:1 quotation; **Convert to Sales
  Order** runs the §7 step (SO-<FY>-####, auto payment schedule from
  `50/50` / `Net 30` / advance terms, inquiry marked Converted).
- **🧾 Sales Orders** (`.../b2b/orders`) — the status pipeline (Confirmed →
  In Production → QC → Packing → Ready to Dispatch → Booked → In Transit →
  Delivered/Closed), per-line price vs cost, the order P&L with the
  **"why is profit low?" drill-down** (each cost bucket as % of sales,
  editable buckets), the **packing calculator** (cartons = CEILING(qty ÷
  pcs/carton), net/gross weight, CBM) and the payment schedule with
  receive/overdue tracking.
- **🏭 Production & QC** (`.../b2b/production`) — PRD/QC numbering, planned
  vs produced with auto completion %, configurable stage routing
  (defaults = the spec's 10 stages, overridable per plan), due-date/late
  badges; QC inspections with pass/reject/rework and auto defect %.
- **🚢 Shipments** (`.../b2b/shipments`) — SHP-<FY>-#### with the full
  export fields (ports, forwarder, container/seal, BL/AWB, ETD/ETA,
  freight/insurance), status ladder and the derived 🔴 delayed badge.
- **📊 Reports** (`.../b2b/reports`) — finance strip (revenue/cost/gross/
  expenses/net/receivable FY), month-wise sales, product + customer +
  salesperson profitability, production summary, export value by country
  with shipment counts.
- The auto-workflow triggers live in the server actions: creating
  production advances the order to In Production, completing it → QC, a
  spotless inspection → Packing, shipment movement → Booked/In
  Transit/Delivered.
- Migration to run once on the live DB: `db/2026-10-02d-b2b-export-erp.sql`
  (idempotent — 10 new tables + costing-engine columns on
  `b2b_quotations`/`b2b_inquiries`; folded into `db/schema.sql`, types
  regenerated, 146 tables/views).

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
