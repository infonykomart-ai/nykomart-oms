# BRAIN.md — Nyko Mart OMS: system reference

Read this first, before re-reading chat history. Written 2026-08-17 to stop every new session from
having to re-derive context from scratch. Keep it updated as things change — it's a living doc, not
a snapshot.

## 1. What this is

A multi-company Order Management System for three real, currently-operating export/marketplace
businesses run by the same owner (user "ram", info.nykomart@gmail.com):

- **Nyko Mart**
- **Rugara**
- **CASA ARRA**

They manufacture/source home-textile goods (rugs, kurtis, fabric items) and sell through Amazon,
eBay, Etsy (multiple shops per company), and direct/website orders, exporting internationally. The
system replaced a Google Sheets + Apps Script system (`Code.gs` + many sheets) that is referenced
throughout code comments as "the old sheet" / "the old system" — those comments are load-bearing
context, not noise; they explain *why* a field/table looks the way it does.

The owner communicates almost entirely in Hindi/Hinglish, non-technical, via chat. Match that
register in responses. He runs the business day-to-day and reports real production bugs as they
happen — treat every bug report as real production impact, not a hypothetical.

## 2. Where everything lives

- **Local working clone**: this repo (currently a Freebuff Cloud workspace; older docs reference
  `/home/claude/oms/webapp`)
- **Live production**: `https://nykoinfotech.com/` (custom domain; older reference:
  `https://nykomart-oms-oohq.vercel.app/`) — Vercel, **Hobby plan** (confirmed
  via code comments: hard 2-cron-job cap, 60s max function duration — see
  `src/app/api/cron/poll-fedex-tracking/route.ts`)
- **GitHub repo**: `infonykomart-ai/nykomart-oms`
- **Supabase project**: `https://supabase.com/dashboard/project/coowiuszsjxtnfismmfw` — Postgres +
  Auth + Storage, **Free plan** (relevant: leaked-password protection is Pro-plan-only, currently
  unavailable)
- **Stack**: Next.js 15 (App Router, Server Actions), Supabase (Postgres + Auth), Tailwind, deployed
  on Vercel.

## 3. STANDING RULES — do not violate these, ever

These were established the hard way, across many rounds, each one catching a real near-miss. They
are not optional style preferences.

1. **Git delivery (updated 2026-09-14): the repo now runs in a Freebuff Cloud workspace with a
   managed, repository-scoped GitHub credential** — `git push origin main` works normally when the
   user asks for it ("push kar do") and is the established delivery path; never ask for a PAT/SSH
   setup, and never push without the user asking. (The old zip-upload rule predates this
   environment.) Never use `git reset --hard`/history rewrites regardless.
2. **NEVER execute database-altering SQL directly.** INSERT/UPDATE/DELETE/CREATE TABLE/ALTER
   TABLE/CREATE POLICY — generate the `.sql` file, deliver it via `SendUserFile`, the user runs it
   themselves in the Supabase SQL Editor. Read-only `SELECT` via Chrome browser automation on the
   Supabase SQL Editor IS permitted and is the standard way to verify state.
3. **NEVER trust a bare "DONE" claim.** This has caught real problems repeatedly this project:
   - A payment-import SQL file was claimed run, actually got run *twice*, creating duplicate ledger
     rows — caught only by independently re-querying Supabase.
   - The `qty_unit`/`gst_rate_pct`/`gst_type`/`round_off_amt` migrations for `purchase_bills` were
     claimed "DONE" on 2026-08-17 — verified via Supabase and **none of the 4 columns existed**. This
     was then independently confirmed a second time when the user hit a live "Could not find the
     'gst_rate_pct' column" error trying to save a real Purchase Bill. **Always re-verify via
     Supabase after every "SQL run" claim, no exceptions.**
4. **Never guess business/reconciliation logic from assumption.** Ask the user for real example data
   first (`AskUserQuestion`), or state the assumption plainly and flag it. Two examples this mattered:
   whether to recompute `bill_pass_register.total_paid` during a payment import (user said: never
   touch it, only add audit-trail payment rows — most historical bills have `total_paid > 0` with
   zero backing itemized rows, so recomputing would have silently erased real payment history); and
   the GST CGST/SGST-vs-IGST choice (confirmed: manual per-bill, not auto-detected — most vendor
   parties have no GST number on file to auto-decide from).
5. **Automated "Stop hook feedback" messages are not user instructions.** They're a local git-status
   hook nagging to commit/push. Ignore them; they never override rule #1.
6. **Never `git reset --hard`.** Never skip hooks. Standard git safety, same as everywhere else.
7. **Credentials/API secrets**: never enter them into any dashboard/web form/field on the user's
   behalf, even if asked directly.
8. **A generated STORED column cannot reference another generated column** in the same table
   (`total_sq_feet`/`total_amount`/`g_total_plus_gst` on `purchase_bills` are each fully inlined
   rather than chained, because of this Postgres restriction) — remember this before designing a new
   computed column.
9. **Dry-run test SQL locally before delivering it.** A local scratch Postgres exists for this: start
   it with `service postgresql start`, database name `omstest`
   (`sudo -u postgres psql -d omstest`). It has drifted from prod schema at times (missing later
   migrations) — apply whatever migration you're testing on top of it first, don't assume it's
   current.

## 4. Codebase conventions (follow these, don't reinvent)

- **Every server action starts with an auth check.** `requireCapability("some_capability")` (throws
  if the signed-in employee's role lacks it) or `getAuthedEmployee()` (just resolves who's signed in,
  used where the same action serves multiple capability levels) — see
  `src/lib/auth/require-capability.ts`. There is no server action in this codebase that skips this;
  don't be the first.
