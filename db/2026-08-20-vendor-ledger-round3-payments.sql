-- 2026-08-20 — Vendor ledger reconciliation round 3: payments + 2 data-quality
-- fixes that were unambiguous and user-confirmed (see
-- claude/vendor-ledger-reconciliation-round3-2026-08-20.md for the full
-- findings writeup across all 8 vendor files compared this round).
--
-- FedEx (7 bills) + Aramex (1 bill) that were missing from bill_pass_register
-- last round are now included below (Part 4) — user confirmed by name which
-- company each belongs to: all 8 -> Nyko Mart.
--
-- RJ2425004810 (Aramex) — flagged last round as a "duplicate payment bug" by
-- analogy to the Shivam Enterprises fix, but investigating its own payment
-- remarks showed it is NOT a data-entry bug: it has two genuinely different
-- NEFT payments (different reference numbers, 6 months apart) and the second
-- one's remark already reads "Second NEFT sent against this same invoice ...
-- excess/duplicate payment" — i.e. someone already identified in real life
-- that Aramex was paid twice by mistake and documented it. Both payments are
-- real bank transactions; deleting either would misrepresent history. User
-- decision: leave the negative balance_due (~ -46,862.83) as-is, standing as
-- a credit to net against a future Aramex bill. No SQL change needed for
-- this one — nothing to do here, noted for the record only.
--
-- Part 1 — payments the vendor file says were made, but bill_pass_register
-- shows no payment recorded (or a partial payment) for. All amounts/dates
-- taken directly from the vendor Excel files' own "PAYMNET BY AJAY JI"
-- remark column (e.g. "PAID-13-AUG-2026").
--
-- Dry-run tested against the local scratch Postgres before delivery.

BEGIN;

-- A G Computer — AG/26-27/21: total_amt 31500.00, already had 16500.00
-- recorded (partial); file says fully paid 29-Jul-2026 -> remaining 15000.00.
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT 'e327ddd1-4eeb-4a9a-addd-dd346cdf91b3', 15000.00, '2026-07-29', 'NEFT',
       'Vendor ledger round 3 (2026-08-20): remaining balance per A G Computer file, invoice AG/26-27/21.'
WHERE NOT EXISTS (
  SELECT 1 FROM bill_pass_register_payments
  WHERE bill_pass_register_id = 'e327ddd1-4eeb-4a9a-addd-dd346cdf91b3' AND amount = 15000.00 AND payment_date = '2026-07-29'
);

-- A G Computer — AG/26-27/25: 14150.00, file says fully paid 14-Aug-2026, DB had 0.
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT '808a75b4-356c-4b79-bf7c-85e4d232c350', 14150.00, '2026-08-14', 'NEFT',
       'Vendor ledger round 3 (2026-08-20): per A G Computer file, invoice AG/26-27/25.'
WHERE NOT EXISTS (
  SELECT 1 FROM bill_pass_register_payments
  WHERE bill_pass_register_id = '808a75b4-356c-4b79-bf7c-85e4d232c350' AND amount = 14150.00 AND payment_date = '2026-08-14'
);

-- AK Enterprises — AK/26-27/33: 147856.00, file says fully paid 13-Aug-2026, DB had 0.
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT '1910886d-1289-4317-8245-b9ff3d609bed', 147856.00, '2026-08-13', 'NEFT',
       'Vendor ledger round 3 (2026-08-20): per AK Enterprises file, invoice AK/26-27/33.'
WHERE NOT EXISTS (
  SELECT 1 FROM bill_pass_register_payments
  WHERE bill_pass_register_id = '1910886d-1289-4317-8245-b9ff3d609bed' AND amount = 147856.00 AND payment_date = '2026-08-13'
);

-- M/S. Prachi Rugs — P/26-27/36, /37, /38: file says all 3 fully paid
-- 13-Aug-2026 (one had a "2026" typo'd as "206" in the file's remark), DB had 0 for each.
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT '53983261-ca42-4646-945f-b70a2f911036', 28379.00, '2026-08-13', 'NEFT',
       'Vendor ledger round 3 (2026-08-20): per Prachi Rugs file, invoice P/26-27/36.'
