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

Then run **`db/2026-11-16-phase4-order-stock.sql`** (Section 33 of
`db/schema.sql`) — it adds the order-confirmation reservation and the purchase
requirements table. Also additive and re-runnable.

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

## Order confirmation (Phase 4)

Order entry stores SKU and size as free text, so the link to inventory is the SKU
text itself (`inventory_product_variants.sku`, unique) inside the same company
and item category.

- **Order entry badge** — typing a SKU/size/quantity shows `READY − reserved`
  for that variant and how many pieces are short. Informational only; it never
  blocks saving. A SKU inventory does not know falls back to the legacy
  `finished_stock` count.
- **Confirming an order** (status → `Confirmed`) reserves the available quantity
  from the fullest active warehouse and writes the remainder into
  `inventory_purchase_requirements`, in one transaction. Confirmation never
  fails because stock is short — the shortfall is the requirement.
- **Hold / Cancelled / Returned** releases that order's live reservations and
  cancels its open requirements, so the stock is free immediately.
- Changing the quantity of an already-confirmed order does not re-reserve; use
  the Reservations screen (reserve/release) for that adjustment.

Requirements for the same order + SKU are topped up rather than duplicated, and
the dashboard lists every open one with a **Close** button (once the goods were
bought or the need ended).

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
`inventory_audit_logs`, `inventory_idempotency`,
`inventory_purchase_requirements`.

Functions: `inventory_apply_movement`, `inventory_transfer_stage`,
`inventory_reserve`, `inventory_release_reservation`, `inventory_issue_challan`,
`inventory_cancel_challan`, `inventory_mark_dispatched`,
`inventory_start_processing`, `inventory_complete_processing`,
`inventory_start_manufacturing`, `inventory_complete_manufacturing`,
`inventory_move_qc`, `inventory_reconcile`, `inventory_reserve_order`,
`inventory_release_order`.

`inventory_reconcile()` lists any balance that disagrees with the sum of its
ledger entries. The dashboard surfaces the count as an alert.

## Guarantees enforced in the database

- Negative stock is rejected (`INSUFFICIENT_STOCK`).
- Ledger rows cannot be updated or deleted.
- One active reservation per order + SKU + warehouse.
- Challan issue is idempotent on status and all-or-nothing.
- Cancellation after dispatch is refused.
- Both PCS and SQ FT are checked on every movement.

## Phase A — Master SKU foundation (2026-11-20b)

Run **`db/2026-11-20b-inventory-master-sku-foundation.sql`** once (also folded
into `db/schema.sql` as Section 34). It is additive and re-runnable; the existing
balances, ledger, reservations, challans and their functions are untouched.

What it adds:

- `inventory_master_products` — cross-company physical design identity.
- `inventory_master_variants` — the permanent **Master SKU** per physical
  variant (size + colour + material/construction through the master product).
  Size labels/units are copied exactly; nothing is converted and measurement
  settings are never consulted.
- `inventory_store_sku_map` + `..._history` — many marketplace SKUs → one
  master variant, with `UNIQUE (store_id, store_sku)` preventing conflicting
  mappings and full history on re-point/merge.
- `inventory_stock_entries`, `inventory_entry_photos`, `inventory_photo_audit` —
  physical receipt batches with mandatory-photo support, photo categories and
  replacement history (old photos are deactivated, never overwritten).
- `inventory_stock_corrections` — previous/corrected quantity, difference,
  reason and approval; a correction is never a silent overwrite.
- `inventory_order_matches` + `inventory_reviews` — one live match per order row
  and the eight review decisions.
- `return_settlements` — one settlement per returned order. Seven of the eight
  settlement types have zero stock impact; only an approved
  `RETURN_RECEIVED_LOCALLY` may create a stock entry.
- `inventory_master_availability(uuid)` — READY minus ACTIVE reservations
  aggregated across every company/store variant of one master variant.
- Private `inventory-photos` storage bucket (served through an authenticated
  proxy, never a public URL).

New capabilities: `inventory_master_admin`, `inventory_photo_upload`,
`inventory_review`, `inventory_stock_approve`, `inventory_central_allocate`,
`inventory_return_settle`.

Backfill: one master product per existing `inventory_products` row (NOT per
`product_code` — the same code in two companies can be two different products),
with `master_code` namespaced by the company short code so codes never collide.
One master variant per distinct size/colour, every variant linked to its OWN
product's master, and store-SKU mappings created only where order history proves
them. Sharing one Master SKU across products is a deliberate, audited merge on
the Master SKUs screen — never guessed by the backfill.

**Return rule change:** refunds no longer auto-increase legacy `finished_stock`.
Returned goods affect stock only after a `RETURN_RECEIVED_LOCALLY` settlement is
approved with photo evidence.

## Phase B — Master SKU + store mapping UI (2026-11-20c)

Screens: `/dashboard/inventory/masters` and `/dashboard/inventory/mappings`, both
added to the inventory tab bar. Writes require `inventory_master_admin`; reading
only needs `inventory_view`.

- **Master products** hold the design identity (code, name, material,
  construction). **Master SKUs** are their size/colour variants and are
  permanent: an auto-allocated `BASE-NNNN` SKU is never reused, including after a
  merge.
- **Store SKU mapping** is scoped by company + store. `UNIQUE (store_id,
  store_sku)` prevents the same store SKU mapping twice; re-pointing updates the
  row and writes `inventory_store_sku_map_history` (`CREATED` / `REPOINTED` /
  `DEACTIVATED` / `MERGED`), so the old mapping is never silently lost.
