-- 2026-10-24 (b) — round figure payments, the printing-bill section, and
-- "as billed" purchase sizes.
--
-- 1) ROUND FIGURE — "SABHI PARKAR KE BILLS ME ROUND FIGR SE PAYMET ADD KARNE
--    KA YA ROUND FIGURE SET KARNE KA OPTION AAYE FREIGHT DUTY PURCHASE
--    WASHING AND ANY OTHER BILLS". purchase_bills already had round_off_amt;
--    freight_bills / duty_tax_bills / washing_entries did not, so a payable
--    that the vendor rounded to ₹X could only be matched by fudging the base
--    amounts. Each now carries its own round_off_amt.
--
--    Deliberately NOT folded into the existing generated columns
--    (freight_bills.gross_total_amt etc.): those are referenced by the
--    variance views and by bill_pass_register mirrors, and dropping them to
--    add + round_off_amt would break those views on a live database. The net
--    payable is therefore gross_total_amt + round_off_amt, computed by the
--    app (reports, forms and the Finance ledger all use the same helper), so
--    the bill's own pre-round-off arithmetic stays exactly as it was.
--
-- 2) PRINTING BILL — "COTTON KI DHURRI KE PO KE ORDER KA PRINTING KA BILL
--    AATA HAI ... USKI ENTRY KAHA HOGI USKA TO KOI SECTION HI NAHI HAI".
--    A printing bill has the same shape as a purchase bill (vendor invoice,
--    PO link, qty × rate, GST, round off), so it reuses purchase_bills with
--    bill_kind = 'printing' instead of a parallel table that would duplicate
--    the GST/round-off/ledger logic. Existing rows stay 'purchase'.
--
-- 3) SIZE MODE — "AGAR KISI VENDOR NE MTR ME LINEAR METRES BILL KIYA HAI
--    (FABRIC ROLLS) TO US NUMBER KO AREA MAAN KAR SQUARE KARNA MATHEMATICALLY
--    MEANING NAHI RAKHTA". 'area' (default) keeps the Sq Ft normalisation
--    shipped in the previous round; 'as_billed' shows the number exactly as
--    the vendor billed it, with its own unit. Never a silent guess — it is an
--    explicit per-bill choice on the entry form.
--
-- Safe to run more than once.

BEGIN;

ALTER TABLE purchase_bills
  ADD COLUMN IF NOT EXISTS bill_kind text NOT NULL DEFAULT 'purchase'
    CHECK (bill_kind IN ('purchase', 'printing')),
  ADD COLUMN IF NOT EXISTS size_mode text NOT NULL DEFAULT 'area'
    CHECK (size_mode IN ('area', 'as_billed'));

ALTER TABLE freight_bills
  ADD COLUMN IF NOT EXISTS round_off_amt numeric(8,2) NOT NULL DEFAULT 0
    CHECK (round_off_amt >= -1000 AND round_off_amt <= 1000);

ALTER TABLE duty_tax_bills
  ADD COLUMN IF NOT EXISTS round_off_amt numeric(8,2) NOT NULL DEFAULT 0
    CHECK (round_off_amt >= -1000 AND round_off_amt <= 1000);

ALTER TABLE washing_entries
  ADD COLUMN IF NOT EXISTS round_off_amt numeric(8,2) NOT NULL DEFAULT 0
    CHECK (round_off_amt >= -1000 AND round_off_amt <= 1000);

COMMENT ON COLUMN purchase_bills.bill_kind IS
  'purchase = a normal vendor purchase bill; printing = job-work printing bill for a PO (cotton dhurri etc.), shown under its own Document Entry tab and posted to the ledger as a Printing invoice.';
COMMENT ON COLUMN purchase_bills.size_mode IS
  'area = sq_feet is an area in qty_unit and is normalised to Sq Ft on the sheet; as_billed = the vendor billed a linear length, so the number is shown exactly as entered, in its own unit.';
COMMENT ON COLUMN freight_bills.round_off_amt IS
  'Round-figure adjustment: net payable = gross_total_amt + round_off_amt.';
COMMENT ON COLUMN duty_tax_bills.round_off_amt IS
  'Round-figure adjustment: net payable = gross_total_amt + round_off_amt.';
COMMENT ON COLUMN washing_entries.round_off_amt IS
  'Round-figure adjustment: net payable = amount + round_off_amt.';

COMMIT;

-- Verify:
SELECT table_name, column_name, column_default
FROM information_schema.columns
WHERE (table_name = 'purchase_bills' AND column_name IN ('bill_kind', 'size_mode'))
   OR (table_name IN ('freight_bills', 'duty_tax_bills', 'washing_entries') AND column_name = 'round_off_amt')
ORDER BY table_name, column_name;