WHERE NOT EXISTS (
  SELECT 1 FROM bill_pass_register_payments
  WHERE bill_pass_register_id = '53983261-ca42-4646-945f-b70a2f911036' AND amount = 28379.00 AND payment_date = '2026-08-13'
);

INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT 'ec4a1f33-32d9-4d41-bc53-61aa360b5587', 30388.00, '2026-08-13', 'NEFT',
       'Vendor ledger round 3 (2026-08-20): per Prachi Rugs file, invoice P/26-27/37.'
WHERE NOT EXISTS (
  SELECT 1 FROM bill_pass_register_payments
  WHERE bill_pass_register_id = 'ec4a1f33-32d9-4d41-bc53-61aa360b5587' AND amount = 30388.00 AND payment_date = '2026-08-13'
);

INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT 'c1dcacec-85ba-4d50-a472-920e252b69e3', 20784.00, '2026-08-13', 'NEFT',
       'Vendor ledger round 3 (2026-08-20): per Prachi Rugs file, invoice P/26-27/38.'
WHERE NOT EXISTS (
  SELECT 1 FROM bill_pass_register_payments
  WHERE bill_pass_register_id = 'c1dcacec-85ba-4d50-a472-920e252b69e3' AND amount = 20784.00 AND payment_date = '2026-08-13'
);

-- FedEx — 276431189: 18692.50, file says fully paid 14-Aug-2026, DB had 0.
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT '3b845cc9-6b39-43b6-a5ee-90d3d373fefb', 18692.50, '2026-08-14', 'NEFT',
       'Vendor ledger round 3 (2026-08-20): per FedEx file, invoice 276431189.'
WHERE NOT EXISTS (
  SELECT 1 FROM bill_pass_register_payments
  WHERE bill_pass_register_id = '3b845cc9-6b39-43b6-a5ee-90d3d373fefb' AND amount = 18692.50 AND payment_date = '2026-08-14'
);

-- UPS — 5 invoices, file says all fully paid "aug 18, 2026", DB had 0 for each.
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT '23635821-74bd-4dd2-b86e-4f6b4ae28a39', 11176.52, '2026-08-18', 'NEFT',
       'Vendor ledger round 3 (2026-08-20): per UPS file, invoice 108500039591.'
WHERE NOT EXISTS (
  SELECT 1 FROM bill_pass_register_payments
  WHERE bill_pass_register_id = '23635821-74bd-4dd2-b86e-4f6b4ae28a39' AND amount = 11176.52 AND payment_date = '2026-08-18'
);

INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT 'f23eb113-c3d4-46d7-a16a-58f17c201205', 6150.59, '2026-08-18', 'NEFT',
       'Vendor ledger round 3 (2026-08-20): per UPS file, invoice 108500039712.'
WHERE NOT EXISTS (
  SELECT 1 FROM bill_pass_register_payments
  WHERE bill_pass_register_id = 'f23eb113-c3d4-46d7-a16a-58f17c201205' AND amount = 6150.59 AND payment_date = '2026-08-18'
);

INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT '082860f9-d887-4370-8f7d-90b04905c0a6', 5296.50, '2026-08-18', 'NEFT',
       'Vendor ledger round 3 (2026-08-20): per UPS file, invoice 108500039834.'
WHERE NOT EXISTS (
  SELECT 1 FROM bill_pass_register_payments
  WHERE bill_pass_register_id = '082860f9-d887-4370-8f7d-90b04905c0a6' AND amount = 5296.50 AND payment_date = '2026-08-18'
);

INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT '2ab0cdd7-4331-4c2b-9497-4d9411b960a4', 5833.20, '2026-08-18', 'NEFT',
       'Vendor ledger round 3 (2026-08-20): per UPS file, invoice 108500039966.'
WHERE NOT EXISTS (
  SELECT 1 FROM bill_pass_register_payments
  WHERE bill_pass_register_id = '2ab0cdd7-4331-4c2b-9497-4d9411b960a4' AND amount = 5833.20 AND payment_date = '2026-08-18'
);

INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT '6a864366-588a-4723-a7ed-e9a86dd691fd', 7225.63, '2026-08-18', 'NEFT',
       'Vendor ledger round 3 (2026-08-20): per UPS file, invoice 108500040090.'
WHERE NOT EXISTS (
  SELECT 1 FROM bill_pass_register_payments
  WHERE bill_pass_register_id = '6a864366-588a-4723-a7ed-e9a86dd691fd' AND amount = 7225.63 AND payment_date = '2026-08-18'
);

-- Sync total_paid on every bill touched above (no DB trigger keeps this in
-- sync — same manual-sync pattern used in
-- db/2026-08-20-reconciliation-decisions.sql and the 2026-08-19 Shivam fix).
UPDATE bill_pass_register bpr
SET total_paid = COALESCE((SELECT SUM(amount) FROM bill_pass_register_payments WHERE bill_pass_register_id = bpr.id), 0)
WHERE bpr.id IN (
  'e327ddd1-4eeb-4a9a-addd-dd346cdf91b3', '808a75b4-356c-4b79-bf7c-85e4d232c350',
  '1910886d-1289-4317-8245-b9ff3d609bed',
  '53983261-ca42-4646-945f-b70a2f911036', 'ec4a1f33-32d9-4d41-bc53-61aa360b5587', 'c1dcacec-85ba-4d50-a472-920e252b69e3',
  '3b845cc9-6b39-43b6-a5ee-90d3d373fefb',
  '23635821-74bd-4dd2-b86e-4f6b4ae28a39', 'f23eb113-c3d4-46d7-a16a-58f17c201205', '082860f9-d887-4370-8f7d-90b04905c0a6',
  '2ab0cdd7-4331-4c2b-9497-4d9411b960a4', '6a864366-588a-4723-a7ed-e9a86dd691fd'
);

-- Part 2 — data-quality fixes on existing rows (both user-confirmed).

-- AK-015: file's invoice date was the malformed string '7-Fab-2026' (typo
-- for "7-Feb-2026"), which never parsed on import -> invoice_date is NULL
-- in DB today. Amount (10022.25) and fully-paid status already match, so
-- this is just the date.
UPDATE bill_pass_register
SET invoice_date = '2026-02-07'
WHERE invoice_no = 'AK-015' AND invoice_date IS NULL AND total_amt = 10022.25;

-- Aramex RJ2625901709: invoice_no is NULL in DB (row otherwise matches this
-- invoice exactly by amount, 658.42) and invoice_date is 2026-07-08 in DB
-- vs 2026-06-07 in the vendor file. Setting both from the file.
UPDATE bill_pass_register
SET invoice_no = 'RJ2625901709', invoice_date = '2026-06-07'
WHERE id = 'f0e664f1-b1ec-442c-83f0-45f8faab67fc' AND invoice_no IS NULL AND total_amt = 658.42;

-- Part 3 — import the one missing bill with an unambiguous company:
-- AK/26-27/38, AK Enterprises. AK Enterprises' bills are 100% (12/12) on
-- Nyko Mart historically, so this is a safe default (unlike FedEx's mixed
-- Nyko Mart/Rugara split or Aramex's 26/1 split, both left for the user).
-- Still unpaid per the file itself (paid=0) -- total_paid left at its
-- column default (0), no payment row needed.
INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_type, invoice_date, total_amt)
SELECT 'd1b13f6d-10ad-4997-b38b-143b042c0aa6', '7923a0ed-48e1-40f8-ae01-50545a879d62', 'AK/26-27/38', 'Purchase', '2026-08-16', 144732.00
WHERE NOT EXISTS (SELECT 1 FROM bill_pass_register WHERE invoice_no = 'AK/26-27/38');

