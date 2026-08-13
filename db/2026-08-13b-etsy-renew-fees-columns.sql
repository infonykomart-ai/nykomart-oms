-- 2026-08-13 (part 2) — verified across ALL 7 real Jan-Jul 2026 Etsy
-- Monthly Tax Invoice PDFs (not just the Jan-only sample the first
-- 2026-08-13 migration was built from). Two more real line-item shapes
-- showed up:
--   1) a THIRD "Renew Fees" line, distinct from "Renew Expired Fees" and
--      "Renew Sold Fees" (real March 2026 invoice: qty 1, INR19).
--   2) "Renew Expired Fees" and "Renew Sold Fees" can EACH also carry a
--      second flat "--"-priced line, same shape as listing_fees_other
--      (real Mar/Apr/May/Jun invoices).
-- Also re-verified: the order_number extraction on etsy_ledger_lines
-- (added in the first 2026-08-13 migration) holds correctly across all 7
-- months' real Etsy Ledger CSVs, including the "Buyer Fee" Type seen in
-- March — no schema change needed there.
--
-- Run this AFTER db/2026-08-13-etsy-order-matching-and-invoice-fix.sql
-- (safe either way — these are separate new columns).

ALTER TABLE etsy_monthly_tax_invoices ADD COLUMN IF NOT EXISTS renew_fees_qty integer NOT NULL DEFAULT 0;
ALTER TABLE etsy_monthly_tax_invoices ADD COLUMN IF NOT EXISTS renew_fees numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE etsy_monthly_tax_invoices ADD COLUMN IF NOT EXISTS renew_expired_fees_other numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE etsy_monthly_tax_invoices ADD COLUMN IF NOT EXISTS renew_sold_fees_other numeric(14,2) NOT NULL DEFAULT 0;

-- Generated STORED columns can't be ALTERed in place — drop + recreate
-- with the new columns folded into the formula (see db/schema.sql for the
-- full reasoning comment).
ALTER TABLE etsy_monthly_tax_invoices DROP COLUMN IF EXISTS subtotal_inr;
ALTER TABLE etsy_monthly_tax_invoices DROP COLUMN IF EXISTS gst_amount_inr;
ALTER TABLE etsy_monthly_tax_invoices DROP COLUMN IF EXISTS total_inr;

ALTER TABLE etsy_monthly_tax_invoices ADD COLUMN subtotal_inr numeric(14,2) GENERATED ALWAYS AS (
  subscription_plan_fees + listing_fees + listing_fees_other + transaction_fees
  + renew_fees + renew_expired_fees + renew_expired_fees_other + renew_sold_fees + renew_sold_fees_other
  + etsy_ads_fees + processing_fees + offsite_ads_fees + regulatory_operating_fees - promotional_discount
) STORED;

ALTER TABLE etsy_monthly_tax_invoices ADD COLUMN gst_amount_inr numeric(14,2) GENERATED ALWAYS AS (
  (subscription_plan_fees + listing_fees + listing_fees_other + transaction_fees
   + renew_fees + renew_expired_fees + renew_expired_fees_other + renew_sold_fees + renew_sold_fees_other
   + etsy_ads_fees + processing_fees + offsite_ads_fees + regulatory_operating_fees - promotional_discount)
  * gst_pct
) STORED;

ALTER TABLE etsy_monthly_tax_invoices ADD COLUMN total_inr numeric(14,2) GENERATED ALWAYS AS (
  (subscription_plan_fees + listing_fees + listing_fees_other + transaction_fees
   + renew_fees + renew_expired_fees + renew_expired_fees_other + renew_sold_fees + renew_sold_fees_other
   + etsy_ads_fees + processing_fees + offsite_ads_fees + regulatory_operating_fees - promotional_discount)
  * (1 + gst_pct)
) STORED;

-- 2026-08-13: fix a real bug found while cross-checking the CSV Upload ->
-- Etsy Ledger import against real export data — the column-config header
-- for txn_date said "Txn Date" but Etsy's real CSV export's actual column
-- is named "Date". Every previously-imported row via that screen would
-- have landed with txn_date = NULL. This is an app-code fix (see
-- src/lib/statement-import/tables.ts), not a schema change — no SQL
-- needed for it — but noted here since it was found in the same pass. If
-- you already imported Etsy Ledger CSVs via the CSV Upload screen before
-- this fix, their txn_date will be NULL; safest is to delete those rows
-- from etsy_ledger_lines for the affected company and re-import after
-- picking up this fix.
