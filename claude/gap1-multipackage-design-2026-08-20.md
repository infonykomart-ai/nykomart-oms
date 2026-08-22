# Gap 1 — Multi-Package Per Order — Design Plan (2026-08-20)

Status: **DESIGN — awaiting user confirmation before schema/webhook work begins.**

## Why this needs a design doc before code (unlike Gaps 4/2/5-part1)

Research (see `general-purpose` agent report, 2026-08-20) found the entire courier-webhook
tracking system, both freight/duty bill reconciliation tables, and Shipglobal integration are
built on a hard `dispatch_invoices.order_id UNIQUE` constraint — i.e. "1 order = 1 AWB = 1
weight/dimension row" is enforced at the DB level and assumed by ~20 files, including 4 live
webhook routes (Delhivery/Shiprocket/UPS/generic), a FedEx/Aramex/DHL tracking poller, and the
freight/duty bill AWB-assignment tables (`UNIQUE(order_id)`). User confirmed (2026-08-20,
AskUserQuestion): build the **full rearchitecture now**, not a bolt-on — per-package AWBs must
flow through webhook auto-tracking and freight/duty billing, for both new and already-dispatched
orders (retroactive).

## User's answers so far (verbatim intent)

1. AWB-per-package: **"Depends on courier/case (need both)"** — some shipments share one AWB
   across all packages of an order, others get a separate AWB per package. Design must support
   both without the user having to pick a mode up front.
2. Retroactive: **"dono ke liye"** (for both) — must work for new orders AND already-dispatched
   existing orders.
3. Blast radius: **"Full per-package AWB rearchitecture now"** — webhook tracking and freight/duty
   bill assignment must become package-aware, not just a cosmetic multi-package entry form.

## Core design

### New table: `order_packages`
One row per physical package. This becomes the source of truth for weight/dimension/AWB/courier
per package.

```
order_packages
  id, order_id (FK orders), package_no (int, 1-based),
  courier_name, awb_no,                    -- may repeat across sibling rows (shared-AWB case)
  weight_kg, length_cm, width_cm, height_cm, volumetric_weight,
  delivered_status, delivered_date, last_update_date,
  remark, created_by_employee_id, created_at
  UNIQUE(order_id, package_no)
```
`awb_no` is deliberately NOT unique — two packages of the same order sharing one AWB is a valid
row shape (both rows carry the same awb_no). A webhook match on that AWB then updates every
package sharing it, not just one.

### `dispatch_invoices` — kept, becomes an order-level SUMMARY (unchanged schema)
Not dropped — too many read paths depend on it (order list display, invoice auto-pull, delete
guard, `courier-bills/match.ts` backward-compat lookup). Its `awb_no`/`courier_name`/
`shipping_weight_kg`/dims are re-synced by application code (not a DB trigger, matching this
repo's existing "business rules in app code" convention) every time `order_packages` changes for
that order:
- 1 package → dispatch_invoices mirrors that package's values exactly (today's behavior,
  unchanged for single-package orders).
- All packages share one AWB → dispatch_invoices.awb_no = that shared AWB, weight = sum of
  packages' weight_kg.
- Packages have distinct AWBs → dispatch_invoices.awb_no becomes a comma-joined list (display
  fallback only), weight = sum. Real per-AWB detail lives in `order_packages`.
- **Assumption I'm flagging, not asking about further**: order-level `delivered_status` on
  `dispatch_invoices`/`orders.shipment_status` = "Delivered" only once **every** package is
  delivered (weakest-link), not on the first package's delivery. This seems like the only
  sane default (an order isn't "delivered" if 1 of 3 boxes hasn't arrived) but it's a business
  judgment call I haven't explicitly asked about — flagging here so it's easy to correct later
  if wrong.