-- Part 4 — the 7 missing FedEx bills + 1 missing Aramex bill flagged last
-- round. User confirmed (2026-08-20): all 8 -> Nyko Mart. invoice_type and
-- amounts taken directly from each vendor's Excel file; all show paid=0
-- (fully unpaid) in the file, so total_paid is left at its column default
-- (0) and no bill_pass_register_payments rows are needed. The Aramex
-- invoice is fully offset by its own credit note (credit_note_amt =
-- total_amt), so balance_due nets to 0 via the generated column.
INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_type, invoice_date, total_amt)
SELECT 'd1b13f6d-10ad-4997-b38b-143b042c0aa6', (SELECT id FROM parties WHERE name = 'FedEx'), '276432162', 'FREIGHT INVOICE', '2026-08-03', 180668.20
WHERE NOT EXISTS (SELECT 1 FROM bill_pass_register WHERE invoice_no = '276432162');

INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_type, invoice_date, total_amt)
SELECT 'd1b13f6d-10ad-4997-b38b-143b042c0aa6', (SELECT id FROM parties WHERE name = 'FedEx'), '276433494', 'DUTY TAX', '2026-08-10', 4746.20
WHERE NOT EXISTS (SELECT 1 FROM bill_pass_register WHERE invoice_no = '276433494');

INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_type, invoice_date, total_amt)
SELECT 'd1b13f6d-10ad-4997-b38b-143b042c0aa6', (SELECT id FROM parties WHERE name = 'FedEx'), '276433571', 'DUTY TAX', '2026-08-11', 17460.60
WHERE NOT EXISTS (SELECT 1 FROM bill_pass_register WHERE invoice_no = '276433571');

INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_type, invoice_date, total_amt)
SELECT 'd1b13f6d-10ad-4997-b38b-143b042c0aa6', (SELECT id FROM parties WHERE name = 'FedEx'), '276433659', 'DUTY TAX', '2026-08-12', 3701.90
WHERE NOT EXISTS (SELECT 1 FROM bill_pass_register WHERE invoice_no = '276433659');

INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_type, invoice_date, total_amt)
SELECT 'd1b13f6d-10ad-4997-b38b-143b042c0aa6', (SELECT id FROM parties WHERE name = 'FedEx'), '276433820', 'DUTY TAX', '2026-08-13', 13846.80
WHERE NOT EXISTS (SELECT 1 FROM bill_pass_register WHERE invoice_no = '276433820');

INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_type, invoice_date, total_amt)
SELECT 'd1b13f6d-10ad-4997-b38b-143b042c0aa6', (SELECT id FROM parties WHERE name = 'FedEx'), '276433901', 'DUTY TAX', '2026-08-14', 2067.00
WHERE NOT EXISTS (SELECT 1 FROM bill_pass_register WHERE invoice_no = '276433901');

INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_type, invoice_date, total_amt)
SELECT 'd1b13f6d-10ad-4997-b38b-143b042c0aa6', (SELECT id FROM parties WHERE name = 'FedEx'), '276434395', 'DUTY TAX', '2026-08-17', 11782.80
WHERE NOT EXISTS (SELECT 1 FROM bill_pass_register WHERE invoice_no = '276434395');

INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_type, invoice_date, total_amt, credit_note_amt, credit_note_date)
SELECT 'd1b13f6d-10ad-4997-b38b-143b042c0aa6', (SELECT id FROM parties WHERE name = 'Aramex'), 'RJ2625902044', 'DUTY TAX', '2026-06-02', 666.28, 666.28, '2026-07-31'
WHERE NOT EXISTS (SELECT 1 FROM bill_pass_register WHERE invoice_no = 'RJ2625902044');

COMMIT;

-- Verification (run after commit):
-- select invoice_no, total_amt, total_paid, balance_due from bill_pass_register
--   where invoice_no in ('AG/26-27/21','AG/26-27/25','AK/26-27/33','P/26-27/36','P/26-27/37','P/26-27/38',
--                         '276431189','108500039591','108500039712','108500039834','108500039966','108500040090',
--                         'AK/26-27/38');
-- select invoice_no, invoice_date from bill_pass_register where invoice_no in ('AK-015','RJ2625901709');
-- select invoice_no, invoice_type, total_amt, credit_note_amt, total_paid, balance_due from bill_pass_register
--   where invoice_no in ('276432162','276433494','276433571','276433659','276433820','276433901','276434395','RJ2625902044');
