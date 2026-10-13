-- 2026-10-13 — B2B Proforma Invoice completeness ("Total amount ka format
-- galat hai / seller ki complete details missing hain / buyer ka complete
-- address missing hai / product specifications incomplete hain / payment
-- terms adhure hain / shipping aur delivery terms missing hain / bank
-- details missing hain").
--
-- The A4 print view at /dashboard/b2b/documents/[id] had no columns to
-- PRINT these sections from — it could only show buyer name/country and a
-- free-text Terms line. This migration adds the storage:
--
--   b2b_quotations  buyer_address   — full buyer address (per the buyer's
--                                      own purchase order) printed in the
--                                      BUYER DETAILS block
--                   product_specs   — Size / Material / Manufacturing /
--                                      Colour / Packaging / Country of
--                                      Origin (multiline, printed as the
--                                      PRODUCT SPECIFICATIONS block)
--                   payment_terms   — advance %, method (T/T), due date,
--                                      bank charges (multiline, PAYMENT
--                                      TERMS block)
--                   shipping_terms  — incoterm detail, named ports/place,
--                                      delivery period, partial shipment,
--                                      transshipment, freight & insurance
--                                      (multiline, SHIPPING & DELIVERY
--                                      TERMS block)
--                   bank_details    — beneficiary / bank / A/C / SWIFT /
--                                      intermediary (multiline, SELLER'S
--                                      BANK DETAILS block; verify with the
--                                      bank before printing)
--   b2b_inquiries   buyer_address   — captured with the inquiry, prefills
--                                      the quotation's buyer address
--   companies       business_address, iec_no, pan_no, gstin,
--                   business_email, business_phone
--                                      — the SELLER / EXPORTER DETAILS
--                                      block (full registered address, IEC,
--                                      PAN, GSTIN where applicable, email,
--                                      phone). NULL prints "To be provided"
--                                      — the app never invents trade data.
--
-- No money columns change: totals are still the app-computed item sums,
-- and a 0 shipping amount still prints "To be confirmed" (free delivery is
-- never assumed).
--
-- Run once on the live Supabase SQL Editor. Idempotent (IF NOT EXISTS), so
-- re-running is safe. The same DDL is folded into db/schema.sql.

BEGIN;

ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS buyer_address  text;
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS product_specs  text;
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS payment_terms  text;
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS shipping_terms text;
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS bank_details    text;

ALTER TABLE b2b_inquiries ADD COLUMN IF NOT EXISTS buyer_address text;

ALTER TABLE companies ADD COLUMN IF NOT EXISTS business_address text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS iec_no            text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS pan_no            text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS gstin             text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS business_email    text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS business_phone    text;

COMMENT ON COLUMN b2b_quotations.buyer_address  IS 'Full buyer address printed on PI/CI — from the buyer PO, not guessed.';
COMMENT ON COLUMN b2b_quotations.product_specs  IS 'Multiline product specifications (size/material/manufacturing/colour/packaging/origin) printed on PI/CI.';
COMMENT ON COLUMN b2b_quotations.payment_terms  IS 'Multiline payment terms printed on PI/CI — must mirror the real buyer/seller agreement.';
COMMENT ON COLUMN b2b_quotations.shipping_terms IS 'Multiline shipping & delivery terms (ports, delivery period, partial shipment, transshipment, freight/insurance).';
COMMENT ON COLUMN b2b_quotations.bank_details   IS 'Seller bank details for buyer-bank processing — verify with the bank before printing.';
COMMENT ON COLUMN companies.iec_no IS 'Importer Exporter Code, if applicable.';
COMMENT ON COLUMN companies.gstin  IS 'GSTIN, where applicable.';

COMMIT;
