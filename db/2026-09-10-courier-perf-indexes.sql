-- 2026-09-10 — Courier Ops Dashboard performance fix (companion piece to
-- the code changes in pickup-request-data.ts / courier-booking/page.tsx).
--
-- Every tab on the Courier Ops Dashboard (Track Shipments, Courier
-- Performance, Daily Shipment Report) queries `courier_shipments` the
-- same shape every time: optionally filter by `status`/`courier`, always
-- `ORDER BY created_at DESC LIMIT N`. That table only had indexes on
-- `order_id`, `awb_no`, and `courier` individually — none of them help a
-- sort-by-created_at-then-limit scan, so this has been doing a full table
-- scan + sort on every single page load, one that gets slower as more
-- shipments get booked over time. This is doubly relevant now that this
-- page is also getting near-live auto-refresh (a separate delivery) —
-- without this fix, that refresh would just repeat the slow scan every
-- 10-20 seconds.
--
-- Also adds a partial index for the Pickup Request tab's "AWBs not yet
-- delivered" candidate query (order_shipments), which used to be a full
-- table scan too (see getPickupCandidatesForAllCouriers's own comment in
-- pickup-request-data.ts for the code-side half of this fix).
--
-- Purely additive — new indexes only, no table/column/constraint changes,
-- safe to run any time, no app downtime. Idempotent (IF NOT EXISTS).

CREATE INDEX IF NOT EXISTS idx_courier_shipments_created_at
  ON courier_shipments (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_courier_shipments_status_created
  ON courier_shipments (status, created_at DESC);

-- Partial index: only rows Pickup Request's candidate query actually
-- looks at (not yet delivered, has an AWB) are indexed at all, keeping
-- this index small even as delivered/old shipments pile up in the table.
CREATE INDEX IF NOT EXISTS idx_order_shipments_pending_pickup
  ON order_shipments (id)
  WHERE delivered_status IS NULL AND awb_no IS NOT NULL;
