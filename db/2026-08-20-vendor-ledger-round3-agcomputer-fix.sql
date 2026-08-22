-- 2026-08-20 (follow-up to round 3) — fix A G Computer AG/26-27/21's
-- total_paid, which the round-3 migration accidentally reduced instead of
-- completing.
--
-- WHAT HAPPENED (found during independent re-verification of round 3 after
-- it was run, cross-checking all 261 rows across the 8 vendor ledger files
-- -- FedEx, UPS, Aramex, Prachi Rugs, Agra Weavers, West Express, A G
-- Computer, AK Enterprises -- against production via an auto-generated
-- VALUES-table diff, not hand-typed, so this is not a transcription slip):
--
-- 1. Historical import (db/2026-08-17-nyko-mart-bill-pass-import.sql) set
--    AG/26-27/21's total_amt = 31500.00 and total_paid = 16500.00 directly
--    as raw column values -- the historical import never created a matching
--    row in bill_pass_register_payments for that 16500 (total_paid is a
--    plain column, not derived from the payments table at import time; see
--    schema.sql's comment on bill_pass_register.total_paid).
-- 2. Round 3 (db/2026-08-20-vendor-ledger-round3-payments.sql) correctly
--    read the vendor file as "fully paid 31500, DB already had 16500 ->
--    insert the remaining 15000" and did insert a 15000.00 payment row.
--    But its blanket sync step --
--      UPDATE bill_pass_register SET total_paid = COALESCE(SUM(amount)
--        FROM bill_pass_register_payments WHERE bill_pass_register_id = ..)
--    -- recomputes total_paid strictly from bill_pass_register_payments.
--    Since the original 16500 had no row there to sum, the UPDATE
--    overwrote total_paid with just the new 15000, silently *dropping*
--    16500 instead of reaching 31500.
-- 3. Verified this is the ONLY such case: the diff was re-run against all
--    12 bill_pass_register_payments rows round 3 touched, and against all
--    261 file rows across all 8 vendors -- every other row's "DB had 0"
--    assumption was actually true (0 really was 0, no payments table row
--    existed to lose), so this UPDATE was safe everywhere except here.
--
-- FIX: insert a payment row for the missing 16500.00, backfilling the
-- historical import's own (undated-at-the-line-item-level) partial payment
-- so total_paid correctly reflects the file's "fully paid" status again.
-- Using the same 2026-07-29 date as both the original invoice_recv_date and
-- round 3's own 15000 payment, since no more specific date exists for the
-- original 16500 portion -- flagging this assumption explicitly rather than
-- inventing a different date.
--
-- Dry-run tested against local scratch Postgres before delivery.

BEGIN;

INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT 'e327ddd1-4eeb-4a9a-addd-dd346cdf91b3', 16500.00, '2026-07-29', 'NEFT',
       'Vendor ledger round 3 follow-up fix (2026-08-20): backfilling the historical import''s original 16500.00 partial payment for AG/26-27/21, which had no bill_pass_register_payments row and was dropped when round 3''s total_paid sync recomputed from payments only. See db/2026-08-20-vendor-ledger-round3-agcomputer-fix.sql for full explanation.'
WHERE NOT EXISTS (
  SELECT 1 FROM bill_pass_register_payments
  WHERE bill_pass_register_id = 'e327ddd1-4eeb-4a9a-addd-dd346cdf91b3' AND amount = 16500.00 AND payment_date = '2026-07-29'
);

UPDATE bill_pass_register
SET total_paid = COALESCE((SELECT SUM(amount) FROM bill_pass_register_payments WHERE bill_pass_register_id = 'e327ddd1-4eeb-4a9a-addd-dd346cdf91b3'), 0)
WHERE id = 'e327ddd1-4eeb-4a9a-addd-dd346cdf91b3';

COMMIT;

-- Verification (run after commit):
-- select invoice_no, total_amt, total_paid, balance_due from bill_pass_register where invoice_no = 'AG/26-27/21';
--   -- expect total_paid = 31500.00, balance_due = 0.00
