# Schema Notes — Order Management System (PostgreSQL / Supabase)

Companion to `webapp/db/schema.sql`. That file has been applied end-to-end
against a real PostgreSQL 16 instance with zero errors, and its triggers,
generated columns and views have been functionally exercised (document
numbering, FY-reset logic, stock aggregation, reconciliation views, the
eBay financial-summary roll-up view, citext case-insensitive party dedup).
This document explains *why* things were modeled the way they were, and
lists the open questions a human should resolve before this is finalized.

Source material read in full: `build.py` (2,420 lines — all 32 `_COLUMNS =
[...]` sheet definitions) and `gscript/Code.gs` (2,783 lines — every
function, not just the ones named in the task).

---

## 1. Sheet → table/view mapping

| Old sheet | New table/view | Kind |
|---|---|---|
| README | — | n/a (this doc + schema.sql header) |
| Lists | enum types + `item_categories`, `sizes`, `currencies`, `stores` | enum + tables |
| All_Orders_Master + Nyko Mart + Rugara + CASA ARRA | `orders` | ONE table, `company_id` FK |
| Counters | `sequence_counters` + `reserve_next_number()` | table + function |
| Company_Stores + Company_Registry | `companies` + `stores` | tables |
| Employees | `employees` (+ `roles`, `capabilities`, `role_capabilities`) | tables |
| Activity Report | `employee_order_activity_view` | view |
| SKU_Master | `skus` | table |
| Party Master | `parties` | table |
| Exchange Rate Master | `exchange_rates` (+ `get_official_rate_as_of()`) | table + function |
| Company_Profiles | `company_profiles` | table |
| Dispatch & Invoice | `dispatch_invoices` | table |
| Freight Bill | `freight_bills` | table (2 generated cols) |
| Duty & Tax Bill | `duty_tax_bills` | table (1 generated col) |
| Shipping Bills | `shipping_bills` | table |
| Purchase Bill | `purchase_bills` | table (3 generated cols) |
| Freight Reconciliation | `freight_bill_awb_assignments` (manual data) + `freight_reconciliation_view` + `freight_bill_variance_view` | table + 2 views |
| Duty Reconciliation | `duty_bill_awb_assignments` (manual data) + `duty_reconciliation_view` | table + view |
| Portal Payment Reconciliation | `portal_payment_reconciliation` | table (2 generated cols) |
| Bank Statement | `bank_statement_lines` | table |
| Etsy Ledger | `etsy_ledger_lines` | table |
| eBay Transaction Report | `ebay_transaction_lines` | table |
| eBay Freight Invoice | `ebay_freight_invoice_lines` | table (2 generated cols) |
| eBay Shipment & Customs Report | `ebay_shipment_customs_lines` | table |
| eBay Prepaid Wallet Ledger | `ebay_wallet_ledger_lines` | table |
| eBay Tax Invoice Detail | `ebay_tax_invoice_lines` | table |
| Etsy Monthly Tax Invoice | `etsy_monthly_tax_invoices` | table (3 generated cols) |
| eBay Financial Summary Report | `ebay_financial_summary` + `ebay_financial_summary_computed_view` | table + view |
| Net Revenue | `net_revenue_view` | view |
| Dispatch & Refund + FBA Refund + No Dispatch & Refund | `refunds` (`source` enum discriminates) | ONE table |
| Washing Data | `washing_entries` | table (trigger doc-no + generated col) |
| Debit Note | `debit_notes` | table (trigger doc-no + 3 generated cols) |
| Credit Note | `credit_notes` | table (trigger doc-no) |
| Internal Invoice | `internal_invoices` | table (trigger doc-no + 3 generated cols) |
| Stock Master | `stock_items` (catalog) + `stock_current_view` (CURRENT STOCK) | table + view |
| Stock In | `stock_in` | table (3 generated cols) |
| Stock Out | `stock_out` | table |
| Bill Pass Register | `bill_pass_register` | table (3 generated cols) |
| Sale & Profit Ledger | `sale_profit_ledger` | table (4 generated cols) |
| P&L Dashboard | `pl_dashboard_by_company_view` + `pl_dashboard_by_month_view` | 2 views |
| Attendance | `attendance` | table (1 generated col: work_hours) |
| Letter Log | `hr_letters` | table (trigger ref-no) |
| CRM Dashboard alerts (`getAlerts_()`) | `data_quality_alerts_view` | view |

