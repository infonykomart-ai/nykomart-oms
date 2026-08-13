-- 2026-08-13: Two fixes from the user's first real Etsy data of this round
-- (etsy_statement_2026_1.csv — Jan 2026 Etsy Ledger export, and
-- tax_statement_20261.pdf — the matching Jan 2026 Etsy Monthly Tax
-- Invoice, both for Nyko Mart/artsofjaipur):
--
-- 1. etsy_monthly_tax_invoices was missing a fee line. The real invoice
--    has TWO separate "Listing Fees" rows — one qty-based ("13 Listing
--    Fees, $0.20 each = INR234", matching listing_fees_qty/listing_fees
--    already on the table) and a SECOND flat one ("1 Listing Fees, --,
--    INR2") with no unit price shown. The old subtotal_inr formula (built
--    2026-08-12 from a written description only, no real invoice on hand
--    yet) summed to INR 76,587 against this invoice's real line items —
--    INR 4 short of the invoice's own printed Subtotal (INR 76,591).
--    Adding listing_fees_other (=INR2 on this invoice) accounts for
--    exactly INR 2 of that gap; the formula now lands at INR 76,589, a
--    residual INR 2 short — matching the SAME already-disclosed rounding
--    caveat from the original 2026-08-01 build (Etsy rounds each line to
--    the nearest rupee before printing, so summing the rounded lines
--    doesn't perfectly equal the PDF's own separately-rounded Subtotal).
--    Not a further schema gap — see subtotal_inr's own comment in
--    schema.sql.
--
-- 2. etsy_ledger_lines gets a generated order_number column — the user
--    wants store-level fees automatically matched to the order they
--    belong to (2026-08-13 request: "store par jab order aaya to kon kon
--    si fee lagi vo uske store ke statement se milani padegi"). The real
--    CSV shows every fee/tax/sale/refund row for a given order repeats
--    "Order #<digits>" verbatim in either the Info column (most row
--    types) or the Title column (Sale/Refund rows, where Info is blank)
--    — confirmed against the real Jan 2026 file: every "Order #" value
--    is a plain 10-digit number, always in that exact "Order #<digits>"
--    form, no other format seen. A STORED generated column keeps this
--    in sync automatically on every CSV import with no app-code special
--    case — see src/app/dashboard/csv-upload/actions.ts's generic
--    importer, which needed NO changes for this.
-- =============================================================================

ALTER TABLE etsy_monthly_tax_invoices
  ADD COLUMN listing_fees_other numeric(14,2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN etsy_monthly_tax_invoices.listing_fees_other IS
  'A second, flat "Listing Fees" line seen on the real invoice with no stated qty/unit price (distinct from the '
  'qty-based listing_fees above) — confirmed 2026-08-13 against a real Jan 2026 invoice, not a guess.';

-- Generated columns can't be ALTERed in place (Postgres requires DROP+ADD
-- for a STORED generated column's expression) — drop and recreate all 3,
-- now including listing_fees_other.
ALTER TABLE etsy_monthly_tax_invoices DROP COLUMN subtotal_inr;
ALTER TABLE etsy_monthly_tax_invoices DROP COLUMN gst_amount_inr;
ALTER TABLE etsy_monthly_tax_invoices DROP COLUMN total_inr;

ALTER TABLE etsy_monthly_tax_invoices ADD COLUMN subtotal_inr numeric(14,2) GENERATED ALWAYS AS (
  subscription_plan_fees + listing_fees + listing_fees_other + transaction_fees + renew_expired_fees + renew_sold_fees
  + etsy_ads_fees + processing_fees + offsite_ads_fees + regulatory_operating_fees - promotional_discount
) STORED;
ALTER TABLE etsy_monthly_tax_invoices ADD COLUMN gst_amount_inr numeric(14,2) GENERATED ALWAYS AS (
  (subscription_plan_fees + listing_fees + listing_fees_other + transaction_fees + renew_expired_fees + renew_sold_fees
   + etsy_ads_fees + processing_fees + offsite_ads_fees + regulatory_operating_fees - promotional_discount)
  * gst_pct
) STORED;
ALTER TABLE etsy_monthly_tax_invoices ADD COLUMN total_inr numeric(14,2) GENERATED ALWAYS AS (
  (subscription_plan_fees + listing_fees + listing_fees_other + transaction_fees + renew_expired_fees + renew_sold_fees
   + etsy_ads_fees + processing_fees + offsite_ads_fees + regulatory_operating_fees - promotional_discount)
  * (1 + gst_pct)
) STORED;

-- Etsy Ledger order-matching column (see header comment #2).
ALTER TABLE etsy_ledger_lines
  ADD COLUMN order_number text GENERATED ALWAYS AS (
    COALESCE(substring(info from 'Order #(\d+)'), substring(title from 'Order #(\d+)'))
  ) STORED;

CREATE INDEX idx_etsy_ledger_order_number ON etsy_ledger_lines(order_number) WHERE order_number IS NOT NULL;

COMMENT ON COLUMN etsy_ledger_lines.order_number IS
  'Auto-extracted from Info (most row types) or Title (Sale/Refund rows) — matches orders.marketplace_order_no '
  'so a store''s per-order fees can be looked up automatically. Verified against a real Jan 2026 export, not guessed.';
