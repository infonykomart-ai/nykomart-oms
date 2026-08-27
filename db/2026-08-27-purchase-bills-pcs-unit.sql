-- 2026-08-27 — Purchase Bill: add PCS (piece count) as a qty_unit.
--
-- "EK PURCHASE SECTION ME OPTION YE BHI KARNA HAI KI AGAR PURCHASE PCS ME
-- KIYA JATA HAI TO US PCS KI RATE KYA HOGI" — several vendors bill by piece
-- count with a rate PER PIECE, not by size (e.g. Shivam Enterprises'
-- garment invoices: "shorts chada set — 16 PCS @ Rs.260/pc", no HSN, no
-- length/area at all). purchase_bills.qty_unit today only allows
-- FT/MTR/INCH/YARD/CM (added 2026-08-17 for raw-material-by-length vendors,
-- see db/2026-08-17-purchase-bills-qty-unit.sql) — this adds 'PCS' as a
-- 6th allowed value alongside those, same column, no new column needed.
--
-- How PCS mode prices correctly with the EXISTING generated-column formula
-- (total_amount = qty * sq_feet * unit_rate, unchanged): the app now sends
-- sq_feet = 1 whenever qty_unit = 'PCS', so total_amount collapses to
-- qty * 1 * unit_rate = qty * rate-per-piece — exactly what a PCS bill
-- needs, with zero schema/formula changes. Verified against a real vendor
-- bill line (Shivam Enterprises INV/26-27/515: 16 PCS @ Rs.260, 5% GST) on
-- a local scratch Postgres loaded from this repo's own schema.sql before
-- writing this file:
--   qty=16, sq_feet=1, qty_unit='PCS', unit_rate=260, gst_rate_pct=2.5
--   -> total_amount 4160.00, g_total_plus_gst 4368.00
-- both match the vendor's own printed invoice (Amount 4,368, incl. Tax 208)
-- exactly.

BEGIN;

ALTER TABLE purchase_bills
  DROP CONSTRAINT purchase_bills_qty_unit_check;

ALTER TABLE purchase_bills
  ADD CONSTRAINT purchase_bills_qty_unit_check
    CHECK (qty_unit IN ('FT', 'MTR', 'INCH', 'YARD', 'CM', 'PCS'));

COMMIT;

-- Verify:
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'purchase_bills'::regclass AND conname = 'purchase_bills_qty_unit_check';
