# Gap 1 — Multi-Package Per Order — BUILD COMPLETE (2026-08-20)

Design doc: `claude/gap1-multipackage-design-2026-08-20.md` (confirmed by user before
build started). This doc records what was actually built, verified, and any
deviations from the design.

## User's answers driving this build
1. AWB-per-package: **"Depends on courier/case (need both)"** — packages can share one
   AWB or each get their own.
2. Retroactive: **"dono ke liye"** — must work for new AND already-dispatched orders.
3. Blast radius: **"Full per-package AWB rearchitecture now"** — webhooks + freight/duty
   billing had to become AWB-aware, not just a cosmetic entry form.
4. Design confirmed as-is, including the flagged weakest-link `delivered_status`
   assumption (order = 'Delivered' only once every shipment on it is delivered).

## What changed from the design doc during implementation
The design doc originally proposed a single `order_packages` table carrying `awb_no`
directly. While building the freight/duty billing rewire, I found this created a real
ambiguity: courier bills invoice PER AWB, and if 2 packages share one AWB there'd be no
single row representing "that one AWB" to attach a bill line to. Fixed by splitting into
**two tables**: `order_shipments` (one row per real AWB) and `order_packages` (one row
per physical box, FK'd to the shipment/AWB it travels under). This is a cleaner model of
the same confirmed design — same capabilities, no re-confirmation needed since it doesn't
change any of the answers above, just how they're represented.

## What was built
- **Migration**: `db/2026-08-20-order-shipments-and-packages.sql` — `order_shipments` +
  `order_packages` tables, retroactive backfill (1 shipment + 1 package per existing
  `dispatch_invoices` row), `freight_bill_awb_assignments`/`duty_bill_awb_assignments`
  retargeted from `UNIQUE(order_id)` to `UNIQUE(order_shipment_id)` (with `order_id` kept
  for existing joins/display), and both reconciliation views rewritten to pull the
  specific shipment's AWB/weight instead of the order-level summary.
- **`src/lib/order-packages/resync-dispatch-summary.ts`** — the one place that recomputes
  `dispatch_invoices`' summary fields (awb_no/courier_name/weight/dims/delivered_status)
  from `order_shipments`/`order_packages` after any write. `dispatch_invoices` itself is
  unchanged in shape — every existing read path (order list, invoice auto-pull, delete
  guard) keeps working automatically.
- **Courier webhooks rewired**: `apply-tracking-event.ts` (shared helper used by
  Delhivery/Shiprocket/UPS/FedEx-poller) now matches `order_shipments.awb_no`, handles
  every matching shipment (not just one), and calls the resync helper. The generic
  `/api/webhooks/courier/route.ts` previously had its OWN duplicate direct-`dispatch_
  invoices` implementation instead of using the shared helper — fixed to use it, closing
  a pre-existing inconsistency as part of this rewire. The FedEx/Aramex poller
  (`poll-fedex-tracking/route.ts`) now queries `order_shipments` for pending AWBs instead
  of `dispatch_invoices`, fixing a real bug the old query would have had under the new
  model: a partially-delivered multi-AWB order would show a non-null 'NOT Delivered'
  order-level summary and silently stop being polled for its still-pending AWBs.
- **Freight/Duty billing rewired**: `lookupOrderForReconciliation` now resolves a specific
  `order_shipment_id` — unambiguous when searching by AWB; when searching by PO/RF/RG,
  auto-picks the shipment only if the order has exactly one (today's case for every
  order), otherwise asks the user to search by AWB instead rather than guessing. Threaded
  through `assignFreightAwb`/`assignDutyAwb`, both bulk-assign paths, the Courier-Bill-PDF
  auto-match + its manual "Fix match" picker, and `matchShipmentByTracking`.
- **Shipglobal + Bulk Tracking Update CSV** retargeted to write `order_shipments`/
  `order_packages` (shipment/package 1) instead of `dispatch_invoices` directly, then
  resync. CSV template gained an optional "Shipment No" column (blank = shipment 1, so
  every existing CSV in use still works unchanged).
- **New entry screen**: `/dashboard/order-packages` (📦 Order Shipments & Packages,
  gated on `doc_entry`, same as every other Documents-module screen) — look up an order,
  add/edit/delete shipments (courier/AWB/delivered status) and the packages under each
  (weight/L/W/H). Green-field build — no prior UI existed for this.
- **Freight/Duty Bill report pages** (`freight-bills/[id]/report`,
  `duty-bills/[id]/report`) — the printable reconciliation reports — updated to pull
  each assignment row's own AWB/weight from its specific shipment/packages, matching the
  view fix, instead of the order-level `dispatch_invoices` summary (would have shown the
  same joined multi-AWB text on every row of a multi-shipment order otherwise).
- `db/schema.sql` and `src/types/database.ts` updated to match.

## Verification performed
- Migration dry-run on `omstest` (real production snapshot, currently empty of
  transactional data) — applies cleanly.
- Synthetic-data dry-run (companies/orders/dispatch_invoices/freight_bills inserted in a
  rolled-back transaction) confirming: backfill produces exactly 1 shipment + 1 package
  per existing order; a second shipment + freight-bill-assignment can now be added for the
  same order (previously blocked by `UNIQUE(order_id)`); `UNIQUE(order_id, shipment_no)`
  correctly rejects a duplicate; the rewritten `freight_reconciliation_view` correctly
  shows each shipment's own AWB and the SUM of its packages' weight (tested a shared-AWB
  case: 2 packages under shipment 1 correctly summed to 6.5kg vs. shipment 2's 2.5kg).
- `npx tsc --noEmit` — clean, whole repo.
- `npx eslint src/` — clean, whole repo.

## Known limitation (accepted, not fixed this round)
Deleting the LAST remaining shipment on an order leaves `dispatch_invoices`' summary
fields stale (resync intentionally no-ops when an order has zero shipments, rather than
blanking out a row that may still hold independently-managed billing fields). Low risk —
an order having its only shipment record deleted entirely is a rare edge case — but
flagging it here rather than silently.

## Not done this round (deliberately, per the design doc)
- `shipglobal_shipments` itself stays 1-row-per-order (external API constraint, not a
  data-model choice).
- Cross-order shared AWB (a consolidated batch AWB spanning multiple different orders) —
  out of scope; the ask was multi-package within one order.
- `sales_invoices.awb_no`/`no_of_packages` — left independently managed, not migrated to
  read from the new tables.

## Still needs from you
- **Run the migration**: `db/2026-08-20-order-shipments-and-packages.sql` in Supabase SQL
  Editor (delivered separately).
- After running it, I'll re-verify live in production via the standard Supabase
  SQL Editor check before calling this fully done — per the standing rule, a "done" claim
  gets independently re-checked, not trusted.

This completes all 5 gaps from the original Hinglish list (Gap 3 needed no build — see
the main plan doc; Gaps 4/2/5-part-1/1 all built and verified this round).
