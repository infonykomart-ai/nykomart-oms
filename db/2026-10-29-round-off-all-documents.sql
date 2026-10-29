-- 2026-10-29 — ROUND OFF IN EVERY SECTION, single entry AND multiple entry.
--
-- "har section me jaha invoice payment bills jaha par bhi ho chahe multiple
--  entry ho chahe single entry ho round off ka option ho or roundoff karne
--  par sabhi jagh par reflect ho jaye."
--
-- Purchase / Printing / Courier (Freight) / Duty & Tax / Washing already had
-- round_off_amt (db/2026-08-17-purchase-bills-round-off.sql and
-- db/2026-10-24b-round-figure-printing-bill-and-size-mode.sql). The four
-- document types below did not, so a Credit Note, Debit Note, Internal
-- Invoice or Journal Voucher could never land on the exact paisa figure the
-- other side quoted. Each now carries the same signed adjustment:
--
--   net payable = pre-round-off amount + round_off_amt
--
-- WHERE the net lives differs per table (and every screen reads that column,
-- so the round-off is automatically reflected in the list, the A4 sheet, the
-- report, the register and the Finance ledger):
--
--   debit_notes.total_amount        generated column — formula recreated below
--                                   to add round_off_amt (debit_amount stays
--                                   the pre-GST base, so 5% GST is applied to
--                                   the agreed amount, not to the rounding).
--   internal_invoices.total_amount  generated column — formula recreated below
--                                   to add round_off_amt (18% GST still applies
--                                   to qty × rate only).
--   credit_notes.refund_amount      plain column, no generated total to extend
--                                   — the app stores the ROUNDED net in
--                                   refund_amount and keeps round_off_amt as
--                                   the recorded adjustment (edit form
--                                   subtracts it back out).
--   journal_vouchers.debit_amount   same approach as credit_notes.
--
-- The purchase-bill MULTI forms (Multiple Orders / Multiple Items, one
-- invoice) now also offer a round-off; the app stores the whole invoice-level
-- adjustment on the FIRST row of the invoice group, because every screen sums
-- the group's grand totals (see src/lib/bill-grouping.ts) — so the invoice
-- total is rounded once, never once per row.
--
-- Safe to run more than once.
--
-- If this patch is NOT run: the app still works — the new controls save 0
-- and nothing changes, except that the round-off column itself would be
-- reported as a missing schema piece by the migration probes.

BEGIN;

ALTER TABLE credit_notes
  ADD COLUMN IF NOT EXISTS round_off_amt numeric(8,2) NOT NULL DEFAULT 0
    CHECK (round_off_amt >= -1000 AND round_off_amt <= 1000);

ALTER TABLE debit_notes
  ADD COLUMN IF NOT EXISTS round_off_amt numeric(8,2) NOT NULL DEFAULT 0
    CHECK (round_off_amt >= -1000 AND round_off_amt <= 1000);

ALTER TABLE internal_invoices
  ADD COLUMN IF NOT EXISTS round_off_amt numeric(8,2) NOT NULL DEFAULT 0
    CHECK (round_off_amt >= -1000 AND round_off_amt <= 1000);

ALTER TABLE journal_vouchers
  ADD COLUMN IF NOT EXISTS round_off_amt numeric(8,2) NOT NULL DEFAULT 0
    CHECK (round_off_amt >= -1000 AND round_off_amt <= 1000);

COMMENT ON COLUMN credit_notes.round_off_amt IS
  'Round-figure adjustment already included in refund_amount: pre-round-off refund = refund_amount - round_off_amt.';
COMMENT ON COLUMN debit_notes.round_off_amt IS
  'Round-figure adjustment: total_amount = debit_amount * 1.05 + round_off_amt.';
COMMENT ON COLUMN internal_invoices.round_off_amt IS
  'Round-figure adjustment: total_amount = qty * rate * 1.18 + round_off_amt.';
COMMENT ON COLUMN journal_vouchers.round_off_amt IS
  'Round-figure adjustment already included in debit_amount: pre-round-off debit = debit_amount - round_off_amt.';

-- Generated columns have to be dropped and re-added to change their formula.
-- Neither total_amount is referenced by a view or index (checked against
-- db/schema.sql), so no dependent object needs recreating.
ALTER TABLE debit_notes DROP COLUMN IF EXISTS total_amount;
ALTER TABLE debit_notes
  ADD COLUMN total_amount numeric(14,2) GENERATED ALWAYS AS (debit_amount * 1.05 + round_off_amt) STORED;

ALTER TABLE internal_invoices DROP COLUMN IF EXISTS total_amount;
ALTER TABLE internal_invoices
  ADD COLUMN total_amount numeric(14,2) GENERATED ALWAYS AS (qty * rate * 1.18 + round_off_amt) STORED;

COMMIT;

-- Verify:
SELECT table_name, column_name, column_default
FROM information_schema.columns
WHERE table_name IN ('credit_notes', 'debit_notes', 'internal_invoices', 'journal_vouchers')
  AND column_name = 'round_off_amt'
ORDER BY table_name;
