-- 2026-09-04 — EGS-integration round: Pickup Request scheduling + Cancel
-- Shipment, the two pieces of this round that genuinely need new schema
-- (Rich shipment detail/timeline, Pending Orders staging, Combine
-- booking, and Daily Shipment Report all reuse existing tables/columns —
-- see claude/egs-integration-2026-09-04.md for the full round writeup).
--
-- Context: user sent 6 full page dumps from eBay Global Shipping (EGS,
-- ebayglobalshipping.com) asking (Hinglish, verbatim) "booking tracking
-- invoice lable campair rates jesi chije ebayglobalshiping module ki trah
-- kaam karni chahiye" — this app's courier module should functionally
-- mirror EGS's — with the explicit hard constraint "jo apna invoice ka
-- formate change nahi hoyega" (the Invoice Generation module's own output
-- format must never change; this round only ever LINKS to the existing
-- /dashboard/invoices/[id] page, never touches its rendering).
--
-- Idempotent (IF NOT EXISTS everywhere) — safe to re-run.

-- -----------------------------------------------------------------------
-- 1. Pickup Request (EGS's "Pickup Request" page) — courier + pickup
--    address + booking date + scheduled pickup date, against a set of
--    already-booked AWBs not yet picked up.
--
--    HONEST SCOPE NOTE: unlike the rate-quote APIs researched for the
--    previous round (Compare Courier Rates, 2026-09-03), no courier's
--    real pickup-scheduling API endpoint has been researched or verified
--    for any of the 6 couriers here. This table is therefore an INTERNAL
--    request log/scheduling record only — it does NOT call any courier's
--    API to actually schedule a reverse pickup. request_payload/
--    response_payload are kept nullable and reserved for a future round
--    if/when a specific courier's pickup API is researched and wired in,
--    matching this project's established "never fake an unverified API
--    call" standard (see BRAIN.md rule #11 and the rate-compare round's
--    own per-courier confidence notes).
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courier_pickup_requests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  courier                 text NOT NULL CHECK (courier IN ('fedex', 'ups', 'aramex', 'delhivery', 'shiprocket', 'dhl')),
  pickup_address          text NOT NULL,   -- snapshot of courier_shipper_profiles at request time (address can change later; this is what was actually requested)
  booking_date            date NOT NULL,
  scheduled_pickup_date   date NOT NULL,
  status                  text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'confirmed', 'cancelled')),
  remark                  text,
  request_payload         jsonb,   -- reserved for a future real courier-API integration — see note above
  response_payload        jsonb,
  created_by_employee_id  uuid REFERENCES employees(id),
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_courier_pickup_requests_company ON courier_pickup_requests(company_id);
CREATE INDEX IF NOT EXISTS idx_courier_pickup_requests_courier ON courier_pickup_requests(courier);
CREATE INDEX IF NOT EXISTS idx_courier_pickup_requests_date    ON courier_pickup_requests(scheduled_pickup_date);

-- Many AWBs per pickup request (EGS shows a table of matching AWBs the
-- request covers) — order_shipments is the per-AWB row (Gap 1,
-- 2026-08-20), same FK every other AWB-level join in this schema uses.
CREATE TABLE IF NOT EXISTS courier_pickup_request_awbs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pickup_request_id   uuid NOT NULL REFERENCES courier_pickup_requests(id),
  order_shipment_id   uuid NOT NULL REFERENCES order_shipments(id),
  UNIQUE (order_shipment_id)   -- one AWB is requested for pickup at most once (matches freight_bill_awb_assignments' own UNIQUE(order_shipment_id) convention)
);
CREATE INDEX IF NOT EXISTS idx_pickup_request_awbs_request  ON courier_pickup_request_awbs(pickup_request_id);
CREATE INDEX IF NOT EXISTS idx_pickup_request_awbs_shipment ON courier_pickup_request_awbs(order_shipment_id);

COMMENT ON TABLE courier_pickup_requests IS
  'Internal pickup-scheduling request log (EGS-style "Pickup Request" page) — courier + address + dates + which AWBs it covers. NOT a live call to any courier''s pickup-scheduling API (none has been researched/verified yet); staff still arrange the physical pickup with the courier themselves. See this table''s header comment in db/2026-09-04-egs-integration-pickup-and-cancel.sql.';

-- -----------------------------------------------------------------------
-- 2. Cancel Shipment (EGS's Shipment History Detail page's Cancel modal)
--    — widen courier_shipments.status to allow 'cancelled' + capture the
--    reason/remark, same shape as EGS's own cancel modal (reason dropdown
--    + free-text remark).
-- -----------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'courier_shipments') THEN
    ALTER TABLE courier_shipments DROP CONSTRAINT IF EXISTS courier_shipments_status_check;
    ALTER TABLE courier_shipments
      ADD CONSTRAINT courier_shipments_status_check
      CHECK (status IN ('pending', 'created', 'failed', 'cancelled'));
  ELSE
    RAISE NOTICE 'courier_shipments does not exist yet — run db/2026-09-01-multi-courier-booking-and-freight-recon.sql first, then re-run this migration.';
  END IF;
END $$;

ALTER TABLE courier_shipments
  ADD COLUMN IF NOT EXISTS cancel_reason  text,
  ADD COLUMN IF NOT EXISTS cancel_remark  text,
  ADD COLUMN IF NOT EXISTS cancelled_at   timestamptz;

COMMENT ON COLUMN courier_shipments.cancel_reason IS
  'Reason code picked from the Cancel Shipment modal''s dropdown (free text, not an enum — same "matches the real document/flow, not over-engineered" convention as this schema''s other reason-code text columns, e.g. duty_tax_bills / debit_notes remark fields).';