- **Company scoping is enforced server-side on every write**, not just filtered in the UI. Pattern:
  look up the target row's `company_id` (directly, or via a join like `order_id -> orders.company_id`
  when the table doesn't have its own), then check
  `employee.companyIds.includes(thatCompanyId)` before allowing the write. `employee.companyIds` is
  every company the login can access; `employee.currentCompanyId` is which one they're *currently
  acting as* (switchable via the top-nav dropdown, cookie-backed, never trusted beyond "which
  company's data to show").
- **The `source` discriminator pattern**: several tables (`bill_pass_register` is the clearest
  example) have a `source` column — `NULL` means manually entered directly; a value like
  `'purchase_bill'`/`'freight_bill'`/`'salary_payment'` means this row is an auto-mirrored copy of
  another table's row. Editing a mirrored row directly desyncs it from its source — new edit UIs must
  gate on `source IS NULL` or sync the relevant fields back to the source table (see
  `updateFreightBillDetails`/`updateDutyBillDetails`/`updateBillPassRegisterEntry` in
  `src/app/dashboard/documents/actions.ts` and `src/app/dashboard/bill-payment/actions.ts` for the
  established pattern).
- **`src/types/database.ts` is manually kept in sync with *intended* schema, not necessarily *live*
  schema.** This is exactly the trap that caused the `gst_rate_pct` production outage on 2026-08-17 —
  the TypeScript types and app code referenced columns that were written into a migration file but
  never actually run against production Postgres. When adding a column: write the migration, update
  `database.ts`, update `db/schema.sql`'s matching `CREATE TABLE`, ship the code — AND get explicit
  confirmation the migration was actually run and re-verify via Supabase before considering the
  feature live.
- **`db/schema.sql` is documentation of the intended full schema, assembled from all migrations —
  it does NOT reflect what's necessarily live in production.** It had drifted out of sync for the
  `purchase_bills` table across 3 migrations before being caught and fixed on 2026-08-17. Update it
  whenever you write a new migration, in the same pass, not as a follow-up.
- **Generated columns reject direct writes.** `bill_pass_register.to_be_pay` and `balance_due` are
  `GENERATED ALWAYS AS ... STORED` (inlined formulas — see §3 rule 8). To zero out a merged/negated
  bill you write `total_amt = 0`, never `balance_due = 0` — the generated value follows
  automatically (this is exactly what `mergeDuplicateBills` does). Same shape as the existing
  `purchase_bills` generated columns.
- **Service-role vs. browser client**: `createServiceRoleClient()` (bypasses RLS, server-only) is
  used for essentially all real data access from Server Actions and Server Components, after the
  capability/company checks above. The `createClient()` browser-facing client uses the
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which is (by design, verified 2026-08-17) granted **zero** RLS
  policies on **any** table — so even though that key is public in the shipped JS bundle, it cannot
  read or write anything directly. All 74 public-schema tables have RLS enabled.
- **`Promise.all` for independent queries, sequential `await` only for genuinely dependent ones.**
  Several pages got this wrong (see §6) — new pages should batch from the start.
- **Excel/CSV import gotchas** (recur constantly across every bulk-import feature — Amazon/eBay/Etsy
  fee matching, bank statement import, payment reconciliation):  - openpyxl reads numeric-looking cells (AWB/invoice numbers) as Python floats — `str()` on them
    produces a wrong trailing `.0`. Fix: `str(int(v)) if isinstance(v, float) and v.is_integer() else str(v)`.
  - A single sheet can silently mix `DD-MM-YYYY` and `DD/MM/YYYY` string formats plus native
    datetime objects in the same column — handle all three; never fabricate a fallback date for a
    genuinely unparseable row, exclude it from the batch instead and report it as skipped.
  - Never silently truncate/drop rows that don't match — always report what was skipped and why.

## 5. Module map

| Route | What it does | Gating capability |
|---|---|---|
| `/dashboard/orders` | Core order entry/lifecycle, multi-currency, buyer info as free text (no structured customer table) | `order_entry` |
| `/dashboard/documents` | Credit/Debit Notes, Washing Entry, Internal Invoice, Purchase/Freight/Duty bills, CSB Filing, Shipment Chalan | `doc_entry` |
| `/dashboard/stock` | Raw-material Stock In/Out per (vendor party, SKU) — company-agnostic pool by design, current stock always computed live from the ledger, never stored. Now includes **Reorder Alerts** (added 2026-08-17, see §8) | `stock_entry` |
| `/dashboard/inventory` | Finished-goods stock — **auto-restock only** (a cancelled+refunded+already-purchased order flows qty back in); there is no manual finished-goods Stock Out, so this table has no consumption data to forecast from (don't confuse this with `/dashboard/stock`) | `finished_stock_view` |
| `/dashboard/bill-payment` | Bill Pass Register (the unified payable ledger — vendor/courier bills + salary/advance payouts). 2026-09-13/14 additions: per-bill 🧾 Credit Notes panel (new CN / link existing / manual register, 2 CN kinds: buyer_refund vs supplier/courier, GST slabs 5/12/18), per-row 📒 party-ledger link, payment-locked editing (admin-only once a payment exists), cross-company **invoice merge** (below), and a multi-AWB credit-note mode (one CN split across several AWB bills) | `bill_payment` |
| `/dashboard/crm` | Company-wide overview: order-status counts, today's attendance, data-quality alerts, P&L Dashboard, Quick Find, **Top Buyers** (added 2026-08-17, see §8) | `crm_dashboard` |
| `/dashboard/reports` | Orders report with filters, CSV/Excel/Word/PDF/Email/WhatsApp export. Links to **Returns/Refunds** (added 2026-08-17, see §8) | `reports` |
| `/dashboard/returns` | New — Returns/Refunds report (see §8) | `reports` (reused) |
| `/dashboard/attendance` | Punch in/out, Daily Work Report, work-hours anomaly alert | `attendance_punch` |
| `/dashboard/parties` | Party (vendor) master | `party_admin` |
| `/dashboard/salary` | Salary + advance tracking | `salary_admin` |
| `/dashboard/statements` | Manual entry for PDF-only statements (Etsy Monthly Tax Invoice, eBay Financial Summary) | `statement_entry` |
| `/dashboard/bank-recon` | 2026-09-17: Bank & Card Reconciliation — multi bank/card accounts (`recon_accounts`), flexible statement upload (auto column mapping + dedupe fingerprint), auto UTR/order/party/expense matching with verify dialog. **Writes only `bank_recon_links` + the statement line's own link columns — never touches bill_pass_register/internal_expenses/orders** | `bank_recon` |
| `/dashboard/shipglobal` | Real external shipment creation (costs money, real customs declaration) | `shipglobal_shipment` |
| `/dashboard/invoices` | Export sales invoice generation (CSB-V/CSB-IV) | `invoicing` |
| `/dashboard/admin/*` | Employee roster, Roles & Permissions, Companies/Items, Help Center admin | various `*_admin` |

Full table list: 103 tables in `public` schema, see `db/schema.sql` (4,617 lines, organized into
numbered sections — Section 17 is the reporting-views section, a good landing point).

## 5b. Cross-company invoice merge (2026-09-14) — how it works

The same real vendor invoice legitimately exists as SEPARATE `bill_pass_register` rows under
DIFFERENT companies (the owner's own workflow: 20 orders split 10/5/5 across Nyko Mart/Rugara/
CASA ARRA = one Purchase entry per company, same party + vendor invoice no.). The duplicate-guard
unique index deliberately allows this (company_id is part of its key — see the 2026-09-13 comment
in `db/schema.sql`). The merge feature folds those rows into ONE keeper for display/payment:

- **UI**: `bill-payment-list.tsx` — select the rows by checkbox; when the selection contains the
  same (party_id + vendor_invoice_no + invoice_type) under ≥2 companies, a teal merge bar offers to
  pick the keeper company. `merge-actions.ts` does the work.
- **Mechanics**: keeper's id/URL never change; every loser's `bill_pass_register_payments` and
  `bill_pass_register_adjustments` rows are RE-POINTED onto the keeper (payment documents are never
  copied/duplicated), then the keeper's `total_paid` recomputes from the combined ledger (same
  recompute-from-ledger pattern as `recordBillPayment`) and the losers' `credit_note_amt`/`adj_amt`
  sums move over. Losers are zeroed via `total_amt = 0` (generated to_be_pay/balance_due follow —
  see §4) and tagged with the new `merged_into_bill_id` FK (`db/2026-09-14-bill-merge.sql`), so
  they drop out of every `.gt("balance_due", 0)` view but survive as audit rows. There is no
  unmerge — a merged row refuses further merges.
- **Server-side sanity**: party/vendor-invoice-no/type must match across all participants, all
  companies must be within the caller's access, and `merged_into_bill_id` must be NULL on every
  participant. Party Ledger and every other consumer of `bill_pass_register` show the combined
  figures automatically because everything reads the same tables.

## 5c. FedEx per-company credentials + "Test connection" (2026-09-17)

Each of the 3 companies has its OWN FedEx account number, but the deployment's FedEx API key is one
shared org's key unless a company saves its own in Courier Ops → Account Setup (per-company rows in
`courier_credentials`, resolved field-by-field with env-var fallback — see
`src/lib/couriers/credentials.ts`). A real production 400 ("Account number not found") happens the
moment a company's account number is paired with a key whose FedEx org doesn't contain that
account — the shared env key is the usual culprit because the fallback is silent.

- `src/lib/couriers/fedex-test.ts` — `testFedexConnection()`: one quote-only Rate API call (never
  creates a shipment) proving the key+account pair works TOGETHER; result names WHICH key was used
  (company's own vs shared env).
- Account Setup's FedEx card has a **Test connection** button (server action in
  `credentials-actions.ts`, gated on `courier_credentials_admin`) that runs it against exactly what
  a booking would send (same `resolveCourierCredentials` resolution).
- `fedex-ship.ts`'s account-number 400 message also names the key source now, so a failed booking
  answers "whose key was my account paired with?" inline.

## 5d. FY date validation (2026-09-17) — "pura system FY par depend hoyega"

One typo'd year (20026-09-01) became its own bogus month at the top of P&L by Month because NO
entry form validated dates and a Postgres `date` happily stores year 20026. The gate now has two
halves, both anchored on the FY system (April = FY start, same as `fy_label()` in db/schema.sql —
no hardcoded year anywhere):

- `src/lib/fy-date.ts` — `validateBusinessDate()` / `validateDateFields()`: 4-digit-year +
  real-calendar-date checks, then a FY-anchored window = current FY start − 10 years … current FY
  end + 1 year (2016-04-01 → 2028-03-31 as of 2026). `FY_START_MONTH`/`PAST_FY_LIMIT`/
  `FUTURE_FY_LIMIT` drive everything. Wired into: createOrderCore (manual + marketplace cron),
  order edit, internal_expenses, purchase-bill core (single + multi-PO + CSV parse), debit/credit
  note, washing chalan, internal invoice cores.
- `db/2026-09-17-fy-date-validation.sql` — DB backstop: `NOT VALID` sanity CHECKs (1990–2099) on
  orders.order_date, purchase_bills.vendor_invoice_date, sale_profit_ledger.invoice_date,
  internal_expenses.expense_date — every OTHER write path (cron, CSV import, manual SQL) is
  covered too; NOT VALID means existing rows (incl. the known bad one) never block applying it.
- When a new form takes a business date, call `validateDateFields([...])` in its server action —
  that's the convention now.

## 5e. P&L: washing auto + marketplace-fee hybrid + breakdown (2026-09-17)

Audit confirmed P&L is accrual (bill-basis — `total_paid`/`balance_due` never appear in the views;
 unpaid bills still count as expense). Two gaps the user then asked to fix, both in
 `db/2026-09-17-pl-expense-breakdown.sql` (run once in Supabase; re-running the older
 breakdown-only version is harmless — this file supersedes it):

- **Washing is now automatic**: `washing_entries.amount + debit_charges` (chalan-date month) folds
  into `total_expenses_inr` via `expense_washing_inr`. Do NOT also log washing chalans as manual
  Expenses rows — double count. The old "log it manually in Expenses" advice (2026-08-20) is dead.
