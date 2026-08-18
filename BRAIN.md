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

- **Local working clone**: `/home/claude/oms/webapp` (this repo, in the cloud sandbox)
- **Live production**: `https://nykomart-oms-oohq.vercel.app/` — Vercel, **Hobby plan** (confirmed
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

1. **NEVER run `git push`.** Every code change ships as: `SendUserFile` a zip → user uploads via the
   GitHub web UI → verify with `git fetch origin main` + diff comparison against `origin/main`. Never
   trust "done"/"pushed" claims without that verification.
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
- **Service-role vs. browser client**: `createServiceRoleClient()` (bypasses RLS, server-only) is
  used for essentially all real data access from Server Actions and Server Components, after the
  capability/company checks above. The `createClient()` browser-facing client uses the
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which is (by design, verified 2026-08-17) granted **zero** RLS
  policies on **any** table — so even though that key is public in the shipped JS bundle, it cannot
  read or write anything directly. All 74 public-schema tables have RLS enabled.
- **`Promise.all` for independent queries, sequential `await` only for genuinely dependent ones.**
  Several pages got this wrong (see §6) — new pages should batch from the start.
- **Excel/CSV import gotchas** (recur constantly across every bulk-import feature — Amazon/eBay/Etsy
  fee matching, bank statement import, payment reconciliation):
  - openpyxl reads numeric-looking cells (AWB/invoice numbers) as Python floats — `str()` on them
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
| `/dashboard/bill-payment` | Bill Pass Register (the unified payable ledger — vendor/courier bills + salary/advance payouts) | `bill_payment` |
| `/dashboard/crm` | Company-wide overview: order-status counts, today's attendance, data-quality alerts, P&L Dashboard, Quick Find, **Top Buyers** (added 2026-08-17, see §8) | `crm_dashboard` |
| `/dashboard/reports` | Orders report with filters, CSV/Excel/Word/PDF/Email/WhatsApp export. Links to **Returns/Refunds** (added 2026-08-17, see §8) | `reports` |
| `/dashboard/returns` | New — Returns/Refunds report (see §8) | `reports` (reused) |
| `/dashboard/attendance` | Punch in/out, Daily Work Report, work-hours anomaly alert | `attendance_punch` |
| `/dashboard/parties` | Party (vendor) master | `party_admin` |
| `/dashboard/salary` | Salary + advance tracking | `salary_admin` |
| `/dashboard/statements` | Manual entry for PDF-only statements (Etsy Monthly Tax Invoice, eBay Financial Summary) | `statement_entry` |
| `/dashboard/shipglobal` | Real external shipment creation (costs money, real customs declaration) | `shipglobal_shipment` |
| `/dashboard/invoices` | Export sales invoice generation (CSB-V/CSB-IV) | `invoicing` |
| `/dashboard/admin/*` | Employee roster, Roles & Permissions, Companies/Items, Help Center admin | various `*_admin` |

Full table list: 74 tables in `public` schema, see `db/schema.sql` (3,158 lines, organized into
numbered sections — Section 17 is the reporting-views section, a good landing point).

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

**Real gaps to fix**, prioritized:
1. **Medium** — `updateInvoiceFields` (`src/app/dashboard/invoices/actions.ts:691-738`) is missing
   the company-scope check every sibling action has. An employee with `invoicing` capability but
   access to fewer than all 3 companies could call the Server Action directly (bypassing the UI,
   which itself filters correctly) with another company's invoice id and rewrite it.
2. **Medium** — SSRF risk in `src/app/api/order-photo-proxy/route.ts` and
   `src/app/api/order-whatsapp-image/route.ts`: both require login + `order_entry` but then `fetch()`
   an arbitrary client-supplied URL server-side with only a scheme check, no host allowlist.
3. **Low** — `removeHoliday` and `setManualAttendance` have narrower/missing checks than their
   siblings (calendar sabotage risk, not data exposure).
4. **Supabase project settings** (dashboard-level, not code): public "Allow new users to sign up" is
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
(`src/app/dashboard/orders/new/actions.ts:304-346`) does per-line-item sequential currency
conversion, which can fall through to an external HTTP call (`api.frankfurter.app`, 5s timeout) when
no cached official rate exists for that date. A 5-item order on such a day can add up to ~25s of
serial latency to a single "Save Order" click — this is the single most-used action in the app.

Other real findings, prioritized:
1. `src/app/dashboard/orders/page.tsx` fires 12 Supabase queries, only 5 batched via `Promise.all` —
   the other 7 run sequentially even though most are independent. Cheap parallelization win on the
   second-most-visited page.
2. `ebay_tax_invoice_lines` has zero indexes (its Amazon/Etsy siblings both got matching ones) —
   queried on every Orders page load, will slow-burn as eBay data accumulates.
3. `src/app/dashboard/crm/page.tsx`'s order-status-count query has no `.limit()` — fetches every
   order row for the company just to count in JS, unbounded growth.
4. Confirmed Vercel Hobby plan (60s function cap, 2-cron limit) — a plausible contributing factor
   under load, can't verify further without Vercel function logs.

Checked and confirmed FINE: no N+1 patterns on any read page, `xlsx`/`sharp`/`pdf` libs are all
server-only or dynamically imported (never in the client bundle), `revalidatePath` scoping is
appropriate everywhere except the (defensible) company-switch action, pagination/limits are present
on every other page.

**None of these performance fixes have been applied yet** — audited and documented, not yet
implemented, pending user confirmation on priority.

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

## 9. Pending decision: WhatsApp automation

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

**Recommendation, not yet acted on**: don't deploy OpenWA against the real business number without
the owner explicitly weighing the ban risk against the prior "keep it manual" decision. If automated
order-status messages to buyers are genuinely wanted, the lower-risk path is Meta's official WhatsApp
Cloud API (costs money, zero ban risk) rather than an unofficial gateway. Flagged for the user; no
code written against it yet.

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