- **Merge** (`inventory_merge_master_variants`, migration `2026-11-20c`) is one
  transaction: store mappings (with per-row history), variant links and
  reservations move to the surviving Master SKU, the source becomes inactive with
  `merged_into_id`, and `inventory_master_merge_log` records who/why/counts. It
  refuses size/colour/material/construction mismatches and already-merged SKUs.
  Nothing is deleted.
- Size text is compared **exactly** (case/whitespace-normalised only). The merge
  never consults measurement settings and never converts order sizes.

## Phase B2 — Master SKU photos + one inventory section (2026-11-20d)

- **Master SKU photo album** (`inventory_master_variant_photos`, migration
  `2026-11-20d`): the Master SKUs screen has a **Master SKU photo** card — pick the
  SKU, pick a photo type (product main / design detail / colour reference / size
  measurement / quality check / packaging) and upload. The catalogue shows the
  newest photo as a thumbnail and flags SKUs with no photo. Files live in the
  private `inventory-photos` bucket under `masters/<variant_id>/` and are served
  only through the authenticated `/api/inventory/master-photo/[id]` proxy; no
  public URL is stored. An upload never overwrites an older photo — every one is
  kept, and the newest active row is the SKU's current photo.
- This is separate from `inventory_entry_photos`, which stays evidence attached
  to a physical stock receipt and still requires an entry.
- **One inventory section:** the inventory sub-capabilities
  (`inventory_manage`, `inventory_dispatch`, `inventory_settings`,
  `inventory_master_admin`, `inventory_photo_upload`, `inventory_review`,
  `inventory_stock_approve`, `inventory_central_allocate`,
  `inventory_return_settle`, and the legacy `finished_stock_view`) are now
  `hidden` in `capability-info.ts`, so the launcher/sidebar shows a single
  **Inventory Management** tile and every screen is reached from its tabs. They
  stay in the registry, so the Roles & Permissions matrix and all capability
  checks are unchanged (`inventory_view` is granted to every role, so nobody
  loses access). Hidden entries are also skipped by the module tab strip, so
  every `/dashboard/inventory/*` page stays on that one tab.

### Master data edit / delete (in place, no extra screens)

Everything a stock item is built from is now editable and removable from the
same Inventory Management section:

- **Product** (`/dashboard/inventory/settings`): Edit prefills the form
  (`?edit_product=`), Active checkbox controls visibility. Delete removes the
  product and its unused variants; if any variant already has stock, ledger,
  reservation, challan, job or requirement history, the product and those
  variants are deactivated instead — nothing that already happened is erased.
- **Variant (size / colour)**: Edit prefills size, colour, length/width, product
  and Active; Delete hard-deletes only a variant nothing references, otherwise
  deactivates it.
- **Warehouse**: Edit (name, code, address, Active) and Delete; a warehouse with
  stock or movement history is deactivated rather than removed.
- **Category workflow**: Edit prefills the flags for the chosen category; Delete
  removes only the workflow configuration row — the item category and its
  products are untouched.
- **Master product / Master SKU** (`/dashboard/inventory/masters`): each row has
  Edit and Delete. A used Master SKU (store mappings, linked store variants,
  reservations, stock entries) is deactivated and keeps its merge/history row;
  an unused one is deleted with its photo rows. Photos can be removed from the
  album (the row is deactivated, the private file and history stay).
- **Different stores**: the Masters screen now has a **Store update** card and a
  per-row mapping table — pick store + store SKU, choose the Master SKU and
  listing ID, and update. Re-pointing writes `inventory_store_sku_map_history`;
  Deactivate keeps the old mapping as history. Saving an inactive mapping again
  reactivates it.
- **Row update is explicit, never implicit.** The row's Update form opens with
  the Master SKU select empty and `required`, so a save always carries a Master
  SKU the operator chose on purpose. A row whose current Master SKU is inactive,
  merged or missing from the catalogue is read-only (with a note) — it cannot be
  saved from the row, because the select would otherwise fall back to its first
  option and silently re-point the store SKU. Re-map such rows from the fixed
  **Store update** form above. The row form also posts its `mapping_id`; if that
  mapping was re-pointed, deactivated or deleted in another tab meanwhile, the
  save is refused with a reload message instead of writing to a stale target.
- **Delete asks first.** Every Delete (master product, Master SKU, product,
  variant, warehouse, category workflow) and the photo Remove button shows a
  confirmation naming the record before the server action runs. The action still
  re-checks the capability and still deactivates instead of deleting when
  anything references the row.

No schema change: these use the existing `active` / `is_active` columns and the
same capability gates (`inventory_settings` for master data,
`inventory_master_admin` for the master layer).

Next phases: stock entry + entry-photo UI, order matching/review, return
settlement screens, dashboard/permissions.

## Known gaps / next steps

- **Purchase orders are still not modelled.** Requirements (what to buy) are
  raised automatically, but there is no PO entry, so "ordered − received"
  cannot be computed; closing a requirement is manual once goods arrive.
- **One order row = one SKU.** A batch/bulk order creates several rows; each row
  reserves its own quantity, so a multi-item order is covered by several
  reservations rather than one.
- `purchased_pcs` on a requirement exists for a future PO/bill link but is not
  written yet.
- Date-range filtering on the dashboard currently scopes the dispatched KPI and
  the recent-movement feed; stage totals are always as-of now.
- No email/WhatsApp alert delivery yet — alerts are computed and shown in-app.
