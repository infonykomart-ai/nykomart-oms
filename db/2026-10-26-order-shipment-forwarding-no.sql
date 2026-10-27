-- 2026-10-26 — SECOND TRACKING NUMBER PER SHIPMENT ("sabhi order me 2 parkar
-- ki tracking AWB hota hai — ek tracking no dusra forwarding no, jo zyadatar
-- Shiprocket / Shipglobal / OnPoint / Delhivery jaise couriers me hota hai").
--
-- Aggregator-style couriers hand out TWO numbers for the same parcel:
--   * awb_no        — the CARRIER's tracking number (what the end buyer and
--                     the courier-tracking APIs use), and
--   * forwarding_no — the FORWARDER/aggregator's own reference for the same
--                     parcel (Shiprocket's shipment id, Shipglobal's order
--                     number, OnPoint/Delhivery's partner/forwarding ref).
-- Staff look parcels up in the aggregator's portal with the second number,
-- but the app only ever stored the first, so it had to be kept outside the
-- system (notes / WhatsApp / paper).
--
-- Storage follows the exact pattern awb_no already uses:
--   order_shipments.forwarding_no    — SOURCE OF TRUTH (per real AWB/shipment)
--   courier_shipments.forwarding_no  — mirror, so Courier Ops → Track
--                                      Shipments can search/show it too
--                                      (same mirroring shipping-actions.ts
--                                      already does for awb_no).
--
-- Idempotent — safe to run twice. MUST run BEFORE the app code that writes
-- these columns, otherwise PostgREST rejects the insert/update with
-- "column forwarding_no does not exist". Nothing breaks if it is not run
-- other than the feature itself: both columns are optional and only ever
-- written when a number is actually present.
--
-- Probe: src/lib/db/schema-status.ts (SCHEMA_CHECKS) — until this is applied
-- the Admin's Schema / Migration Status panel lists this file as pending.

ALTER TABLE order_shipments ADD COLUMN IF NOT EXISTS forwarding_no text;
COMMENT ON COLUMN order_shipments.forwarding_no IS
  '2026-10-26: the FORWARDER/aggregator''s own reference for this same parcel (Shiprocket shipment id, Shipglobal order number, OnPoint/Delhivery partner ref) — the second number staff look the shipment up with, beside awb_no which stays the carrier''s tracking number.';

-- Partial index only — the overwhelming majority of rows are NULL, and every
-- real lookup is an exact/partial match on a non-null value (same reasoning
-- as idx_courier_webhook_awb's friends elsewhere in the schema).
CREATE INDEX IF NOT EXISTS idx_order_shipments_forwarding_no
  ON order_shipments(forwarding_no) WHERE forwarding_no IS NOT NULL;

ALTER TABLE courier_shipments ADD COLUMN IF NOT EXISTS forwarding_no text;
COMMENT ON COLUMN courier_shipments.forwarding_no IS
  '2026-10-26: mirror of order_shipments.forwarding_no for the booking/Track-Shipments side — see the header comment in db/2026-10-26-order-shipment-forwarding-no.sql.';

CREATE INDEX IF NOT EXISTS idx_courier_shipments_forwarding_no
  ON courier_shipments(forwarding_no) WHERE forwarding_no IS NOT NULL;
