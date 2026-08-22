-- 2026-08-17 — fix for a duplicate-insert found while verifying "DONE":
-- db/2026-08-17-payment-import-nyko.sql and db/2026-08-17-payment-import-
-- rugara.sql got run TWICE against production, so every payment row from
-- that import (bill_pass_register_payments where remark mentions
-- "Imported from NYKO-PNB" / "Imported from RUGARA-PNB") exists as an
-- exact duplicate pair. Confirmed via Supabase SQL Editor before writing
-- this: 674 total matching rows, 337 distinct, every group has EXACTLY
-- count=2 (no triples, no partial dupes) — a clean double-run, not a data
-- problem with the import itself.
--
-- Does NOT affect total_paid / balance_due on any bill — that recompute
-- step was intentionally removed from the import (see this file's sibling
-- delivery note: total_paid is never touched by this import, only the
-- itemized payments ledger), and there's no DB trigger that derives
-- total_paid from this table either (checked pg_trigger — none exist). So
-- this is purely an audit-trail duplication, not a financial-figure bug —
-- still needs cleaning up before it's trusted as an accurate ledger.
--
-- Keeps exactly one row per (bill_pass_register_id, amount, payment_date,
-- remark, payment_mode) — the lowest id in each duplicate pair — and
-- deletes the rest. Verified via a read-only dry-run SELECT in Supabase
-- SQL Editor that this identifies exactly 337 rows (674 - 337 = the
-- correct original count), matching the payment-import script's own
-- reported totals (283 Nyko + 59 Rugara → minus 5 rows whose target bill
-- didn't match on either run = 337).

BEGIN;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY bill_pass_register_id, amount, payment_date, remark, payment_mode
           ORDER BY id
         ) AS rn
  FROM bill_pass_register_payments
  WHERE remark LIKE '%Imported from NYKO-PNB%' OR remark LIKE '%Imported from RUGARA-PNB%'
)
DELETE FROM bill_pass_register_payments
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

COMMIT;

-- Verify after running (should return 674 total_after_dedupe... wait, should
-- return 337 for both total_rows and distinct_rows):
-- SELECT count(*) AS total_rows,
--        count(DISTINCT (bill_pass_register_id, amount, payment_date, remark)) AS distinct_rows
-- FROM bill_pass_register_payments
-- WHERE remark LIKE '%Imported from NYKO-PNB%' OR remark LIKE '%Imported from RUGARA-PNB%';