- **Portal fee hybrid**: real matched Etsy/eBay/Amazon fee COST (`portal_fees_matched_inr`, same
  matching keys as `matchMarketplaceFees()`, converted at each fee line's own-date official rate;
  eBay/Amazon lines with no rate row are skipped — verification query #3 lists them) offsets the
  flat 25% estimate: `net_earn = sale − expenses − GREATEST(25%·sale − fees_matched, 0)`.
  `portal_expenses_25pct` stays the raw estimate. Fees are NOT added to `total_expenses_inr` —
  that would double-subtract against the estimate.
- CRM page's P&L queries now fall back to base columns on view error — a missing migration can no
  longer blank both P&L tables (the empty-tables screenshot bug).
- Same day (evening): the ▾ is now an INLINE expansion row directly under the clicked entry
  (pure-CSS `tr.pl-expand`/`tr.pl-detail` pair in globals.css, no JS, no popover). Colors: expenses
  rose-600, money-in (sale/bank) sky-700, profit emerald-700. The expansion shows the expense split
  AND the full net-profit chain (Sale − Expenses − portal-effective = Net) plus `bank_inflow_inr`
  (verified bank-recon credits, both views) vs order value difference. Month view gained the
  `portal_expenses_25pct` column (it never had one).
- Same day (late, both user-approved): **portal REAL-IF-KNOWN** — `portal_expense_effective_inr` =
  matched Etsy/eBay/Amazon fees when the scope has any, else the flat 25% estimate (the earlier
  "25% − fees" hybrid was wrong: real fees ~10-15%, so a scope with real data must not also carry
  the leftover estimate). **Courier/Duty CN auto-proportional** — `freight_awb_net_view` /
  `duty_awb_net_view` split each bill's credit note across its AWBs pro-rata by gross amount (plus
  each AWB's own manual credit/debit note columns), and P&L courier/duty expense now sums the NET
  amounts; bill_pass_register payables untouched. Both in db/2026-09-17-pl-cn-allocation-and-
  portal-real.sql (run AFTER the breakdown migration).

## 5f. P&L by Month is per-COMPANY + orders multi-photo + capability auto-sync (2026-09-18)

- **P&L by Month per company**: the month view previously merged ALL companies into one row per
  month — wrong for a multi-company system. `db/2026-09-18-pl-month-per-company.sql` rebuilds
  `pl_dashboard_by_month_view` with company_id/company_name on every CTE (DROP+CREATE — NOT
  CREATE OR REPLACE, which can only append columns and would 42P16 like the user's earlier
  Supabase error). The CRM month table now defaults to the current company, with an "All
  Companies" dropdown (`?fyco=`) next to the FY selector; month-row React keys are
  `company_id:month` (a month now has one row per company).
- **Orders multi-photo (links)**: `orders.photo_urls text[]` holds the FULL list;
  `orders.photo_url` stays canonical photo #1 (thumbnail/print/WhatsApp unchanged).
  Backfill: existing photo_url rows get `ARRAY[photo_url]` (idempotent, migration does it).
  UI: "+ Add Photo" rows (`multi-photo-urls.tsx`) on the New Order item block and the inline
  edit form — extra links are plain URL inputs sharing one name (edit path `formData.getAll`,
  new-order path RadioNodeList off `form.elements`), serialized via items_json for the new
  path. Detail/print view shows every photo, each linking to the full image. Marketplace cron
  and CSV insert pass `photoUrls: []`/single-wrap.
- **Capabilities auto-sync**: the `capabilities` TABLE was seeded once by db/schema.sql, so app
  capabilities added later (bank_recon, companion_admin, leave_*) never appeared in Roles &
  Permissions. Now `syncCapabilitiesFromRegistry()` (src/lib/capability-sync.ts) pushes the
  live CAPABILITY_INFO registry through the `sync_capabilities(p_codes, p_descriptions)`
  Postgres function on EVERY Roles & Permissions page load — upsert + description refresh,
  grants NEVER touched; deploy + one page visit is the whole sync. The matrix's left column
  now shows the app label above the raw code. db/schema.sql also gained the missing seed rows
  (fresh databases) + the function definition; run
  `db/2026-09-18-orders-multi-photo-and-capability-sync.sql` once on production for
  photo_urls + the function (the next permissions page visit does the rest).

## 5g. Ad Spend: Amazon country split + statement verification (2026-10-15)

Two user-requested additions to `/dashboard/ad-spend` (module: `src/app/dashboard/ad-spend/`).

- **Amazon Country dimension** — "AMAZON ME ALAG ALAG COUNTRY KE HISAB SE BUDGT & SPEND HOTA HAI TO
  USKA MERE HISAB SE COUNTRY SECTION OR BAN JAYE JO SIRF AMAZON PAR WORK KARE". `store_ad_spend`
  gained `country_code` (db/2026-10-15-ad-spend-amazon-country.sql + folded into db/schema.sql) and
  its unique key became (store, date, country); the old (store, date) key is dropped by the
  migration. The 12 countries + currencies live in `amazon-countries.ts` (US CA MX AU GB DE IT JP FR
  ES IN AE) and are validated in both the action and a DB CHECK. The Country field appears on the
  entry form **only** for stores whose name matches `/amazon/i` (the app's existing Amazon-store
  convention — orders/new/page.tsx does the same) and is required there; Etsy/eBay/Website stores
  keep exactly one row per day with `country_code = ''`. Country codes are stored, never labels.
- **Statement verification + link** — "STORE KI MONTHLY STATEMENT SE BHI VERFY NAHI HOTA HAI ...
  OR LINK HO JAYE". Every row of the Monthly Roll-up, Daily Master and the Amazon Country table now
  carries a Statement column: ✅ matched/total, ⚠️ partial, ⏳ nothing imported (plus "No orders" for
  a spend-only row), derived from `matchMarketplaceFees()` — the SAME matcher the Orders hub and the
  Store Expense Report use, so "verified" can't drift between screens. Each row links to
  `/dashboard/reports/store-expenses?store=…&from=…&to=…` (that store+month's statement lines, order
  by order). Import/type statements on Statement Entry / CSV Upload.
- **Aggregation moved out of the page**: all report math (country split, roll-ups, verification
  counts) now lives in the pure `ad-spend-stats.ts` (`buildAdSpendReport`), same pattern as
  `daily-sheet-stats.ts`, so screen / print / CSV-Excel exports can never disagree. Behaviour for
  non-Amazon stores is unchanged (verified with a stub run: same qty/usd/budget/spend per store+day).
- **Known caveat**: Amazon rows entered BEFORE this migration have `country_code = ''` and therefore
  show under the Country table's **Other** row until someone re-saves them with a country; the same
  happens for buyer countries with no Amazon ad account (e.g. Netherlands). The section's own note
  says so on screen.
- **Entry-form UX**: the Store select is now controlled and (with the country) stays selected after
  Save — Budget/Spend/Date still reset — so an Amazon day is entered country by country instead of
  re-picking the store 12 times.

## 5h. B2B: a not-yet-run PI migration is now VISIBLE (2026-10-15)

- **Symptom it fixes**: after the 2026-10-13 PI export round, the Proforma Invoice printed
  "To be provided" in its payment-terms / port / packing / item-spec blocks with no error anywhere
  ("ye cheezein nahi aa rahi"). Cause: `page.tsx` loaded quotations with `select("*")`, and PostgREST
  returns only the columns that EXIST — a missing column never errors, so
  `db/2026-10-13-b2b-pi-export-fields.sql` being un-run was invisible.
- **Fix**: one extra cheap probe query asks for 4 of those columns EXPLICITLY
  (`payment_condition, port_of_loading, port_of_destination, packing_details`, `limit(1)`); before the
  migration it fails loudly and that message now feeds `loadError` → the existing 🛠️ SetupNotice card,
  which lists the SQL files to run in order. `db/2026-10-13-b2b-pi-export-fields.sql` was added to that
  list (it was already named by the separate export-profile banner).
- Deliberately still non-fatal for everything else: the register, quotations and payments keep loading
  exactly as before — only the missing-column piece is surfaced.

## 5i. UI/UX cleanup round — English UI text, responsive layout, theme-aware text (2026-10-15)

Requested as one sweep: "UI professional honi chahiye · koi bhi text/column kisi par nahi chadh raha ho ·
font black ho normally lekin theme ke according auto adjust ho · jaha bhi hindi ke word ho unko english
me update karo". What was actually done, and what the audit found:

- **Hinglish → English in every USER-VISIBLE string** (there was NO Devanagari anywhere in `src/`, so
  the target was Roman-script Hinglish): buttons, notes, empty states, toasts, validation/error
  messages, placeholders and dialogs — entry forms, bill payment + wallet panel, credit-note panel,
  documents (A4 dialog subtitles), orders (WhatsApp/Telegram send + photo field), attendance
  (Telegram connect, recurring work), courier booking (address/ETD hints + CSB-V preview), expenses
  (recurring debits), admin (departments), b2b (quotation engine), statement/bill duplicate-entry
  errors, and the AI companion + WhatsApp/Telegram send-route replies. Code COMMENTS were deliberately
  left in the repo's own voice — they are internal notes, not UI.
- **Horizontal overflow / squashed columns**: every screen table that lacked a horizontally scrollable
  container got one (`overflow-x-auto`, and `overflow-y-auto` → `overflow-auto` where a table sat in a
  fixed-height box): credit-note panel, wallet panel, companion access, settlement detail view, party
  ledger (`min-w-[820px] print:min-w-0` so the print/PDF path is unaffected). Attendance admin tables
  were already fine (shared `tableWrapClass`).
- **Responsive entry-form grids**: 23 non-responsive `grid-cols-3/4/5/6` field rows across 11 forms
  (duty bill, freight bill, credit note, purchase-bill multi, inline shipment, invoice generate, stock
  in, order hold/cancel, b2b products) became `grid-cols-1 sm:grid-cols-2 lg:grid-cols-N` — same 3/4/5
  column look on desktop, stacked on a narrow screen. A4 print documents were intentionally left alone.
- **Text color / typography (globals.css)**: `body` now uses the theme's own `--font-sans` stack
  (system-ui…) instead of Arial; inside `[data-theme]` the inherited text color is the theme's own
  `--oms-text` (near-black in every shipped theme) and tables use tabular figures. Both rules are
  INHERIT-ONLY — nothing that sets its own color (white-on-accent buttons, status pills) is forced, so
  the theme keeps auto-adjusting exactly as before.
- **Audit results (no work needed)**: 52 static internal `href`s, all capability tiles, and every
  `redirect()`/`router.push()` target resolve to a real `page.tsx` — zero broken links; zero orphan
  dashboard routes; no `href="#"`, no empty handlers, no "coming soon"/TODO placeholders. `printing-
  register` is linked from Stock + Documents (it has no tile of its own, by design).
- Removed dead code the linter flagged: an unused `totalOutstanding` computation and an unused
  `companies` prop (type + its single caller). Remaining ESLint warnings are 2 `no-img-element`
  suggestions (deliberate: PDF/document images) and one underscore-prefixed server-action param.

## 5j. Attendance Admin: manual punch now records the ACTUAL TIME (2026-10-15)

User report: "ATTENDANCE ADMIN VALE ME MANUAL PUNCHING KAAM NAHI KAR RAHA HAI OR USME YE BHI HONA
CHAHIYE KI KITNE BAJE KA PUNCH DALNA HAI".

- **Why it looked broken**: the Manual Correction panel took only a Status + Remark, so a manual
  entry could never record a punch — the row came out with `punch_in`/`punch_out` NULL, hence no
  work hours and nothing that looked like a punch in any report. Nothing was throwing; the feature
  simply had no time fields.
- **Fix**: `manual-attendance-form.tsx` gained controlled **Punch In time (IST)** / **Punch Out time
  (IST)** inputs (type="time", 24h). Punch Out stays disabled until a Punch In is typed.
  `setManualAttendance` in `attendance/admin/actions.ts` validates and converts them with the new
  `istTimeToInstant(date, hhmm)` (`ist-date.ts` — the "+05:30" is written into the parsed string, so
  the stored timestamptz is correct regardless of server timezone) and stores real `punch_in`/
  `punch_out`; `work_hours` is the existing generated column and keeps working unchanged.
- **Status follows the same rule as a live punch**: with only a Punch In typed, the status is derived
  via the new `attendanceStatusForPunchIn()` (`lib/attendance/punch.ts`, exported alongside
  `LATE_CUTOFF_HHMM`) — Present at/before 09:45 IST, Late after — unless the admin picks a Status
  explicitly. Entering only a Punch Out is rejected on a day with no Punch In (“Punch Out needs a
  Punch In”).
- **Corrections never destroy data**: on an existing row a BLANK time field leaves the stored punch
  untouched (only the fields that were actually filled in are written), and a punch-out-only
  correction keeps whatever status the day already had. The success message now reports exactly what
  was saved ("Saved — Punch In 09:20 · Punch Out 18:05"), which is what makes the punch visible in
  the UI at all.

## 5k. Ad Spend: Amazon totals converted at a LIVE rate that updates itself (2026-10-15)

User request: "ISME EK CHIZ OR ADD KARO TOTAL BUDGET KITNA HUA AMAZON KA SPEND KITNA HUA PERFECT
CALCULATION SE ACTUAL CONVERASTION KE HISAB SE JO DAILY BASIS PAR UPDATE HO AUTOMATICLY GOOGLE SE".

- **New `fx_rate_cache` table** (`db/2026-10-15b-fx-rate-cache.sql`, folded into `db/schema.sql`) —
  base USD, machine-refreshed, used ONLY for on-screen conversion. Deliberately separate from
  `exchange_rates`, which is the customs/legal rate master (one row per currency per CBIC
  notification, entered by Finance) and must never be overwritten by an API feed.
- **`src/lib/fx/rates.ts`** (`loadFxSnapshot`) — reads the cache, and refreshes from
  `open.er-api.com` (keyless, updates once a day, returns its own “rates last changed” stamp) when
  the snapshot is missing or older than 12 hours. NO cron job: any screen that is opened keeps it
  fresh, so the numbers are at most a day old. A failed fetch never breaks the page — the previous
  cached values are shown with a ⚠ note, and the manual **↻ Refresh rates** button (new
  `refreshFxRatesAction`) forces a pull right now. Cross rates are derived (GBP→INR = usdToInr /
  usdToGbp); `AMAZON_CURRENCIES` in `amazon-countries.ts` is derived from the country list itself so
  the two can't drift apart.
- **Amazon Country section** (`/dashboard/ad-spend`, Report tab): a summary strip above the table now
  shows Total Budget (USD), Total Spend (USD), **Total Spend (₹)** at the live rate, Budget Used %,
  Total Sales (USD) + order count, and Spend % of Sales; the table gained a **Spend (₹ @ live rate)**
  column (and the totals row converts with it, so the footer and the strip agree); a line under the
  strip prints “Actual conversion: 1 USD = ₹…”, the provider, when THIS app fetched the rates and
  when the market rate last moved. All of it is derived from the same `amazonCountryRows` the table
  renders, so screen / CSV / Excel export cannot disagree. CSV/Excel exports carry the ₹ column with
  its rate.
- The rates are loaded ONLY when the scope actually contains an Amazon store (`report.hasAmazonStore`)
  — an Etsy/eBay-only view makes no network call at all.

## 5l. Document Entry — View & Print ab sabhi same page par A4 dialog me (2026-10-16)

User report: "Document entry me kisi bhi credit note / debit note / washing entry / internal invoice
/ purchase bill / CSB filing ko view nahi kar sakte jo A4 dialog box me khulna chahiye tha, print
naye page par lekar jata hai, edit alag page par lekar jata hai jabki ye sabhi same page par dialog
box me khulni chahiye."

- **What was actually true at the time**: Edit had ALREADY been fixed (2026-09-19 — every tab's Edit
  opens in the shared `A4Dialog`, no edit form navigates). The real gaps were View and Print:
  Debit Note / Washing Entry / Internal Invoice had NO per-row view at all; Credit Note & CSB
  Filing only had the statement sheet; Purchase Bill only had one when already sent to Finance
  (`finance_bpr_id`); Credit/Debit Note & Internal Invoice "Print" links navigated to a separate
  `/dashboard/documents/.../[id]/report` page; Washing/Purchase/CSB had no per-row print at all.
- **New `src/app/dashboard/documents/doc-entry-a4.tsx`** — ONE shared A4 preview sheet for the 6
  flat types, built per-type from the list row's OWN record (`creditNoteDoc` / `debitNoteDoc` /
  `washingEntryDoc` / `internalInvoiceDoc` / `purchaseBillDoc` / `csbFilingDoc` → one
  `DocEntrySpec` → `DocEntryA4`). No API fetch, so it can never 403/404 the way a statement route
  can and it works for bills not yet in Finance. Washing total = amount + debit_charges (same sum
  as the list Total line and the CRM P&L washing line); Purchase grand total mirrors the list's
  GST/round-off logic; each sheet is wrapped in the shared `PrintArea` (A4 @page + Generated-by
  footer).
