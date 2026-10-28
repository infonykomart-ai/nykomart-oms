-- 2026-10-28e — PER-AWB / PER-ORDER ROUND OFF ON COURIER + DUTY BILLS
-- =====================================================================
--
-- User: "jo roundoff value entry ke time hi per order honi chahiye or abhi
-- mene ki hai to vo report me ledger me kahi update nhi hori".
--
-- Until now `round_off_amt` existed only on the bill HEADERS
-- (freight_bills / duty_tax_bills): one signed adjustment for the whole
-- invoice. A courier invoice covers many orders/AWBs though, and in practice
-- the paise are rounded on each AWB's own line (or a couple of AWBs are
-- rounded individually), not once for the invoice. So the round-off is now
-- enterable per AWB at assignment time — exactly like the per-AWB billed
-- charge breakup added 2026-09-21 — and the bill header keeps its own
-- `round_off_amt` for a whole-invoice adjustment.
--
-- Nothing is backfilled: every existing assignment starts at 0, so every
-- bill's payable is unchanged by this file. The bill's payable becomes
--     gross of all AWBs
--   + each AWB's own round_off_amt
--   + the bill header's round_off_amt
--   − credit notes
-- and the "Send to Finance" hand-off starts from that same figure.
--
-- Safe to run more than once (IF NOT EXISTS on both the column and its
-- CHECK-free default; the range guard is a separate ADD CONSTRAINT so a
-- re-run simply skips it).
--
-- Until this file is run the app still works: the assign actions retry
-- without the column (see src/lib/db/missing-column.ts), so bills can still
-- be entered — only the per-AWB round-off itself is not stored yet.

ALTER TABLE freight_bill_awb_assignments
  ADD COLUMN IF NOT EXISTS round_off_amt numeric(8,2) NOT NULL DEFAULT 0;

ALTER TABLE duty_bill_awb_assignments
  ADD COLUMN IF NOT EXISTS round_off_amt numeric(8,2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'freight_bill_awb_assignments_round_off_amt_check'
  ) THEN
    ALTER TABLE freight_bill_awb_assignments
      ADD CONSTRAINT freight_bill_awb_assignments_round_off_amt_check
      CHECK (round_off_amt >= -1000 AND round_off_amt <= 1000);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'duty_bill_awb_assignments_round_off_amt_check'
  ) THEN
    ALTER TABLE duty_bill_awb_assignments
      ADD CONSTRAINT duty_bill_awb_assignments_round_off_amt_check
      CHECK (round_off_amt >= -1000 AND round_off_amt <= 1000);
  END IF;
END $$;

COMMENT ON COLUMN freight_bill_awb_assignments.round_off_amt IS
  '2026-10-28e — signed round-off for THIS AWB/order (+ raises the payable, − lowers it). Bill payable = sum of AWB gross + every AWB round-off + the header round_off_amt − credit notes.';
COMMENT ON COLUMN duty_bill_awb_assignments.round_off_amt IS
  '2026-10-28e — signed round-off for THIS AWB/order (see freight_bill_awb_assignments.round_off_amt).';

-- PostgREST caches the schema; ask it to reload so the new column is usable
-- immediately (harmless if the role lacks NOTIFY — the next reload catches it).
NOTIFY pgrst, 'reload schema';
