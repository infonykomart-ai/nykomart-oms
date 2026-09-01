-- 2026-09-01 — Multi-courier real booking (FedEx / UPS / Aramex / Delhivery
-- / Shiprocket) + booking-cost-vs-billed-cost reconciliation.
--
-- Context: this app already has ONE courier with real API booking —
-- Shipglobal (shipglobal_shipments, see db/2026-08-10-shipglobal.sql).
-- Owner asked (Hindi): "USI ME FEDEX UPS ARAMEX DELIVERY BHI ADD KARNI HAI"
-- — add these into the SAME booking flow. Also asked to capture what a
-- booking actually costs at booking time and compare it against the real
-- courier bill later (Freight Bill entry, freight_bill_awb_assignments).
--
-- DESIGN — why ONE shared `courier_shipments` table instead of 5 near-
-- duplicate `<courier>_shipments` tables (Shipglobal's own pattern):
-- Shipglobal's addOrder.php has ~25 required flat fields (seller/buyer
-- address, item HSN, IOSS...) that genuinely need their own explicit
-- columns for a 2-phase create+manifest flow. FedEx/UPS/Aramex/Delhivery/
-- Shiprocket are five MORE APIs each with their own different field shapes
-- (DDP/DDU, service codes, customs docs) — modeling every one of those as
-- 20+ explicit nullable columns on 5 separate tables is schema sprawl for
-- what is fundamentally the same "attempt log" Shipglobal's table already
-- is. Instead: one shared table, `courier` as a discriminator, the handful
-- of fields every attempt needs as real columns (order_id, status, awb,
-- the booked-amount fields this round's reconciliation feature needs), and
-- the full courier-specific request/response captured as jsonb — nothing
-- is lost (the raw payload is always there for a real audit), it is just
-- not individually columnized. Shipglobal's own table is UNCHANGED — this
-- is additive only, matching an established precedent (courier_rate_cards
-- alongside shipglobal_shipments already coexist as differently-shaped
-- courier tables in this schema).
--
-- Idempotent (IF NOT EXISTS everywhere) — safe to re-run.

-- -----------------------------------------------------------------------
-- 1. order_shipments — capture what a booking cost at booking time.
--    Nullable/additive. `booked_amount_source` distinguishes a real
--    courier-API-quoted amount from a Courier Rate Card estimate used as a
--    fallback when the courier's create-shipment response has no pricing
--    (Delhivery's Create Shipment API typically doesn't return one).
-- -----------------------------------------------------------------------
ALTER TABLE order_shipments
  ADD COLUMN IF NOT EXISTS booked_freight_amt    numeric(14,2),
  ADD COLUMN IF NOT EXISTS booked_currency       text,
  ADD COLUMN IF NOT EXISTS booked_amount_source  text
    CHECK (booked_amount_source IN ('api', 'rate_card_estimate'));

COMMENT ON COLUMN order_shipments.booked_freight_amt IS
  'What the courier quoted/charged (or, failing that, a Courier Rate Card estimate) at the moment this shipment was booked via the real courier-API booking flow (Shipglobal, FedEx, UPS, Aramex, Delhivery, Shiprocket). NULL for shipments entered manually with no API booking behind them. Compared against the real courier bill later — see freight_bill_awb_assignments.billed_freight_amt below.';
COMMENT ON COLUMN order_shipments.booked_amount_source IS
  '''api'' = the courier''s own create-shipment response returned a price. ''rate_card_estimate'' = that courier''s API had no pricing in its response, so courier_rate_cards (Freight Cost Estimator''s own table) was used as a fallback estimate instead.';

-- -----------------------------------------------------------------------
-- 2. freight_bill_awb_assignments — persist the per-shipment BILLED amount.
--    This existed transiently already (ParsedShipment.amount in
--    src/lib/courier-bills/types.ts, "this shipment's Total column") but
--    courier-bill-pdf-actions.ts's commitCourierBillPdfAction never wrote
--    it anywhere — only bill_weight_kg was persisted, the per-shipment
--    freight amount was silently dropped after the review screen. Captured
--    now so it can be compared against order_shipments.booked_freight_amt.
-- -----------------------------------------------------------------------
ALTER TABLE freight_bill_awb_assignments
  ADD COLUMN IF NOT EXISTS billed_freight_amt numeric(14,2);

COMMENT ON COLUMN freight_bill_awb_assignments.billed_freight_amt IS
  'This specific AWB''s freight amount as billed by the courier (from the PDF-parsed shipment Total, or entered manually) — compared against order_shipments.booked_freight_amt (via order_shipment_id) as a non-blocking "recheck" variance at Freight Bill entry time. Was previously parsed but never persisted (see 2026-09-01 round notes).';

-- -----------------------------------------------------------------------
-- 3. courier_shipper_profiles — ONE shared "ship from" address per company,
--    reused across FedEx/UPS/Aramex/Delhivery/Shiprocket booking (mirrors
--    shipglobal_seller_profiles' shape/purpose but generalized — the
--    physical pickup/ship-from address is the same location regardless of
--    which courier's API is being called, so one profile per company is
--    enough; Shipglobal keeps its OWN separate profile table unchanged,
--    since its addOrder.php has Shipglobal-specific fields like
--    seller_nickname/tax_id_type that don't generalize cleanly).
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courier_shipper_profiles (
  company_id        uuid PRIMARY KEY REFERENCES companies(id),
  contact_name       text NOT NULL,
  company_name        text NOT NULL,
  phone                 text NOT NULL,
  email                  text NOT NULL,
  address1                text NOT NULL,
  address2                 text,
  city                      text NOT NULL,
  state                      text NOT NULL,
  postcode                   text NOT NULL,
  country_code                text NOT NULL DEFAULT 'IN',
  tax_id                       text,   -- GSTIN — most of these APIs want it for a customs/tax declaration
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------
-- 4. courier_shipments — the shared attempt-log/booking table for the 5
--    NEW couriers this round adds (Shipglobal is untouched, see header
--    comment). One row per (order, courier) attempt, upserted on conflict
--    so a retry after a failure overwrites the prior failed attempt rather
--    than accumulating duplicate failure rows — same upsert-by-order
--    convention as shipglobal_shipments, just scoped by courier too since
--    an order could in principle be attempted through more than one
--    courier (e.g. tried FedEx, cancelled, booked via UPS instead).
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courier_shipments (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  courier             text NOT NULL CHECK (courier IN ('fedex', 'ups', 'aramex', 'delhivery', 'shiprocket')),
  order_id            uuid NOT NULL REFERENCES orders(id),
  order_shipment_id   uuid REFERENCES order_shipments(id),  -- set once the order_shipments row is written (status = 'created')
  service_code        text,      -- courier's own product/service code (e.g. FedEx "INTERNATIONAL_PRIORITY", Delhivery "Surface")
  ddp_ddu             text CHECK (ddp_ddu IN ('DDP', 'DDU')),  -- customs duty payer; NULL where the courier/lane has no such concept (e.g. Delhivery domestic)
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'created', 'failed')),
  awb_no              text,
  label_url           text,       -- either a real URL the courier returned, or a data: URI for an inline base64 label — caller decides
  booked_amt          numeric(14,2),
  booked_currency     text,
  booked_amount_source text CHECK (booked_amount_source IN ('api', 'rate_card_estimate')),
  request_payload     jsonb,      -- the exact request sent (secrets excluded) — for a real audit once live credentials are used
  response_payload    jsonb,      -- the courier's raw response (success or error body)
  error_message       text,
  created_by          uuid REFERENCES employees(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, courier)
);
CREATE INDEX IF NOT EXISTS idx_courier_shipments_order    ON courier_shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_courier_shipments_awb      ON courier_shipments(awb_no);
CREATE INDEX IF NOT EXISTS idx_courier_shipments_courier  ON courier_shipments(courier);

-- -----------------------------------------------------------------------
-- 5. New capability, gating all 5 new booking actions — deliberately
--    separate from shipglobal_shipment (a role could plausibly get one
--    without the other) but granted to the same roles (MD, Admin) as a
--    sane default, matching Shipglobal's own real-money/real-customs-
--    declaration caution.
-- -----------------------------------------------------------------------
INSERT INTO capabilities (code, description)
VALUES ('courier_booking_shipment', 'Create real FedEx / UPS / Aramex / Delhivery / Shiprocket shipments (real external shipment + label, once live credentials are configured)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'courier_booking_shipment' FROM roles r WHERE r.name IN ('MD', 'Admin')
ON CONFLICT DO NOTHING;