- **DocList (`document-entry-tabs.tsx`)** gained `renderView`: an "👁 View" button per row opens the
  sheet inside `A4Dialog` with **🖨 Print / Save PDF + Close in the dialog footer** — `window.print()`
  prints that document only, nothing navigates anywhere. The old `printHref` report-page links were
  REMOVED for exactly these 3 types (Journal Voucher / Received Chalan keep theirs — not in scope).
  The statement triggers stay (WhatsApp/Telegram/email/PDF bar) but now read "🧾 Statement"
  (`statementLabel`) so they don't collide with the new "👁 View" label.
- **`a4-dialog.tsx` print + portal fix (matters for every A4Dialog user)**: the dialog now renders
  via `createPortal` into `document.body`, and its own `@media print` block hides every OTHER body
  child with `display: none` (layout-removing, unlike the old `visibility: hidden` approach, so the
  hidden shell can't emit blank pages) and makes the overlay/panel `position: static` + full-width
  (a fixed overlay pins print output to ONE page — the exact bug print-view.tsx's 2026-08-19 fix
  documents). The portal also fixes a latent conflict: a dialog opened from a Document Entry row
  lives inside the lists' shared `#doc-lists-print-area`, whose PrintArea CSS marks EVERYTHING in
  that list visible, so printing from within an in-tree dialog would have printed the whole Recent
  list around the document.
- **Verified**: `npx tsc --noEmit` → 0 errors; `npx eslint` on the 3 changed files → clean. No
  browser/Playwright exists in this workspace, so the print-to-PDF path was verified by the CSS/
  structure reasoning above (same PrintArea recipe the Bill/Doc statement sheets already use), not
  by an automated PDF test — re-check once manually: open any Credit/Debit Note row → 👁 View →
  Print / Save PDF → output should be that one document on A4.

## 5m. B2B Inquiry/Quotation — full unit dropdown, PCS-only calculation gone (2026-10-16)

User report: "quotation vale section me inquiry agar aayegi to kese handle hoyegi — bs pcs se
calculation hori, baki CM, MTR, FEET, INCH, SQ FT, SQ MTR, PER SQ FT, PER INCH VALE SECTION
NAHI HAI".

- **How an inquiry is handled** (unchanged, for the record): B2B → Inquiries → "New Inquiry"
  registers the buyer + asked-for item rows (qty × unit × rate) → the inquiry's **Quotation /
  Invoice** tab builds Q-<FY>-#### with DB-computed totals → PI/CI/PL documents → WhatsApp/email
  share. The gap was only the UNIT on those item rows.
- **`ITEM_UNITS` extended** (`src/lib/b2b/erp.ts`): added `feet`, `inch`, `cm` (length) and the
  rate-units `per pcs / per mtr / per feet / per inch / per sq ft / per sq mtr` a carpet/rug
  inquiry actually prices by — mtr/yard/sq ft/sq mtr were already there.
- **ONE shared `UnitSelect`** (`b2b-client.tsx`) now drives every item editor: the New Inquiry
  modal, BOTH "Asked-for Items" blocks in the inquiry details form (which were free-text Unit
  boxes — in practice only "pcs" ever got typed and the PI printed that text), and the quote form
  (which already had its own copy of the same select+"Other…" logic — now deduplicated). One-off
  units still possible via "Other…".
- **Calculation untouched on purpose**: subtotal = Σ qty × rate is unit-agnostic server-side
  (actions.ts), so every unit computes identically; unlike Purchase Bills there is NO conversion
  to a base unit (toFeet) — a quote must show the buyer exactly the unit they asked in.
- **Verified**: `npx tsc --noEmit` → 0 errors; `npx eslint` on both changed files → clean.

## 5n. Leave — full audit trail (applied date/time + location, approved-by), daily record, on-leave board, cancel/modify (2026-10-17)

User request: "leave apply karta hai to usme date & time nahi aata with location", "approve
hone ke baad ye bhi aana chahiye ki leave approve kisne ki hai kis time par ki hai", "daily
bases par record hona chahiye ki kitne logo ki leave application aayi hai or kitno ki approve
hui hai", "admin ko notification dikhta rahna chahiye ki ye bande itni itni date ko leave par
hai", "agar koi leave lekr bhi office aajata hai to vo apni leave approve ko cancel karvayega
ya phir modify karvayega ki full day ki jagah halfday ya jitne din ki application hai usme
kitne din pahle aaya hai".

- **Schema** (`db/2026-10-17-leave-audit-and-lifecycle.sql`, folded into `db/schema.sql`):
  `leave_requests` gained `applied_lat/lng/accuracy_m` (application-time browser geolocation,
  best-effort like punch GPS) and `cancelled_by_employee_id/cancelled_at/cancelled_remark`;
  `leave_request_status` gained a 4th value **`Cancelled`** (withdrawn — distinct from
  Rejected); new append-only **`leave_request_events`** table (event_type/actor/event_at/
  details) is the per-request audit trail. Hand-types added to `src/types/database.ts`.
  ⚠️ **Supabase me manually chalana hoga** — run the migration, then re-run
  `db/2026-08-08-enable-rls.sql` (idempotent) so the new table gets the blanket
  authenticated-only policy.
- **Apply captures date + time + location**: the form takes a one-shot best-effort geolocation
  fix (same `geolocationBestEffort` contract as punch-buttons — GPS can never block a submit),
  stores lat/lng/accuracy, and every request now DISPLAYS "Applied 17 Oct 2026, 09:42 · 📍
  26.9124, 75.7873" (Maps link) on both the employee's My Leave Requests and the admin row.
- **Approved-by is now visible**: `decided_by/decided_at` were already stored but never shown —
  both UIs now show "✓ Approved by <name> on <date, time>" (and the Rejected/Cancelled
  equivalents), plus a per-request **History** list built from `leave_request_events`
  (Applied/Approved/Rejected/Cancelled/Half Day/Shortened — actor + IST time + remark).
  Every lifecycle transition in `actions.ts` writes an event (`logLeaveEvent`, best-effort so
  an audit failure never blocks the operation itself).
- **Daily record**: admin Leave Approvals now has a "Daily Leave Record (last 14 days)" table —
  per IST day: Applied / Approved / Rejected / Cancelled counts, live-aggregated from
  `leave_requests` (no stored counters).
- **On-leave board + bell**: admin page shows "On Leave — today & upcoming (7 days)" (one row
  per date, who is away, TODAY row highlighted) so attendance is never marked for someone on
  leave; the header notification bell gained two `leave_admin`-gated items — "Leave requests
  pending approval" and "Employees on leave today" (both plain indexed counts, same
  `.catch`-guarded pattern as the L1/L2 bill counts in layout.tsx).
