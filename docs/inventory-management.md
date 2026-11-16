# Inventory Management Module

Finished-goods inventory for NYKO MART OMS: staged stock, PCS **and** SQ FT,
order reservations, printing/washing/manufacturing, an immutable ledger, and
customer challans where **issuing** is the only thing that deducts stock.

Existing modules are untouched: raw material stays in `stock_in` / `stock_out`
(`/dashboard/stock`), vendor material-out chalans stay where they were, and the
old finished-goods counter still works at
`/dashboard/inventory/finished-goods`.

## Apply the migration

Run **`db/2026-11-14c-inventory-management-module.sql`** once in the Supabase
SQL editor (it is also folded into `db/schema.sql` as Section 32). It is
re-runnable: tables are `IF NOT EXISTS`, functions `OR REPLACE`, policies are
recreated, and capability grants use `ON CONFLICT DO NOTHING`.

Afterwards, in **Inventory → Settings**, add at least one warehouse, a product,
and its variant SKUs (with length × width for rug-like products). Nothing can be
stocked until a variant exists.

## Stock stages

`RAW → PRINTING → WASHING → QC → READY → (challan issue) → deducted`

`MANUFACTURING` exists as a stage, and `REJECTED` holds QC failures. A quantity
is only ever in one stage: stage changes are one transaction that debits the old
stage and credits the new one.

- Manual inward may only land in **RAW, QC or READY**.
- Processing completion moves accepted pieces through QC into READY; rejected
  pieces go to REJECTED.
- Manufacturing output is created at QC and only accepted pieces reach READY —
  raw material is never re-counted as finished goods.

## PCS and SQ FT

`SQ FT = PCS × length_ft × width_ft`, computed per variant (a 4×6 rug is
24 SQ FT per piece) and stored at 3 decimals. Manual SQ FT is allowed for
irregular pieces; it is recorded on the movement, and any correction must carry
a reason and remarks. Products without dimensions use PCS only (SQ FT stays 0).

## Reservations

`Available = READY − open reservations`. `inventory_reserve()` locks the balance
row, sums active reservations and refuses a quantity it cannot cover, so two
people cannot promise the same pieces. Cancelling an order is done by releasing
its reservation; the stock never leaves the warehouse until a challan is issued.

## Challans

1. Create a **DRAFT** challan with one or more SKU lines (optionally linked to an
   order by PO/RF/RG reference).
2. **Issue** it. In one transaction the database verifies every line against
   READY, deducts the PCS/SQ FT, writes ledger entries, fulfils the linked
   order's reservations and marks the challan ISSUED.
3. Issuing an already-issued challan returns `already_issued` and deducts
   nothing — double-clicks and API retries are safe.
4. **Mark dispatched** once the goods physically leave. After that the challan
   cannot be cancelled.
5. Cancelling an ISSUED (not dispatched) challan reverses the exact movements
   and restores reservation fulfilment. Ledger rows are never deleted.

Partial dispatch works naturally: a 10 PCS order can go out as 6 PCS, then the
remaining 4 on a second challan.

## Screen map

| Path | Purpose |
| --- | --- |
| `/dashboard/inventory` | Live KPIs, alerts, low/out-of-stock, recent movements |
| `/dashboard/inventory/stock` | Balances by stage, stock inward, QC decision, audited correction |
| `/dashboard/inventory/reservations` | Reserve for an order / release |
| `/dashboard/inventory/processing` | Printing & washing jobs, manufacturing jobs |
| `/dashboard/inventory/challans` | Create, issue, dispatch, cancel |
| `/dashboard/inventory/ledger` | Append-only history with before/after balances |
| `/dashboard/inventory/reports` | Category/warehouse/SKU reports + CSV exports |
| `/dashboard/inventory/settings` | Category workflows, products, variants, warehouses |

## API

All routes require a signed-in employee with the matching capability; the
service-role key never reaches the browser.

| Method | Route | Capability |
| --- | --- | --- |
| GET | `/api/inventory/dashboard` | `inventory_view` |
| GET | `/api/inventory/stock` | `inventory_view` |
| GET | `/api/inventory/stock/[sku]` | `inventory_view` |
| GET | `/api/inventory/ledger` | `inventory_view` |
| GET | `/api/inventory/reports/low-stock` | `inventory_view` |
| GET | `/api/inventory/reports/stock-movement` | `inventory_view` |
| GET | `/api/inventory/reports/export?type=…` | `inventory_view` |
| POST | `/api/inventory/inward` | `inventory_manage` |
| POST | `/api/inventory/adjustment` | `inventory_manage` |
| POST | `/api/inventory/reserve` | `inventory_manage` |
| POST | `/api/inventory/release` | `inventory_manage` |
| POST | `/api/inventory/processing/send` | `inventory_manage` |
| POST | `/api/inventory/processing/complete` | `inventory_manage` |
| POST | `/api/inventory/manufacturing/complete` | `inventory_manage` |
| POST | `/api/inventory/challan/issue` | `inventory_dispatch` |
| POST | `/api/inventory/challan/cancel` | `inventory_dispatch` |

`POST /api/inventory/inward` accepts an optional `idempotencyKey`; repeating the
same key applies the movement once.

## Database objects

`inventory_category_settings`, `inventory_products`,
`inventory_product_variants`, `inventory_warehouses`, `inventory_balances`,
`inventory_ledger`, `inventory_reservations`, `inventory_processing_jobs`,
`inventory_processing_movements`, `inventory_manufacturing_jobs`,
`inventory_challans`, `inventory_challan_lines`, `inventory_adjustments`,
`inventory_audit_logs`, `inventory_idempotency`.

Functions: `inventory_apply_movement`, `inventory_transfer_stage`,
`inventory_reserve`, `inventory_release_reservation`, `inventory_issue_challan`,
`inventory_cancel_challan`, `inventory_mark_dispatched`,
`inventory_start_processing`, `inventory_complete_processing`,
`inventory_start_manufacturing`, `inventory_complete_manufacturing`,
`inventory_move_qc`, `inventory_reconcile`.

`inventory_reconcile()` lists any balance that disagrees with the sum of its
ledger entries. The dashboard surfaces the count as an alert.

## Guarantees enforced in the database

- Negative stock is rejected (`INSUFFICIENT_STOCK`).
- Ledger rows cannot be updated or deleted.
- One active reservation per order + SKU + warehouse.
- Challan issue is idempotent on status and all-or-nothing.
- Cancellation after dispatch is refused.
- Both PCS and SQ FT are checked on every movement.

## Known gaps / next steps

- **Purchase orders are not modelled.** The app records purchase bills and
  received chalans, not POs, so "purchase pending" (ordered − received) cannot
  be computed honestly yet; the dashboard says so instead of showing a number.
  Wiring a PO table (or purchase-bill lines) into inward is the next step.
- **Order entry does not yet show an in-stock badge.** Reservations can be made
  from Inventory by PO/RF/RG reference; the order form itself is unchanged.
- Date-range filtering on the dashboard currently scopes the dispatched KPI and
  the recent-movement feed; stage totals are always as-of now.
- No email/WhatsApp alert delivery yet — alerts are computed and shown in-app.
