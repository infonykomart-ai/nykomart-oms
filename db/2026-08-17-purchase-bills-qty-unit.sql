-- 2026-08-17 — Purchase Bill rate-per-unit fix.
--
-- "JAB ENTRY HOYEGI TO JESE TOTAL SQ FT JO AARA HAI VO 524.20 MTR KA AARA
-- HAI AB JO ISKI RATE AAYEGI VO BHI TO PER MTR AAYEGI, AGAR FT ME HOYEGI TO
-- PER FT HOYEGI" — real bug found live: the FT/MTR/INCH/YARD/CM unit
-- picker added earlier today (src/lib/length-units.ts) always converted
-- the entered quantity to FEET before saving, then multiplied that
-- feet-equivalent by Unit Rate. But the rate a vendor quotes is always per
-- whatever unit THEY billed in — e.g. Aaradhya Fabrics' AF/145 bill is
-- 524.20 MTR at ₹21.03/MTR. Converting 524.20 MTR -> 1719.82 Sq. Feet
-- first and THEN multiplying by 21.03 inflates the total by the MTR->FT
-- conversion factor (~3.28x) — a real financial error, not cosmetic.
--
-- Fix: `sq_feet` now stores the quantity AS ENTERED (whatever unit was
-- picked), and this new `qty_unit` column records which unit that is —
-- so total_amount (qty * sq_feet * unit_rate, unchanged generated-column
-- formula) is correct again regardless of unit, since rate and quantity
-- are now in the same unit. Every existing row implicitly stays 'FT'
-- (the only unit that existed before today's feature), so the default
-- and backfill both are 'FT' — no historical values change meaning.
--
-- NOT applied to stock_in/stock_out/material_out_chalans — those have no
-- rate field at all (pure quantity movements), and converting everything
-- there to a single common unit (feet) is intentional so the running
-- stock-item balance stays comparable across mixed-unit entries. This fix
-- is specific to purchase_bills, the only place a RATE gets multiplied
-- against this quantity.

BEGIN;

ALTER TABLE purchase_bills
  ADD COLUMN qty_unit text NOT NULL DEFAULT 'FT'
    CHECK (qty_unit IN ('FT', 'MTR', 'INCH', 'YARD', 'CM'));

COMMIT;

-- Verify:
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'purchase_bills' AND column_name = 'qty_unit';