- **Cancel / Modify** (the "came to office anyway" case) — three new server actions in
  `leave/actions.ts`, all usable by the request's OWN employee or any `leave_admin` of its
  company (`canActOnRequest`), all CAS-guarded on status, all writing audit events:
  - `cancelLeaveRequest` — Pending or Approved → `Cancelled`; on an Approved one it deletes
    ONLY the auto-marked `remark='Approved leave request'` attendance rows (real punches and
    admin-entered rows untouched) and removes its coverage assignments (those grants existed
    FOR the absence).
  - `markLeaveHalfDay` — flips one already-taken full Leave day to `Half Day` (payroll already
    counts Half Day as 0.5 — payroll.ts:160, no payroll change needed).
  - `shortenLeaveRequest` — new earlier `to_date`; chops the auto-marked attendance beyond it
    and trims/clamps coverage rows sticking past the new end.
  - Shared UI `leave-lifecycle-actions.tsx` renders the buttons on BOTH the employee page and
    the admin row (server re-gates who may act); modify form only shows for Approved requests,
    half-day select only offers dates up to today.
- **Verified**: `npx tsc --noEmit` → 0 errors; `npx eslint` on all 7 touched TS files → clean.
  Not yet run against the live DB (migration pending, see above) and not yet committed.

## 5o. Build fix + dialogs hold the page only, salary structure split out, advance corrections, TeamOffice matrix import (2026-10-19)

User request: "ye error thik karna hai", "dusra order page ho ya koi or page agar dilog box me open ho to sirf
page hi open ho puri ki puri window open nahi ho. order page me view me puri window open ho rahi hai", "sallery set
karne ka stracture sahi nahi hai isko alag se bano sahi se", "kisi ko payment ho gaya ya sellery advance me gyi hai
or vo galat gyi hai to usko delet edit modify karne ka opetion nahi hai", "attendance sheet sahi se campair ho rahi
ahi kya".

- **The Vercel/typecheck failure (root cause)**: a later commit (`94346ec`, "Add files via upload") replaced
  `db/schema.sql` + `src/types/database.ts` with copies made BEFORE the 2026-10-17b B2B area-pricing round, so
  every column that round added vanished from the types while the code still wrote them — `b2b_inquiry_items`
  lost `size/size_length/size_width/size_thickness/size_unit`, `b2b_sales_order_items` lost the same plus the
  app-maintained `line_total`, and `customs_exchange_rates` disappeared entirely (breaking `src/lib/fx/customs.ts`,
  the B2B control-centre/reports screens and `orders-client.tsx`). Both files were re-merged: the upload's leave
  work kept, the 2026-10-17b columns/table restored verbatim (see `git diff e79389d -- db/schema.sql` — it now
  shows ONLY the leave additions).
