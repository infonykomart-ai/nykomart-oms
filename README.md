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
  `employees.telegram_chat_id`). **Optional since 2026-10-03**: if unset, the app resolves the
  handle from `TELEGRAM_BOT_TOKEN` itself via the Bot API's `getMe` (cached per server
  instance), so an unconfigured username can no longer block the connect flow.
- Sending code: `src/lib/attendance/telegram-notify.ts`; connect/Test actions live in
  `src/app/dashboard/attendance/actions.ts`; admin Test button on the Employees page.
  Every message greets `Hello <Name>,` with the employee's own name (2026-10-03), and the
  Attendance page's connect card auto-detects the Start press — one click, no manual
  "Connect" step to remember.
- **Connect robustness (2026-10-05)** — "same error not resolve yet": the connect action no
  longer requires the optional `TELEGRAM_BOT_USERNAME` env var (reading `getUpdates` only
  needs the token, and the missing-env failure was hidden behind the card's generic
  timeout message); it accepts a **fresh (≤15 min) plain `/start`** typed directly in the
  bot chat when Telegram doesn't carry the deep-link payload (exactly one candidate only,
  and that chat id must not already belong to another employee); it best-effort calls
  `deleteWebhook` before reading the queue (an externally-registered webhook drains the
  update queue); and the card now surfaces the real server error instead of swallowing it.
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
- **Area-based pricing (2026-10-17)** — a line priced "per sq ft / per sq
  mtr" with a Size ("2.6 × 10 ft") bills **qty × L × W × rate**, not
  qty × rate; everything goes through the one `lineAmount()` in
  `src/lib/b2b/erp.ts` (inquiry lines, quotation `line_total` + subtotal,
  the costing engine, sales orders, PI/CI print, the share message,
  reports, Control Center, the B2B P&L). Size entry lives on the New
  Inquiry modal, the inquiry details form, the quote form, the engine's
  product lines and the sales-order lines; total sq ft shows on the
  register KPI strip, the inquiry/quote/PI/CI/order screens and the
  Reports/Control Center KPIs. `line_total` is therefore app-maintained
  (no longer a `GENERATED` column). **Run once on the live DB:
  `db/2026-10-17b-b2b-area-pricing.sql`** before this code goes live — it
  adds the size columns and converts both `line_total` columns (existing
  values are preserved).
- **Embedded pages in dialogs (2026-10-19)** — anything previewed inside an
  `A4Dialog` frame (the Orders hub's **View**, every Document Entry **Print**
  button's A4 preview) now requests `?embed=1`. `src/proxy.ts` turns that into
  an `x-embed` request header and `dashboard/layout.tsx` skips only the
  visible chrome for it — sidebar, header, module tabs, celebrations banner,
  the floating messenger/companion widgets — while every provider still
  mounts, so the framed page behaves exactly like the real one. Result: a
  dialog contains the ONE page it asked for, not the whole window. Auth,
  session refresh and redirects are untouched; a page that must never be
  framed simply ignores the header.
- **Salary Structure has its own screen (2026-10-19)** —
  `/dashboard/salary/structure` decides and revises what each employee is
  paid, in labelled sections (employee & effective date / pay mode / CTC
  earnings split / PF-ESI-PT / live "what this pays" breakdown), with the
  same versioned `setEmployeeSalary` semantics as before (new date = new
  version, existing date = correction). The Salary & Payroll page keeps the
  month's payroll, payslips and the salary/advance/payment history where each
  row can be edited or deleted.
- **Advance corrections (2026-10-19)** — `updateAdvance` / `deleteAdvance`
  (salary actions) let a wrongly-given or wrongly-typed advance be fixed or
  removed, keeping the `bill_pass_register` mirror in step and refusing any
  change that would drop an advance below what salary payments already
  recovered from it.
- **Leave lists survive a missing migration (2026-10-19)** — the leave
  screens used to select the 2026-10-17 audit columns
  (`applied_lat`/`cancelled_*`) and the `leave_request_events` table
  unconditionally, so on a database where that migration hadn't been run
  the query failed and both leave lists silently rendered their EMPTY state
  ("No leave requests yet.") over real pending and approved requests, and
  applying for leave failed too. `src/app/dashboard/leave/leave-queries.ts`
  now reads tolerantly — full row first, base columns on a
  missing-column/table error, a real error surfaced instead of swallowed —
  and both screens name
  `db/2026-10-17-leave-audit-and-lifecycle.sql` while the audit extras are
  unavailable. The bell's "On leave today" item also names the employees
  (not just a count) via the layout's existing query.
- **TeamOffice matrix import + visible comparison (2026-10-19)** — the
  biometric export's block layout (Dept. Name / Empcode / IN / OUT / WORK /
  Break / OT / Status with one column per day) is now parsed natively by
  `parseBlockLayout()` in `src/lib/attendance/punch-import.ts`, and the import
  reports a per-row **sheet-vs-recorded-attendance** comparison table
  (web IN/OUT, sheet IN/OUT, match/mismatch) instead of storing the verdict
  invisibly on the attendance row.

**Round 4 — fix pass (2026-10-03)** — five reported gaps, all fixed:

- **💰 Proper salary decide/feed form** (`/dashboard/salary`) — the
  Set/Update card is no longer a blind dropdown + empty number: picking an
  employee PREFILLS their current structure (flat or full CTC mode, all
  PF/ESI/PT fields) into controlled inputs, a live banner shows "currently
  ₹X/month … effective from …" (or "no salary decided yet"), the dropdown
  lists every employee with their salary or "(no salary set)", and the
  card header counts how many of the team have a salary decided. Saving
  still inserts a new versioned row effective from the chosen date —
  earlier payroll months are never rewritten.