**Not carried forward as a table at all:** the "SN NO." auto-`=ROW()-1`
column present on nearly every old sheet — it was a per-tab presentational
row counter, not real data; `id` (UUID) + `created_at`/insertion order
replaces it everywhere.

---

## 2. Which formulas became what, and why

- **Same-row arithmetic → `GENERATED ALWAYS AS (...) STORED` column.**
  Freight Bill's `TOTAL AMT`/`GST 18% AMT`/`GROSS TOTAL AMT`, Duty & Tax
  Bill's `GROSS TOTAL AMT`, Purchase Bill's `TOTAL SQ FEET`/`TOTAL AMOUNT`/
  `G. TOTAL + GST`, Debit Note's `PO Amount`/`CGST`/`SGST`/`Total`, Washing
  Data's `AMOUNT`, Internal Invoice's `Amount`/`GST 18%`/`Total Amount`,
  Stock In's `TOTAL AMT.`/`5% GST`/`TO BE PAID`, Bill Pass Register's `TO BE
  PAY`/`BALANCE DUE`/`DUE DATE`, Sale & Profit Ledger's `NET TOTAL VALUE`/
  `PORTAL EXPENSES`/`NET EARN`/`PROFIT %`, Etsy Monthly Tax Invoice's
  `Subtotal`/`GST Amount`/`Total`, eBay Freight Invoice's `Total Other
  Charges`/`Total Shipping Fees`, Portal Payment Reconciliation's `Total
  Exp.`/`Remaining Amount`, Attendance's `WORK HOURS`, and the refund
  sheets' `REFUND AMT. %`.

  **Important PostgreSQL constraint that shaped several of these:**
  generated columns **cannot reference another generated column** (this was
  confirmed against a live PostgreSQL 16 instance, not just recalled from
  memory). Any old formula that chained through an intermediate computed
  cell (e.g. Sale & Profit Ledger's `NET EARN` = `NET TOTAL VALUE` −
  `PORTAL EXPENSES`, both themselves formulas) had to have the full
  expression **inlined** at each step instead of referencing the sibling
  generated column. This is called out at each such column with a comment.

- **Cross-table lookups/aggregates → `VIEW`.** Freight/Duty Reconciliation
  (AWB-matched `INDEX`/`MATCH` into Dispatch & Invoice), Freight Bill's
  `DIFRANCE AMOUNT` (`SUMIF` against Freight Reconciliation), Net Revenue
  (`SUM` across 4 different sheets, all-time/all-company), P&L Dashboard
  (`SUMIF`/`SUMPRODUCT` over Sale & Profit Ledger by company/month), Stock
  Master's `CURRENT STOCK` (`SUMIFS` over Stock In/Out), and eBay Financial
  Summary's chain of roll-up columns (`Refunds Net` → `Fees Subtotal Net` →
  `Expenses Total Net` → `Net Cash Movement`, 3-4 levels deep — rather than
  fight the no-generated-referencing-generated rule with a deeply inlined
  expression, this one specific case became a view instead, matching the
  original sheet's own description of the last column as "this system's own
  derived roll-up … a sanity-check figure only", i.e. reporting, not a
  fact to store).

- **A genuinely non-obvious case: Freight/Duty Reconciliation were only
  *partially* views.** Re-reading the sheets closely: most of their columns
  really were pure lookups off Dispatch & Invoice (safe to make a view),
  but **which courier invoice a given AWB's charges were actually billed
  under** is real, human-entered data — the courier's bill itself doesn't
  state which AWBs it covers, a person matches that up when the bill
  arrives. Same for the audited "Bill Weight" off the physical bill, and
  the "Difference AMT" column (which the *original* author explicitly
  tried and failed to reverse-engineer a formula for from the worked
  example given — flagged as "leave manual rather than compute a
  confidently-wrong number", a judgment this schema keeps). So each
  reconciliation sheet became a small **assignment table** (the real,
  manually-entered AWB↔invoice mapping + the 2-3 genuinely-manual fields)
  plus a **view** that reproduces every column that really was a pure
  lookup. This is a more faithful reading of "formula-driven → view" than
  mechanically converting the whole sheet, and is worth a second look from
  someone who knows the real reconciliation workflow.

- **Conditional/stateful business logic → application code, documented as
  comments only** (per the task's explicit instruction not to force these
  into SQL): buyer-batch `-position/total` suffix tagging, duplicate-
  dispatched-order ref-no reuse, and the *timing* of when a PO/RF/RG number
  gets reserved (only at actual save, never at form-preview time — the old
  system had a real bug here, fixed 2026-08-03, that left permanent gaps in
  the sequence; the new schema's separation of "number reservation" from
  "row insert" is designed specifically so the app can replicate that fix
  correctly). See the "BUSINESS RULES ENFORCED IN APPLICATION CODE" block
  at the top of `schema.sql`.

---

## 3. Document numbering — what actually ended up in SQL

The task asked to show a clean sequence-per-company-per-financial-year
approach *if PostgreSQL can genuinely do it*. It can, cleanly, via:

```sql
sequence_counters(company_id, scope, fy_label, last_number)  -- fy_label = '' sentinel for "no FY reset"
reserve_next_number(company_id, scope, use_fy, as_of_date)   -- atomic INSERT ... ON CONFLICT DO UPDATE ... RETURNING
```

This was tested for a race-safety property that matters here: two
concurrent callers reserving a number for the same `(company_id, scope,
fy_label)` cannot receive the same number — Postgres's `ON CONFLICT DO
UPDATE` takes a row-level lock internally, equivalent to the old system's
explicit `LockService.getScriptLock()`.

Three different *usage patterns* came out of this one mechanism, matching
three different behaviors in the old Apps Script:

1. **Debit Note / Credit Note / Washing Data / Internal Invoice / HR
   Letters** — a plain `BEFORE INSERT` trigger calls `reserve_next_number()`
   and sets the number, because there's no conditional logic around
   *whether* to reserve one. (Tested live: inserting a Debit Note dated
   2026-07-15 got `NM/DN/26-27/0001`; a second one dated 2026-08-01 got
   `NM/DN/26-27/0002`; a third dated 2026-02-01, before the FY boundary,
   correctly reset to `NM/DN/25-26/0001`.)
2. **Orders (`ref_no`)** — deliberately **not** trigger-based. Whether to
   reserve a fresh number, reuse an existing dispatched order's number, or
   accept a manually-typed number is a 3-way conditional that must be
   decided by application code *before* the row is written (see business
   rules note). The app calls `reserve_next_number()` directly, the same
   function, just not from a trigger.
3. **HR Letters (`ref_no`)** — trigger-based like #1, but with `use_fy =
   false` (letter numbering never resets on the financial year in the
   source — `getNextLetterRefNo_()` uses a flat composite counter key).

---

## 4. Design decisions worth flagging explicitly

- **UUID primary keys everywhere**, except `currencies` (PK = ISO code) —
  see the top-of-file comment in `schema.sql` for the full reasoning
  (Supabase/PostgREST exposure, pairs naturally with Supabase Auth UUIDs).
- **`orders` is one table, not four.** This was the single biggest
  intentional deviation from a literal sheet-by-sheet port, per the task's
  explicit ask. `company_id` replaces "which of the 4 old tabs was this
  row on".
- **`refunds` is one table, not three** (Dispatch & Refund / FBA Refund /
  No Dispatch & Refund were 90%-identical column sets) — a `source` enum
  discriminates, `item_id` is nullable (blank for FBA Refund rows, which
  never had that column), `reason` is nullable (only populated for
  No Dispatch & Refund rows).
- **Roles/Capabilities fully normalized** into `roles` + `capabilities` +
  `role_capabilities`, replacing the hardcoded `ROLE_CAPABILITIES` object
  in `Code.gs` — seeded in `schema.sql` with the exact 9 roles × 18
  capabilities from the source, so `capabilitiesForRole_()` becomes a plain
  join query.
- **Dispatch & Invoice stayed ONE table, not header+lines**, despite
  `INVOICE NO.` repeating across a buyer's batch (which might suggest an
  invoice-header/line-item split). Decided against splitting because
  shipment-level fields (AWB, courier, weight, dimensions) also live at
  that same row level in the source and vary per row within a batch — there
  is no evidence in the source that they're ever truly shared per invoice
  rather than per shipment. Splitting on an unverified assumption felt
  worse than keeping the table at its true observed grain (one row per
  order). **Worth revisiting with someone who actually processes these
  invoices** — if shipment-level fields genuinely are always identical
  across one buyer's batch in practice, a header/line split would reduce
  duplication.

---

## 5. Open questions for a human to resolve

These are genuinely unclear from the source (Python generator + Apps
Script) — not just style choices — and should be settled before this
schema is treated as final.

1. **Employee passwords were plaintext in the old system**, explicitly
   flagged in the source's own comments as "not enterprise-grade… good
   enough for a small internal team." The new schema has a
   `password_hash` column and an `auth_user_id` column for eventual
   Supabase Auth integration, but **the actual auth strategy (Supabase
   Auth vs. custom bcrypt table, session handling, RLS policies) is not
   decided** — this schema only provides the storage shape. Needs an
   explicit decision before go-live; do not migrate the old plaintext
   passwords as-is.

2. **Dispatch & Invoice grain** (see section 4 above) — confirm with
   whoever enters these whether AWB/courier/weight really can vary within
   one buyer's invoice batch (current model assumes yes) or are always
   identical (would justify a header/line split).

3. **`orders.buyer_name_address` was kept as one free-text field**,
   matching the source exactly (`lookupOrderForEntry()` in `Code.gs` even
   derives a "buyer name" from it by splitting on the first newline — i.e.
   the *old system itself* didn't have a clean structured name/address).
   Splitting this into `buyer_name` + `buyer_address` (or a proper `buyers`
   table, dedup'd by contact_no) would be a genuine improvement but risks
   silently mis-splitting real historical data with inconsistent
   formatting. Recommend doing this as a deliberate, reviewed migration
   step later, not blindly at schema-creation time.

4. **`sizes` list quality.** The source `SIZES_LIST` (~280 values) has
   inconsistent case (`'5X5 ft'` vs `'6X6 FT'`), stray punctuation, and a
   catch-all `'CUSTOME SIZE'` (sic) — the source's own comment describes it
   as "deduplicated… from a much longer pasted list with many repeats."
   `orders` keeps both a nullable `size_id` FK (clean, for new entries) and
   a `size_label` text column (raw, always populated). Migrating the
   historical rows to attach `size_id` will need a fuzzy-matching/cleanup
   pass, not a straight import.

5. ~~`orders.website_dispatch`~~ **RESOLVED (2026-08-04).** User confirmed:
   it records which kind of photo is attached to the order — the single
   photo taken at dispatch time, vs. the product's website/portal listing
   photo. Renamed to `orders.photo_type`, now a proper `order_photo_type`
   enum (`'Dispatch'`, `'Website'`) instead of free text.

6. **`purchase_bills.work_notes`** ("WORK1" in the source) — the *original*
   author's own comment says this "wasn't explained in the spec" and left
   it as free text. Same here — still unresolved, flagging it forward.

7. **`credit_notes.order_id`** — the source's "ORDER ID" column on Credit
   Note isn't clearly documented as either the marketplace order number or
   the internal PO/RF/RG number; `saveCreditNote()` in `Code.gs` writes
   `p.orderNo || p.refNo` (i.e. it's actually EITHER, whichever was
   available at entry time). Modeled here as `order_id` FK assuming it
   resolves to the internal order — confirm this is right, or consider
   keeping a plain text fallback column too (like `orders.sku_label` does
   for its own ambiguous case).

8. **Stock module SKU code space.** Stock In/Out/Master's "SKU" values (raw
   materials, sourced from JK/HT/APL/AK Enterprises/Shivam) are very likely
   a *different* code space from `SKU_Master`'s finished-product SKUs (the
   Stock module's own comment describes it as "raw-material inventory").
   Modeled as free-text `sku_code` on `stock_items`/`stock_in`/`stock_out`
   rather than an FK into `skus`, to avoid conflating the two. If raw
   materials should also have their own clean master list (mirroring
   `skus`), that's a reasonable follow-on table (`raw_material_skus`) not
   built here since the source gives no such master list to migrate from.

9. **`bill_pass_register` isn't FK'd to `freight_bills`/`duty_tax_bills`/
   `purchase_bills`.** The source describes it as a "unified vendor
   bill-pass ledger" built from the real "…-ALL BILLS" master files, but
   never establishes a row-level link back to the specific Freight Bill /
   Duty & Tax Bill / Purchase Bill entry each payable line corresponds to.
   Forcing that FK now would mean guessing a mapping the source data
   doesn't provide. Left as its own standalone ledger. If the business can
   supply the real mapping rule, this is a good candidate for a proper FK
   later.

10. **`company_id` added to the statement-family import tables** (Bank
    Statement, Etsy Ledger, eBay Transaction Report, eBay Freight Invoice,
    eBay Shipment & Customs Report, eBay Prepaid Wallet Ledger, eBay Tax
    Invoice Detail) that the *old* sheets didn't have, because at the time
    they were built only one PNB bank account and one eBay/Etsy seller
    account existed. **Confirm whether Rugara/CASA ARRA will ever have
    their own separate bank/Etsy/eBay accounts** — if genuinely never, this
    column is harmless but unnecessary; if yes, it's required and this
    schema is already ready for it.

11. **`skus` and `sizes` are both "hybrid" (nullable FK + raw text
    fallback) on `orders`**, but `item_categories` is a **strict NOT NULL
    FK** with no text fallback. This asymmetry is intentional (item
    categories had a small, disciplined fixed-plus-admin-added list;
    SKU/Size lists were sparser/messier in the source — see design decision
    #7 in `schema.sql`), but is worth a second opinion once real historical
    data is in hand — if SKU data turns out to be clean enough, dropping
    its text fallback and making it NOT NULL like item_category would be a
    reasonable tightening.

---

## 6. What was deliberately NOT seeded in `schema.sql`

`schema.sql`'s seed data section only inserts **structural / business-rule**
data that's compact and directly encodes rules from the source: the 3
companies + their profiles + stores, 10 currencies, 9 roles, 18
capabilities, and the full role→capability mapping.

**Not seeded** (belongs in a separate, one-time migration script, not in
the schema file itself): the ~280 `Sizes` dropdown values, the ~90 real
vendor names from `Party Master` (including the JK/HT/APL/AK
Enterprises/Shivam stock-source rows), the `SKU_Master` catalog (only 3
example rows existed in the source anyway), historical `Exchange Rate
Master` rows, and any historical order/dispatch/bill/ledger data. All of
that is real business data to be migrated from the live spreadsheet, not
schema/DDL.

---

## 7. Validation performed

`schema.sql` was applied to a real, disposable PostgreSQL 16 database
(`CREATE EXTENSION pgcrypto/citext`, all 45 tables, ~11 views, all ~15
trigger functions) with **zero errors**. Functional checks run against
that database, not just "it compiled":

- Order ref-no reservation via `reserve_next_number()` + `format_order_ref_no()` produced `PO-0001`, then `PO-0002` on a second call.
- Debit Note's `BEFORE INSERT` trigger correctly produced `NM/DN/26-27/0001` → `NM/DN/26-27/0002` for two July/August-2026 rows, then correctly reset to `NM/DN/25-26/0001` for a February-2026 row (financial-year boundary logic verified, not just assumed).
- Freight Bill's 3 chained generated columns (`total_amt` → `gst_18pct_amt` → `gross_total_amt`, each with the prior expression re-inlined) computed correctly in one `INSERT ... RETURNING`.
- `attendance.work_hours` (generated from `punch_in`/`punch_out` timestamps) computed `8.75` for a 09:30–18:15 shift.
- `stock_current_view` correctly aggregated `100 in − 30 out = 70` current stock across separately-inserted `stock_in`/`stock_out` rows.
- `hr_letters`' trigger produced `PO/JL/0001` for a Joining Letter (no FY component, as intended).
- `ebay_financial_summary_computed_view`'s 4-level roll-up chain (Refunds Net → Fees Txn Net → Fees Subtotal Net → Net Cash Movement) computed correctly against hand-checked numbers.
- `data_quality_alerts_view`, `pl_dashboard_by_company_view`, and `net_revenue_view` all execute without error against a populated database.
- `parties`' `citext` unique constraint correctly rejected `'test vendor'` as a duplicate of an existing `'Test Vendor'` row (case-insensitive dedup, matching `addParty()`'s own rule in `Code.gs`).
