-- 2026-10-13 — B2B PI completeness ("ye chiJen nahi aa rahi PI me").
-- Three gaps the user's CA-style review of a real Proforma Invoice found:
--   1. Seller block printed only "Export House · India" — no registered
--      address, IEC, PAN, GSTIN, email, phone, and no bank details at all.
--      → b2b_export_profiles: ONE row per company, filled once, reused on
--      every PI/CI issued by that company.
--   2. The quotation had no fields for the standard export-PI sections:
--      buyer full address + attention person, payment condition/method/
--      due-date/bank-charges, ports, delivery period, partial shipment,
--      transshipment, freight+insurance responsibility, country of origin,
--      packing details, purpose, and explicit tax/shipping NOTES (so
--      "Shipping $0.00" can say "To be confirmed" instead of a fake zero).
--      → columns on b2b_quotations.
--   3. Item lines had no product specifications (size / material /
--      manufacturing / colour / packaging). → spec columns on
--      b2b_quotation_items, printed as a sub-line under each description.
--
-- Idempotent: safe to run twice. Folded into db/schema.sql (single source
-- of truth); regenerate src/types/database.ts afterwards
-- (node scripts/gen-types.mjs with a local Postgres loaded from schema.sql).

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Company-level export profile (seller + beneficiary bank details)
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS b2b_export_profiles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL UNIQUE REFERENCES companies(id),
  seller_address      text,   -- full registered/business address (line breaks allowed)
  iec                 text,   -- Importer Exporter Code
  pan                 text,
  gstin               text,
  email               text,
  phone               text,
  bank_beneficiary    text,   -- beneficiary name
  bank_name           text,
  bank_branch         text,
  bank_account        text,
  bank_swift          text,   -- SWIFT / BIC
  bank_intermediary   text,   -- correspondent/intermediary bank, if applicable
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE b2b_export_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated_all ON b2b_export_profiles;
CREATE POLICY allow_authenticated_all ON b2b_export_profiles FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Quotation-level export-document fields (every PI/CI section)
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS buyer_address     text;  -- full buyer address
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS buyer_attention   text;  -- attention: contact person
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS payment_condition text;  -- e.g. "100% advance before dispatch"
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS payment_method    text;  -- e.g. "Bank Transfer (T/T)"
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS payment_due_note  text;  -- e.g. "Before dispatch" / "Within 30 days of B/L"
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS bank_charges      text;  -- "To be mutually agreed" / "Buyer's account"…
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS port_of_loading     text;
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS port_of_destination text;
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS delivery_period     text;  -- e.g. "90 days after advance payment"
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS partial_shipment    text;  -- Allowed / Not allowed / To be agreed
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS transshipment       text;  -- Allowed / Not allowed / To be agreed
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS freight_insurance   text;  -- who pays freight & insurance
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS country_of_origin   text;  -- e.g. India
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS packing_details     text;  -- individual/bulk packaging, as agreed
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS tax_note            text;  -- shown INSTEAD of the tax amount when set (e.g. "To be confirmed — verify export GST treatment")
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS shipping_note       text;  -- shown INSTEAD of the shipping amount when set (e.g. "To be confirmed" / "Free FOB Kolkata")
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS purpose             text;  -- e.g. "Proforma invoice for advance payment and buyer-bank processing"

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Per-item product specifications (Size / Material / Manufacturing /
--    Colour-design / Packaging) — printed as a spec sub-line on PI/CI
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE b2b_quotation_items ADD COLUMN IF NOT EXISTS size          text;  -- e.g. 2 × 6 feet
ALTER TABLE b2b_quotation_items ADD COLUMN IF NOT EXISTS material      text;  -- e.g. 100% Jute
ALTER TABLE b2b_quotation_items ADD COLUMN IF NOT EXISTS manufacturing text;  -- e.g. Handmade, handwoven
ALTER TABLE b2b_quotation_items ADD COLUMN IF NOT EXISTS colour_design text;  -- e.g. As agreed
ALTER TABLE b2b_quotation_items ADD COLUMN IF NOT EXISTS packaging     text;  -- e.g. Individual/bulk packaging, as agreed

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Round 2 (same review) — flexible units, SIZE × QTY formulas, drafts,
--    payment instructions, quotation lifecycle.
--
--    a) QUOTATION STATUS: "DRAFT KE SABHI OPTION HONA CHAHIYE" — a quote
--       now starts as Draft (fully editable / deletable, never shared by
--       accident) and moves Draft → Sent (→ Approved/Rejected/Expired as
--       the buyer responds). Existing rows: those already marked sent_at
--       become Sent; the rest become Draft (the safe reading — an unsent
--       quote IS a draft).
--    b) PAYMENT INSTRUCTIONS: a buyer-facing bank-remittance paragraph
--       (separate from the short payment_condition line — this is what the
--       buyer's bank actually needs to process the advance).
--    c) SIZE × QTY dimensions: structured L/W/thickness parsed from the
--       free-typed size spec so sq ft / sq mtr / CBM compute identically
--       everywhere (quote form preview, PI sub-line, packing). app-side
--       formula lives in src/lib/b2b/erp.ts (computeItemDims).
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'Draft'
  CHECK (status IN ('Draft', 'Sent', 'Approved', 'Rejected', 'Expired'));
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS payment_instructions text;
-- Backfill (first run only; stays a no-op on re-runs): a quote with
-- sent_at was already shared with a buyer → Sent. Unsent rows keep the
-- DEFAULT 'Draft' the ADD COLUMN wrote above.
UPDATE b2b_quotations SET status = 'Sent' WHERE sent_at IS NOT NULL AND status = 'Draft';

ALTER TABLE b2b_quotation_items ADD COLUMN IF NOT EXISTS size_length    numeric(10,2);
ALTER TABLE b2b_quotation_items ADD COLUMN IF NOT EXISTS size_width     numeric(10,2);
ALTER TABLE b2b_quotation_items ADD COLUMN IF NOT EXISTS size_thickness numeric(10,3);
ALTER TABLE b2b_quotation_items ADD COLUMN IF NOT EXISTS size_unit      text DEFAULT 'ft'
  CHECK (size_unit IN ('ft', 'm', 'cm', 'inch') OR size_unit IS NULL);
