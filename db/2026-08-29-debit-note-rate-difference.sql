-- 2026-08-29 — Debit Note "rate difference" calculator support.
--
-- User's real scenario (verbatim, Hindi): "20 pcs liye 260 ki rate se lekin
-- usne 270 ki rate se lagaya hai to matlab 1 pcs par 10 rupes+gst jyada liya
-- hai" — bought 20 pcs at an agreed/PO rate of 260, vendor billed at 270,
-- i.e. overcharged Rs 10/pc + GST. Confirmed this specific case (Qty 20,
-- Debit Amount 200, CGST/SGST 5 each, Total 210) was ALREADY being entered
-- correctly by hand — this migration just adds the two reference columns
-- that let the app form auto-compute that 200 instead of the user having to
-- do the (270-260)*20 math themselves every time, and let the printed
-- report show the rate breakup instead of a bare unexplained amount.
--
-- Both columns are nullable, purely informational — debit_amount itself
-- stays a plain manually-set column (unchanged), since not every Debit Note
-- is a rate-difference case (some are flat charges with no per-unit rate).
-- Idempotent (IF NOT EXISTS) — safe to run even if partially applied.

ALTER TABLE debit_notes
  ADD COLUMN IF NOT EXISTS po_rate     numeric(14,2),
  ADD COLUMN IF NOT EXISTS billed_rate numeric(14,2);

COMMENT ON COLUMN debit_notes.po_rate IS
  'Agreed / PO rate per unit — reference only, used by the app to auto-compute debit_amount as (billed_rate - po_rate) * qty. Not used in any generated column.';
COMMENT ON COLUMN debit_notes.billed_rate IS
  'Rate the vendor actually billed/charged per unit — reference only, same purpose as po_rate.';