- **🗂️ Window/tab parity for the B2B suite** (module-tabs.tsx) — each
  `/dashboard/b2b/*` page (Control Center, Register, Buyers, Products,
  Quotation Engine, Sales Orders, Production & QC, Shipments, Reports)
  now opens its OWN closable window in the top module-tab strip, exactly
  like top-level modules do; they used to all collapse into the single
  "B2B Inquiries" tab. Restored tabs re-resolve their label/icon against
  the live registry so old saved sets keep working.
- **🔓 No more fake logouts** — two failure modes used to land on the
  dashboard error boundary and read as "session expired → Sign in":
  (a) `ForbiddenError` when the role lacks the page's capability (deep
  links/nav strips aren't capability-filtered like sidebar tiles), and
  (b) any page/data error while still signed in. The boundary now
  re-derives the path's required capabilities (CAPABILITY_INFO
  longest-prefix + known cross-module overrides) and asks
  `/api/auth-check?capability=…` — a 403 renders a real **Access Denied**
  card (module name + role, Go Home / Go back, no sign-in prompt), and
  every other error gets copy that says out loud you are **still signed
  in — this is not a logout**, with Try again / Go Home primary and
  "Sign in again" demoted to a quiet link.
- **📱 Telegram made simple + personal** — every punch confirmation now
  greets `Hello <Name>,` (DM and group), and the Attendance page's
  Connect card is one click: it opens the bot deep link AND auto-polls
  the connect (~2.5s × 30s) so the employee only has to press **Start**
  in Telegram — the card flips to ✓ Connected on its own; a retry button
  stays for the slow case.
- **🗓️ Attendance Admin suite nav on every report** — the report nav
  cluster used to live only inside the suite root's header, so every
  sub-report (Daily/Monthly/…/GPS Approvals) was a dead end. It is now a
  shared component (`attendance/admin/admin-nav.tsx`) rendered inline on
  the root header AND as a strip via `attendance/admin/layout.tsx` on
  every sub-report.
- Also: `sku-country-size` report's composite key no longer embeds raw
  NUL bytes in source (same runtime value via `\u0000` escape — the raw
  bytes made grep treat the file as binary).

**Unified Printing register (2026-10-15)** — printing job work was
spread over three unrelated places (Material OUT Chalan under Stock,
Received Chalan under Documents, printing charges typed in the Bill Pass
Register) with nothing showing them together — one register now does, at
`/dashboard/printing-register` (linked from the Documents AND Stock
headers; gated `requireAnyCapability("stock_entry", "doc_entry")`, same
as the Credit Note Register, with a matching error-boundary override):

- One **per-party group** unifying all three streams in a single table —
  📤 Sent (Material OUT Chalan: SKU lines, qty in ft, linked POs, links
  to the chalan's own print page), 📥 Received (Received Chalan: item
  lines with qty/unit/rate, PO, links to its print page) and 🧾 Bill
  (Bill Pass Register rows) — each group with sent/received/pending
  totals, bill total and still-due, plus grand totals on top.
- **Pending** = sent − received (received converted to feet via
  `toFeet`; PCS tracked separately since it has no feet equivalent), so
  "kitna maal printer ke paas hai" is visible per party at a glance.
- Bills join via `invoice_type = 'Printing'` **or** a vendor whose Party
  Master says `invoice_type = 'Printing'` (job-work returns are billed as
  a normal Purchase bill, which mirrors into the ledger as 'Purchase') —
  see `src/lib/printing-register.ts` for why both are needed. Bills use
  `invoice_recv_date ?? invoice_date` and undated old rows are kept, never
  dropped by the date filter.
- Default scope is **all parties with a chalan or printing bill** (a
  party typed wrong in the master can never be invisible here); the
  Parties filter narrows to *Printing vendors only*. Company select +
  From/To follow the existing register pattern, and the whole sheet
  prints via the shared `PrintArea`/`PrintButton`.
- Aggregation lives in pure `buildPrintingRegister()`
  (`src/lib/printing-register.ts`) so any future export can't disagree
  with the page.
- Also fixed: `po-line-actions.tsx` passed a partial party object into
  `PurchaseBillEditForm`, which made `npx tsc --noEmit` fail on the
  previous round's commit.

**B2B PI/CI print — both 2026-10-13 rebuilds merged (2026-10-15)** — the
same "complete Proforma Invoice" feature had been built twice on two
machines (a local commit and an uploaded one), which blocked every push.
Both are now integrated instead of one winning:

- **Seller + bank block**: the editable `b2b_export_profiles` row prints
  first, falling back to the `companies` seller columns
  (business_address / iec_no / pan_no / gstin / business_email /
  business_phone), then "To be provided" — both header editors kept
  (🏢 Seller Details + 🏦 Export Profile).
- **Payment / shipping sections**: the structured quotation columns
  (payment_condition/method/due_note, bank_charges, ports, delivery
  period, partial shipment, transshipment, freight & insurance, packing,
  country of origin) print as rows AND the free-text `payment_terms` /
  `shipping_terms` blocks print below them, deduped by label so nothing
  appears twice; all-`DEFAULT_SHIPPING_LINES` fallback keeps every fact
  "To be confirmed".
- **Items**: per-line specs (size / material / manufacturing / colour /
  packaging) + the 📐 SIZE × QTY dimension line (`computeItemDims`) plus
  the quotation's own `product_specs` block. Money + amount-in-words come
  from `lib/b2b/money-format` (INR keeps lakh words, export currencies
  international grouping).
- Both migrations are `ADD COLUMN IF NOT EXISTS`, so they run in any
  order; the duplicated `buyer_address` column that the auto-merge left
  in `db/schema.sql` / `src/types/database.ts` is deduped by hand (types
  can't be regenerated here without DB access).

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
