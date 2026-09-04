-- 2026-09-04 — Manual Entry (Booked Outside) for the Courier Ops
-- Dashboard's Book Shipment tab: staff sometimes book a large shipment
-- with a courier or process OUTSIDE this app entirely (not one of the 6
-- integrated couriers — FedEx/UPS/Aramex/Delhivery/Shiprocket/DHL) and
-- still need the dimension/weight/courier-charge captured here so the
-- cost shows up in Track Shipments and feeds the SAME Booked vs Billed
-- reconciliation Freight Bill entry already reads off
-- order_shipments.booked_freight_amt/booked_currency (see
-- db/2026-09-01-multi-courier-booking-and-freight-recon.sql) — NOT a
-- separate/parallel mechanism. User explicitly chose a REAL row in
-- order_shipments/courier_shipments (same shape every real
-- create*Booking action in courier-booking/actions.ts writes) over a
-- lightweight disconnected note. See
-- src/app/dashboard/courier-booking/manual-booking-actions.ts.
--
-- Idempotent (DROP CONSTRAINT IF EXISTS + re-ADD, ADD COLUMN IF NOT
-- EXISTS) — safe to re-run.

-- -----------------------------------------------------------------------
-- 1. courier_shipments.courier — add 'other' for a manual entry whose
--    real-world courier isn't one of the 6 integrated ones (or wasn't
--    identified at all). manual_courier_name carries the free-text name
--    in that case; courier stays one of the 6 real values when the
--    employee picked a real courier they just happened to book outside
--    this app (e.g. booked FedEx directly on FedEx's own site).
-- -----------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'courier_shipments') THEN
    ALTER TABLE courier_shipments DROP CONSTRAINT IF EXISTS courier_shipments_courier_check;
    ALTER TABLE courier_shipments
      ADD CONSTRAINT courier_shipments_courier_check
      CHECK (courier IN ('fedex', 'ups', 'aramex', 'delhivery', 'shiprocket', 'dhl', 'other'));
  ELSE
    RAISE NOTICE 'courier_shipments does not exist yet — run db/2026-09-01-multi-courier-booking-and-freight-recon.sql first, then re-run this migration.';
  END IF;
END $$;

ALTER TABLE courier_shipments
  ADD COLUMN IF NOT EXISTS manual_courier_name text;

COMMENT ON COLUMN courier_shipments.manual_courier_name IS
  'Free-text courier/process name for a Manual Entry (Booked Outside) row where courier = ''other'' — e.g. a courier not among the 6 integrated ones, or an unnamed local/hand-carried process. NULL for every real API booking, and NULL for a manual entry against one of the 6 known couriers (the courier column already names it there).';

-- -----------------------------------------------------------------------
-- 2. booked_amount_source — add 'manual' alongside the existing 'api' /
--    'rate_card_estimate' discriminator, same established "*_source"
--    convention this schema already uses elsewhere (e.g.
--    bill_pass_register.source, received_chalans.source): a manual entry
--    has a courier charge on file but NO API call behind it at all, so
--    it's neither 'api' (the courier's own response) nor a Courier Rate
--    Card fallback estimate.
-- -----------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'courier_shipments') THEN
    ALTER TABLE courier_shipments DROP CONSTRAINT IF EXISTS courier_shipments_booked_amount_source_check;
    ALTER TABLE courier_shipments
      ADD CONSTRAINT courier_shipments_booked_amount_source_check
      CHECK (booked_amount_source IN ('api', 'rate_card_estimate', 'manual'));
  ELSE
    RAISE NOTICE 'courier_shipments does not exist yet — run db/2026-09-01-multi-courier-booking-and-freight-recon.sql first, then re-run this migration.';
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_shipments') THEN
    ALTER TABLE order_shipments DROP CONSTRAINT IF EXISTS order_shipments_booked_amount_source_check;
    ALTER TABLE order_shipments
      ADD CONSTRAINT order_shipments_booked_amount_source_check
      CHECK (booked_amount_source IN ('api', 'rate_card_estimate', 'manual'));
  ELSE
    RAISE NOTICE 'order_shipments does not exist yet — run db/2026-08-20-order-shipments-and-packages.sql first, then re-run this migration.';
  END IF;
END $$;