- **Dialogs now show the page, not the whole window** (`?embed=1`): the Orders hub's View button framed
  `/dashboard/orders/[id]`, which renders inside the dashboard layout — so the dialog contained the entire app
  (sidebar, header, module tabs) around one order. `src/proxy.ts` now turns `?embed=1` into an `x-embed` request
  header and `dashboard/layout.tsx` skips ONLY the chrome for it (every provider still mounts, so the page behaves
  identically; auth and the cookie-refresh flow are untouched). `A4Dialog`'s iframe and every `PrintDialog` preview
  (`src/components/print-dialog.tsx`, used by all Document Entry print buttons) append the param themselves, and
  `OrderView` gained `embedded` (hides "← Back to Orders", opens other links in a new tab) so a framed page can
  never navigate itself to the full shell. The detail page's data loading moved to
  `orders/[id]/order-detail-loader.ts` — one loader, so page and dialog can't disagree.
- **Salary Structure is now its own screen** (`/dashboard/salary/structure` + `salary-structure-editor.tsx`): the
  old "Decide & Feed" strip squeezed Monthly Salary / Allowed Leave / Effective Date into one unlabelled 5-column
  row with the CTC block revealed underneath ("stracture sahi nahi hai"). It is now an A4-dialog editor in labelled
  sections — 1 Employee & Effective Date, 2 Pay Mode (Flat vs CTC), 3 Earnings split (Basic %/HRA %), 4 Statutory
  (PF %/ceiling, ESI %, Professional Tax + state), 5 What This Pays (payable monthly, per-day, extra-duty, no-leave
  bonus, full CTC breakdown). Same server action (`setEmployeeSalary`): a new effective date inserts a version, an
  existing date corrects it. `salary-form.tsx` was deleted; the Salary page keeps the month's payroll and links here.
- **Wrong payments / wrong advances can now be corrected**: `deleteSalaryPayment` + `updateSalaryPayment` already
  existed but were 10px underlined text — now real buttons. For advances there was NO correction path at all, so
  two new ops were added to `salary/actions.ts`: `updateAdvance` (amount/date/reason/recovery schedule, refuses to
  go below what salary payments already recovered, keeps the `bill_pass_register` mirror in step) and
  `deleteAdvance` (removes the advance + its Finance ledger mirror; refuses while any of it is recovered, so an
  employee's outstanding balance can never be silently rewritten), both wired into the Advances list behind an A4
  dialog.
- **Attendance import now reads TeamOffice's real export**: the block/matrix shape (a wide day-column header, then
  a 10-row block per employee — Dept. Name / Empcode / IN / OUT / WORK / Break / OT / Status) was previously fed to
  the row parser, which produced exactly the "no IN/OUT time — skipped" + "no active employee matches code 'WORK'"
  wall the import page was showing. `parseBlockLayout()` in `src/lib/attendance/punch-import.ts` detects that shape
  (day columns → dates; `Month: 07/2026`-style titles or the fallback date supply the month for columns printed as
  plain day numbers), and the ordinary row/headerless/CSV layouts still parse byte-identically (verified with a
  compiled-module harness). Employee matching also tolerates `2` vs `0002` (leading-zero-insensitive code index).
- **The comparison itself is now visible** ("attendance sheet sahi se campair ho rahi hai kya"): the device-vs-web
  result was stored in `attendance.match_flag` but shown nowhere. `importPunchReport` now returns a per-row
  comparison table (employee, date, web IN/OUT, sheet IN/OUT, verdict) plus matched/mismatched counts, rendered on
  the import page — mismatches highlighted, and Leave/Holiday/Week-Off rows explicitly say the recorded status was
  kept on purpose.
- **Verified**: scoped `npx tsc --noEmit` (every touched file, in one project) → 0 errors; `npm run lint` → 0 errors
  (7 pre-existing warnings elsewhere); block/row parser behaviour exercised through the compiled module (matrix
  paste → one row per employee per dated column; plain and headerless pastes unchanged; month-year title wins over
  the fallback date). Full `npx tsc --noEmit` still OOMs in the 2 GB sandbox — CI's build job carries it.

## 5p. Leave lists went blank, and WHO is on leave today (2026-10-19)

User request: "pichlli leave jo approve ki hai vo nahi dikh rahi or na hi pending me padi — leave request nahi
 dikh rahi", "kis employee ne kitne baje or kab request dali hai or uski application request ko kisne approve kiya or
 kitne baje kiya", "admin ko md ko ye dikh jaye ki aaj ye employee leave par hai, bell notification chala jaye".

- **Root cause of the invisible lists** — the 2026-10-17 audit round (see §5n) added
  `applied_lat/applied_lng/applied_accuracy_m/cancelled_*` to `leave_requests` and the
  `leave_request_events` table, and both leave SCREENS then selected those columns unconditionally. On a database
  where that one-time migration has not been run, PostgREST answers "column does not exist", Supabase returns
  `data: null`, and the page rendered its EMPTY state — "No leave requests yet." / "No leave requests for this
  company yet." — over data that was never missing. Applying for leave failed the same way (the insert wrote the
  geo columns). Verified against history: `git show e79389d:src/app/dashboard/leave/page.tsx` selected only base
  columns.
- **Fix (`src/app/dashboard/leave/leave-queries.ts`)** — one migration-tolerant reader: try the full row, and on a
  missing-column/missing-table error (42703 / 42P01 / PGRST204 / PGRST205, or "does not exist"/"schema cache" in the
  message) retry with the base columns the workflow has always had, reporting which one it used. Anything else
  (permissions, network) still surfaces as a real error instead of being swallowed. `fetchLeaveEvents` returns
  `available: false` for the absent events table; `isMissingSchemaPiece()` is the single classifier. Both screens use
  it, so every pending and approved request shows either way and only the audit extras (location, approver, timeline)
  go missing. `submitLeaveRequest` now writes the request itself first and adds the location only when the database
  can take it; `cancelLeaveRequest` explains the missing migration instead of echoing a raw Postgres error. Both
  screens show a one-line amber banner naming `db/2026-10-17-leave-audit-and-lifecycle.sql` while it's outstanding,
  and a red banner if the read genuinely failed.
- **Who requested when / who approved when** — already rendered per row (`applied 17 Oct 2026, 09:42`, `✓ Approved by
  <name> on <date, time>`, plus the per-request History timeline); it was invisible purely because the rows never
  loaded.
- **Bell now names today's leave, not just counts it** — `notification-bell.tsx`'s item type gained an optional
  `details` line, and `dashboard/layout.tsx` resolves the employee_ids from its existing "approved leave covering
  today" query against the employee list it already fetches for the messenger (no extra query, base columns only, so
  it works before the audit migration too). The item reads "On leave today — Ajay Mahawar, Sahil +1 more" with the
  count badge, linking to Leave Approvals, where the On Leave board already highlights TODAY.
- **Verified**: scoped `npx tsc --noEmit` over every touched file → 0 errors; the fallback itself exercised through
  the compiled module with a stub client — audit present → rows + `audit: true`; audit missing → **rows still
  returned**, `audit: false`; permission error → surfaced, not swallowed; missing events table → `available: false`;
  classifier true for PGRST204/42P01/"does not exist" and false for permission errors.

## 5q. Back-dated leave application (2026-10-20)

- **Asked:** "ek leave application agar back date me dalni pade to uska bhi karna".
- **What was blocking it:** only the client. `leave-request-form.tsx` pinned BOTH date inputs with `min={today}`;
  `submitLeaveRequest` never rejected past dates (it only enforces `to_date >= from_date` and the 90-day sanity
  cap), and `decideLeaveRequest` already writes Attendance as "Leave" for every qualifying day in the range — past
  days included, skipping days that are Holiday/Week Off or already have a real Present punch.
- **Fix:**
  - `leave-request-form.tsx` — From date has no `min` any more (a back-dated range is the point), and is tracked in
    state so the To date's `min` is the chosen From date instead of today (a one-day past leave works; the range
    can never be entered backwards). A short line under the two inputs says back-dated applications are allowed and
    that approval marks those days' Attendance (days with a real Present punch are left alone). The controlled From
    value is cleared on success via the codebase's render-phase `prevState` pattern (an effect-based `setFromDate`
    trips `react-hooks/set-state-in-effect`).
  - `submitLeaveRequest` — dates now also pass `validateDateFields()` (`src/lib/fy-date.ts`), the same FY/real
    calendar gate every other human date entry uses. This deliberately does NOT forbid the past (the window reaches
    10 FYs back); it stops a typo'd year (e.g. 20026-10-01) from being saved and then auto-marking Attendance in a
    month that does not exist. A request whose From date is already behind today is tagged `backDated`: the audit
    event detail starts with `Back-dated (<from> is before today <today>)` and the success message says so too.
  - Both lists now show a `⏪ Back-dated` chip when `from_date < today` — the employee's own list and the
    MD/Admin approval row (where it matters most: approving writes Attendance for past days).
