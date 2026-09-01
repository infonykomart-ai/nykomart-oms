-- 2026-09-01 (same day, follow-up round) — add DHL to the unified
-- multi-courier booking architecture shipped in
-- db/2026-09-01-multi-courier-booking-and-freight-recon.sql (FedEx / UPS /
-- Aramex / Delhivery / Shiprocket). Owner's full roster confirmed as
-- "FEDEX / UPS / DELHIVERY / ARAMEX / DHL / SHIPGLOBAL / SHIPROCKET" — DHL
-- was the one missing from that round.
--
-- RUN THIS AFTER db/2026-09-01-multi-courier-booking-and-freight-recon.sql
-- (this migration widens a CHECK constraint that migration creates — if
-- courier_shipments doesn't exist yet, this is a safe no-op and you just
-- need to run the base migration first, then this one).
--
-- No new columns, no new tables, no new capability. DHL reuses every
-- shared piece the base round already built: courier_shipper_profiles
-- (ship-from address), courier_shipments (attempt log — just widening its
-- `courier` CHECK constraint below), order_shipments.booked_freight_amt/
-- booked_currency/booked_amount_source, freight_bill_awb_assignments.
-- billed_freight_amt for the booked-vs-billed reconciliation, and the
-- existing 'courier_booking_shipment' capability (already granted to MD/
-- Admin) — nothing here is DHL-specific at the schema level.
--
-- Idempotent — DROP CONSTRAINT IF EXISTS + re-ADD, safe to re-run.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'courier_shipments') THEN
    ALTER TABLE courier_shipments DROP CONSTRAINT IF EXISTS courier_shipments_courier_check;
    ALTER TABLE courier_shipments
      ADD CONSTRAINT courier_shipments_courier_check
      CHECK (courier IN ('fedex', 'ups', 'aramex', 'delhivery', 'shiprocket', 'dhl'));
  ELSE
    RAISE NOTICE 'courier_shipments does not exist yet — run db/2026-09-01-multi-courier-booking-and-freight-recon.sql first, then re-run this migration.';
  END IF;
END $$;