### Freight/Duty billing — `freight_bill_awb_assignments` / `duty_bill_awb_assignments`
Add `order_package_id` (FK `order_packages`), keep existing `order_id` column (so all current
joins/display code that filter by order_id keep working unchanged). Drop `UNIQUE(order_id)`,
add `UNIQUE(order_package_id)` — this is the actual fix, since courier bills genuinely bill
**per AWB/tracking number** ("TRACKING NUMBER KE AGAINST ME AAYEGA" per the original schema
comment), so one order with 3 AWBs can now correctly get 3 separate bill-assignment rows
instead of being artificially capped at one. Existing "already assigned" checks move from
"is this order_id already assigned" to "is this specific order_package_id already assigned."

### Courier webhook matching (`apply-tracking-event.ts`, all 4 webhook routes, FedEx poller)
Change the match query from `dispatch_invoices.ilike(awb_no).maybeSingle()` to
`order_packages.ilike(awb_no)` returning **all** matches (not `.maybeSingle()`, since a shared
AWB can match multiple package rows for one order). Update `delivered_status`/`delivered_date`
on every matched package row, then recompute that order's summary (dispatch_invoices +
orders.shipment_status) per the weakest-link rule above.

### Shipglobal integration
Unchanged externally (Shipglobal's own API/UI still manifests one shipment per call) — its write
path moves from `dispatch_invoices upsert onConflict:order_id` to
`order_packages upsert onConflict:(order_id, package_no)` targeting package_no 1, then triggers
the same dispatch_invoices resync. No multi-parcel manifest support added (that's a Shipglobal
API capability question, out of scope — flagged, not guessed).

### Bulk Tracking Update CSV
Same retarget: upserts `order_packages` (package_no defaults to 1 if the CSV's new optional
"Package No" column is blank, for backward compatibility with existing CSV templates in use),
then resyncs dispatch_invoices.

### New manual entry UI (green-field — no existing single-order dispatch form to retrofit)
New section under Documents (or a new `/dashboard/orders` per-order panel) to add/edit packages
for an order: package no, courier, AWB, weight, L/W/H. Gated behind a capability, reusing this
codebase's standard entry-page shape (`page.tsx` + `actions.ts` + client form component).

### Retroactive backfill (migration)
For every existing order with a `dispatch_invoices` row: insert one `order_packages` row
(package_no=1) copying that row's courier_name/awb_no/weight/dims/delivered_status/
delivered_date — so every already-dispatched order gets a valid package-1 record and nothing
regresses. Orders with no dispatch_invoices row yet get no package row (nothing to backfill).

## What I will NOT change in this round (flagged, not silently dropped)
- `shipglobal_shipments` table itself stays 1-row-per-order (external API constraint).
- Cross-order shared AWB (a consolidated batch AWB spanning multiple different orders) — the ask
  was multi-package **within one order**; a shared AWB across orders is a different, bigger
  question and out of scope here.
- `sales_invoices.no_of_packages`/`awb_no` (its own independent fields, already documented as
  deliberately separate from dispatch_invoices) — left as-is; not migrated to read from
  order_packages, to avoid changing invoice-generation behavior in this round.

## Build order (once confirmed)
1. Migration: `order_packages` table + backfill + `order_package_id` columns on both assignment
   tables + backfill those + constraint swap.
2. `src/lib/order-packages/resync-dispatch-summary.ts` — the shared resync helper (single vs.
   shared-AWB vs. distinct-AWB summary logic + weakest-link delivered_status).
3. Rewire `apply-tracking-event.ts` + all webhook routes + FedEx poller to match against
   `order_packages` and call the resync helper.
4. Rewire `freight_bill_awb_assignments`/`duty_bill_awb_assignments` entry paths
   (`lookupOrderForReconciliation`, `assignFreightAwb`/`assignDutyAwb`, bulk-assign,
   PDF-import commit) to resolve/assign by `order_package_id`.
5. Rewire `shipglobal/actions.ts` and `bulk-tracking-update/actions.ts` write paths.
6. New order-packages entry UI (page/actions/form).
7. Update display: orders list (show package count/AWBs), freight/duty bill reports (one line
   per assignment, already mostly true), invoice auto-pull (no change planned, but re-verify).
8. `tsc --noEmit`, dry-run migration on `omstest`, functional spot checks, deliver.