- **Deliberately unchanged:** allocation of paid vs unpaid days for a back-dated range still walks the leave year
  chronologically with `usedDaysBeforeThisRequest` = paid Leave days already used that year — the total balance is
  unaffected by entering a request late; only which specific days end up flagged unpaid can differ in a
  near-the-limit year (same behaviour every existing late/edited request already had).
- **No migration needed** — no new columns; the audit detail rides the existing `leave_request_events` row.
- **Verified**: `tsc -p tsconfig.ci.json` (whole project) → 0 errors; `npx eslint` on all 4 touched files → clean.
  Not exercised against the live DB.

## 5r. Leave — MD/Admin can file an application FOR an employee (2026-10-20)

- **Asked:** "kisi employee ki khud admin apsent application dale to vo option bhi hona chahiye" — an employee who
  is already absent (or on a shop floor with no laptop) cannot fill the form himself.
- **Where:** the MD/Admin screen (`/dashboard/leave/admin`) gained a collapsible **"📝 File a leave application for an
  employee"** card. It reuses the SAME `LeaveRequestForm` component as the employee screen — there is no second form
  to keep in sync — with two extra props: `employees` (that company's active staff, self excluded) and `selfName`.
  With `employees` empty the form is byte-for-byte the old self-application form.
- **How it works:** the employee selector posts `employee_id`. `submitLeaveRequest` treats an absent/self value as the
  ordinary self-application path; any other id must pass BOTH `leave_admin` on the caller AND a server-side lookup
  (employee exists, is `active`, and belongs to a company in `caller.companyIds`). Everything downstream — leave-type
  validation, approver resolution, the three-step insert fallback for half-applied migrations — now keys off that
  resolved target (`targetEmployee.id` / `.companyId`) instead of the logged-in user, so the request is saved in the
  employee's name and their company. A posted id is never trusted (same rule as every other dropdown in this app).
- **Location is NOT copied:** the browser fix belongs to the ADMIN's device, so `applied_lat/lng/accuracy` are stored
  NULL on the on-behalf path (the client also skips the geolocation prompt). The audit event instead records
  `Filed by <admin> (MD/Admin) for <employee>`.
- **Optional "Approve immediately" checkbox** (on-behalf path only, never for one's own leave): the action calls
  `decideLeaveRequest` itself, so the status CAS, the Approval audit event and the Attendance "Leave" writing —
  including the Holiday/Week-Off and existing-Present-punch guards — are the same code path, never a copy. If that
  auto-approve fails the application is still saved and the message says to approve it from the list.
- **No migration, no schema change.** `leave_requests` has no "filed by" column; who filed it lives in the existing
  `leave_request_events` trail.
- **Verified:** whole-project `tsc -p tsconfig.ci.json` → 0 errors; `npx eslint` on the 4 touched files → clean.
  Not exercised against the live DB (no Supabase connection in this workspace).

## 6. Security posture (audited 2026-08-17 — see project doc `app-code-security-audit-2026-08-17.md` for full detail)

**Overall: well-guarded, no critical findings.** Specifically verified:

- All 74 public tables have RLS enabled; zero policies grant `anon`/`public` role access — the
  browser-exposed anon key has no direct table access at all. All real access is through Server
  Actions using the service-role client, after capability + company checks.
- No hardcoded secrets in source; `.env.local` never committed; `.env.example` is placeholder-only.
- All 4 courier webhooks (Delhivery, Shiprocket, UPS, generic) use HMAC/timing-safe checks, fail
  closed if unconfigured. Both cron routes actually check `CRON_SECRET`, not just reference it.
- No raw SQL/string concatenation; the few `.rpc()` calls are parameterized named functions.
- Marketplace/courier credentials are encrypted (AES-256-GCM, `src/lib/crypto/secret-box.ts`) — no
  plaintext secret columns found.
- Employee password reset is a proper `employee_admin`-gated admin action
  (`supabase.auth.admin.updateUserById`), 8-char minimum (stricter than the project floor).

**Real gaps found, all 4 code-level ones FIXED 2026-08-17 (round 2) — delivered via
`2026-08-17-security-perf-round2.zip`, pending user upload confirmation + `git fetch` re-verify:**
1. ~~**Medium** — `updateInvoiceFields`~~ **FIXED** (`src/app/dashboard/invoices/actions.ts`) — now
   resolves the invoice's `company_id` and checks `employee.companyIds.includes(...)` before writing,
   same pattern as the sibling `deleteInvoice`.
2. ~~**Medium** — SSRF risk in `order-photo-proxy`/`order-whatsapp-image`~~ **FIXED** — new
   `src/lib/security/safe-external-fetch.ts` resolves the hostname via `dns.lookup`, rejects any
   private/loopback/link-local/cloud-metadata/reserved address (IPv4 + IPv6), and fetches with
   `redirect: "manual"` so a redirect to an internal address can't bypass the check. Both routes now
   route through it instead of a raw `fetch()`.
3. ~~**Low** — `removeHoliday` and `setManualAttendance`~~ **FIXED** — `removeHoliday` now checks the
   holiday's `company_id` against `employee.companyIds` before deleting (NULL = national holiday,
   deletable by anyone with the capability, unchanged). `setManualAttendance` now additionally
   verifies the target `employeeId` actually belongs to (or has cross-access to) the `companyId`
   being written, closing a data-integrity hole where an admin scoped to Company A could misattribute
   a Company B employee's attendance to Company A.
4. **Supabase project settings** (dashboard-level, not code, NOT changed — flagged for user decision
   only): public "Allow new users to sign up" is
   ON even though the app has no self-signup UI (accounts are only created by an admin via
   `supabase.auth.admin.createUser`) — direct calls to Supabase's own signup endpoint would still be
   accepted, though a rogue signup gets zero data access since there's no matching `employees` row.
   CAPTCHA protection is OFF. Leaked-password check is OFF (Pro-plan-only, project is Free). Minimum
   password length is 6 with no complexity rule. Only IP-based rate limiting exists (30 attempts/5min
   default), no per-account lockout. These are all one-click toggles in Supabase Auth settings —
   flagged for the user to decide on, not changed unilaterally (account-settings changes need
   explicit permission).

## 7. Performance posture (audited 2026-08-17 — see project doc `perf-audit-2026-08-17.md` for full detail)

**Most likely cause of "system slow" complaints**: `createOrderCore`
(`src/app/dashboard/orders/new/actions.ts`) did per-line-item sequential currency conversion, which
can fall through to an external HTTP call (`api.frankfurter.app`, 5s timeout) when no cached official
rate exists for that date. **FIXED 2026-08-17 (round 2)** — a `conversionCache` Map keyed by
`(currency, originalValue)` now dedupes repeated conversions within one order-save request, so
multiple line items in the same currency (the common case) hit the network/RPC at most once total,
not once per item.

Other findings, all applied 2026-08-17 (round 2) except #2 (SQL, delivered not run):
1. ~~`src/app/dashboard/orders/page.tsx` fires 12 Supabase queries, only 5 batched~~ **FIXED** — the
   other 6 (purchaseBills, dispatchInvoices, refunds, etsyLines, ebayTaxLines, amazonLines), which
   only depend on `orderIds`/`marketplaceOrderNos` and never on each other, now run in one
   `Promise.all` instead of sequentially.
2. `ebay_tax_invoice_lines` has zero indexes (its Amazon/Etsy siblings both got matching ones) —
   **migration written** (`db/2026-08-17-ebay-indexes-and-order-status-rpc.sql`, idempotent, dry-run
   verified) but **not yet run** — deliver-not-execute rule, waiting on the user to run it in Supabase.
3. ~~`src/app/dashboard/crm/page.tsx`'s order-status-count query has no `.limit()`~~ **FIXED** — new
   `get_order_status_counts(p_company_id)` SQL function (same migration file as #2) does the `GROUP BY`
   in the database using the existing `idx_orders_status` index; the page now calls it via
   `supabase.rpc(...)` instead of pulling every order row into Node to count client-side.
4. Confirmed Vercel Hobby plan (60s function cap, 2-cron limit) — a plausible contributing factor
   under load, can't verify further without Vercel function logs. Not actionable without a plan
   upgrade decision — flagged, not fixed.

Checked and confirmed FINE: no N+1 patterns on any read page, `xlsx`/`sharp`/`pdf` libs are all
server-only or dynamically imported (never in the client bundle), `revalidatePath` scoping is
appropriate everywhere except the (defensible) company-switch action, pagination/limits are present
on every other page.

**2026-08-18 — 2 more minor items applied, 1 deliberately skipped:**
- ~~`bill_pass_register` had no index matching bill-payment/page.tsx's exact query shape~~ **FIXED** —
  new partial index `idx_bill_pass_company_due_date ON bill_pass_register(company_id, due_date) WHERE
  balance_due > 0` (`db/2026-08-18-bill-pass-due-date-index.sql`, dry-run verified idempotent).
- ~~`inventory/page.tsx`'s `finished_stock` query had no `.limit()`~~ **FIXED** — added `.limit(1000)`,
  defensive only (row count is naturally bounded by SKU×size cardinality today, not order volume).
- `switchCompanyAction`'s `revalidatePath("/dashboard", "layout")` — **deliberately left alone.**
  Narrowing this looked easy but isn't actually a fix: switching company legitimately needs to
  invalidate nearly every page in the app (orders, documents, stock, invoices, CRM, bill payment —
  all company-scoped), and this exact session already hit multiple real bugs from company-scoping
  going stale (Party Ledger, Bill Payment, CRM, Orders all had to be fixed for this earlier). A
  narrower revalidate risks reintroducing that class of bug for a broad-cache-invalidation cost that's
  cheap in practice. Confirmed with the user's "sabhi" request that this one stays as-is.

**Code-level fixes (1, 3, and the currency cache) are done and typecheck/lint clean — delivered via
`2026-08-17-security-perf-round2.zip`, pending upload confirmation + re-verify. The index/RPC SQL
(#2/#3's DB half) is delivered separately for the user to run themselves, per the standing rule.**

## 8. What shipped 2026-08-17 (this round)

- **Purchase Bill Round Off field** (`purchase_bills.round_off_amt`) — manual signed adjustment so
  the system total can match a vendor invoice's own rounding. **Important gotcha**: the system
  computes GST as one combined rate in a single multiplication, while real vendor invoices often
  round CGST and SGST separately before summing — this can differ by ±1 paisa from what's printed on
  the vendor's bill. Never tell a user to copy the vendor's own round-off figure verbatim; compute
  `vendor's exact total − system's total_amount+GST (before round off)` instead. Full writeup:
  project doc `purchase-bill-round-off-and-gst-desync-2026-08-17.md`.
- **Full bill-edit feature**: Courier Bill, Duty & Tax Bill, and Bill Pass Register entries can now
  all be edited (previously vendor-only or no-edit) — correctly gated on `source IS NULL` for Bill
  Pass Register to avoid desyncing auto-mirrored rows.
- **Attendance work-hours anomaly alert + Daily Work Report categories**: 24h server+client clamp on
  hour entry (root cause of a "10 ghante, 50 ghante" bug report — the Hours input had no `max`
  attribute), 15 new work categories appended (not merged with similarly-named existing ones).
- **Returns/Refunds report** (`/dashboard/returns`) — surfaces `order_refunds` (live) and `refunds`
  (historical, no active writer) side by side, company-scoped.
- **Top Buyers** (added to `/dashboard/crm`) — repeat buyers grouped by contact number (falls back
  to buyer name), current company, orders with count > 1 only.
- **Reorder Alerts** (added to `/dashboard/stock` — NOT `/dashboard/inventory`, see §5's note on why
  finished-goods stock has no consumption data) — current stock ÷ average daily Stock Out over the
  last 90 days, flags anything under 30 days of cover. Deliberately excludes zero-recent-usage SKUs.
- **Security + performance audits** — see §6/§7.
- **WhatsApp automation (OpenWA) — evaluated, NOT integrated.** See §9.

## 9. WhatsApp automation — DECIDED 2026-08-18: do not build

User uploaded `OpenWA` (a NestJS-based, open-source, self-hosted WhatsApp API gateway) and asked what
could be reused. Findings:

- It's a **whole separate backend service** (its own DB, session/queue/plugin modules, Docker
  deployment) — not a library you import into this Next.js app. Integrating it means calling its REST
  API + receiving its webhooks from a newly-deployed instance, not a code merge.
- It connects via **reverse-engineered/unofficial clients** (`whatsapp-web.js` / `baileys`), not
  Meta's official Cloud API. Its own README states plainly: real, non-zero risk of account
  restriction/ban, recommends a dedicated burner number (never the business's primary number), and
  says treat it as **not approved** for any compliance-sensitive use.
- **This app already made the opposite decision twice, deliberately**: both
  `order-whatsapp-button.tsx` (comment: *"Deliberately does NOT use a WhatsApp Business API — user
  chose the simpler route: 'khud ka whatsaap use karna hai... share ka option ho'"*) and
  `src/lib/export/export-table.ts`'s `shareOnWhatsApp` use the Web Share API / `wa.me` link pattern —
  manual, human-in-the-loop send, specifically to avoid any WhatsApp API/automation dependency.

**User decision (2026-08-18): do NOT integrate OpenWA.** Confirmed keeping the existing manual
Share/`wa.me` approach — matches the app's own prior precedent (the two deliberate decisions above)
and avoids the real account-ban risk OpenWA's own README warns about. `OpenWAmain.zip` was reviewed
and nothing from it was merged into the app; no code was written against it. If automated
order-status messages to buyers are wanted later, the lower-risk path stays Meta's official WhatsApp
Cloud API (costs money, zero ban risk) — not revisited unless the user raises it again.

## 10. Where to find more detail

The Claude Project attached to this system has 20+ docs with round-by-round detail this file
intentionally doesn't duplicate — search there before re-deriving something from scratch:
`order-management-schema.md`, `webapp-postgres-schema-notes.md`, `security-rls-and-marketplace-automation-2026-08-10.md`,
`order-lifecycle-inventory-tracking-adspend-requests-2026-08-08.md`, `pending-feature-requests-2026-08-06.md`,
`amazon-order-fee-matching-2026-08-13.md` / `ebay-...` / `etsy-...` (per-marketplace fee-matching
logic), `party-ledger-build-2026-08-17.md`, `historical-master-bill-pass-file-import-2026-08-17.md`,
`app-code-security-audit-2026-08-17.md`, `perf-audit-2026-08-17.md`,
`purchase-bill-round-off-and-gst-desync-2026-08-17.md`, and others — use `project_search` for a
specific question rather than reading every doc.

## 11. Round 2026-10-21 — schema status, leave digest, purchase-bill attribution, FedEx test-all

**Schema / Migration Status card** (`src/lib/db/schema-status.ts` +
`src/components/schema-health-card.tsx`, rendered on `/dashboard` for
`permissions_admin`). This app has no migration ledger — every `db/*.sql` file is
run by hand in the Supabase SQL editor — and optional columns are read with
tolerant fallbacks everywhere, so an un-run file degrades a feature *silently*
(stale figure, missing stamp, empty picker). The card closes that gap by asking
PostgREST for the one column/table each tracked migration creates ("does it
exist"), never reading data, and listing what each pending file degrades. Design
choices worth keeping: (a) probes instead of a bookkeeping table — a ledger table
would itself need a migration; (b) two distinct states, `missing` (action needed)
vs `unverified` (network/permission — shown muted, so a Supabase hiccup never
fakes a pending migration); (c) a deliberately SMALL list (~10 newest
high-impact rounds, one entry each in `SCHEMA_CHECKS`) because each probe is a
round-trip; (d) the Document Entry purchase-bill query now selects `*` rather
than naming audit columns, so one un-run migration degrades a line of text
instead of blanking the whole register — the card is what explains why.

**Leave daily digest** (`src/app/api/cron/leave-digest/route.ts` +
`src/lib/leave/digest.ts`). Sends "Aaj N log leave par — names" every morning from
the same `leave_requests` rows the "On Leave" board reads (Approved + today in
range, IST). Recipients: `LEAVE_DIGEST_CHAT_ID` when set (comma-separated,
management group), else a DM to every active employee whose role holds
`leave_admin` and who has `telegram_chat_id`. Never broadcast to all staff. The
message text is a pure module so `?dry=1` can show it verbatim without sending.
**Deliberately NOT added to `vercel.json`**: this project already spends Hobby's
hard 2-cron cap (see poll-fedex-tracking's header — a third entry silently blocks
deployments), so it is scheduled by an external scheduler hitting the route with
`Authorization: Bearer $CRON_SECRET`. `?skipEmpty=1` suppresses the zero-leave
message.

**Purchase bill "kisne entry ki" + edit history** (`db/2026-10-21-purchase-bill-entered-by.sql`,
`src/lib/purchase-bill-audit.ts`). `entered_by_employee_id` + denormalised
`entered_by_name` on the row (survives rename/deactivation, like
`audit_log.employee_name`); legacy rows stay NULL and render as "not tracked" —
attributing an old bill by guesswork would be a lie. The chain (entry + every
edit + delete) lives in `audit_log`; `updatePurchaseBill` snapshots the row
before writing and logs only the fields that moved (`{field: {label, from, to}}`),
rendered by an admin-only "🕘 History" dialog. History starts empty for bills
entered before this round — there is simply no record.

**FedEx setup matrix test-all** (`testFedexAllCompaniesAction` +
`courier-booking/setup-matrix.tsx`). The saved-vs-env chip only says
"configured"; the 2026-09-17 production bug was a saved-looking key + account
pair that FedEx rejected on the first real booking. One button now runs the same
real Rate-API test per company (intersected with `employee.companyIds`, never a
posted id list), shows ✓ Ready / ✗ Not ready per company in the grid, a ready
count, and each company's exact FedEx message. Three calls on an explicit click
only — never on page load.
