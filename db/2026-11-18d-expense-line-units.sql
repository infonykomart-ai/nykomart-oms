-- 2026-11-18d — EXPENSE VOUCHER LINES: A REAL UNIT AND ITS BASE QUANTITY.
--
-- "KG QTY MTR SQ FT INCH SABHI SAHI SE KAAM KARE" — until now an expense
-- voucher line stored whatever unit text was typed (`unit`), so 10 MTR and
-- 32.808 FT could never be added up, and an SQ FT line had nowhere to record
-- the size that produced its area.
--
-- Two columns finish the picture. The unit itself already lives in `unit` and
-- the rate is already per that same unit (`rate`, gross = qty × rate); these
-- two make every line COMPARABLE:
--
--   base_qty   the same quantity in the family's base unit — weight → KG,
--              length → FT, area → SQ FT, count → PCS (src/lib/accounts/
--              line-units.ts, exact OMS measurement constants)
--   base_unit  that base unit, so a report never has to re-derive it
--
-- Additive and idempotent: nothing existing is rewritten, no default is
-- guessed, and old lines keep base_qty = NULL (posting derives the base
-- quantity from qty + unit for those — see src/lib/accounts/post.ts).
--
-- AFTER THIS: save an expense voucher with a unit of 10 MTR @ ₹50 and the row
-- carries qty 10, unit MTR, rate 50, gross 500, base_qty 32.808, base_unit FT.

ALTER TABLE IF EXISTS expense_voucher_items
  ADD COLUMN IF NOT EXISTS base_qty  numeric(18,3),
  ADD COLUMN IF NOT EXISTS base_unit text;

COMMENT ON COLUMN expense_voucher_items.base_qty IS
  'Line quantity in base_unit (KG for weight, FT for length, SQ FT for area, PCS for count). Derived from qty + unit by src/lib/accounts/line-units.ts; NULL on lines saved before 2026-11-18d.';
COMMENT ON COLUMN expense_voucher_items.base_unit IS
  'Base unit of base_qty: KG | FT | SQ FT | PCS. The bill''s own unit stays in `unit`, and `rate` is always per `unit`.';
