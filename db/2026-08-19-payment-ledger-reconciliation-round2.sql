-- 2026-08-19 — Round 2 bank-ledger reconciliation, from the updated
-- NYKOMART_PAYMNETS.xlsx (NYKO-PNB / RUGARA-PNB sheets, "AGAINST BILL" rows
-- only) uploaded 2026-08-19, matched against current bill_pass_register.
--
-- Two kinds of fix in this file:
--
-- Section 1 — a real bug found while re-verifying the 2026-08-17 payment
-- import (db/2026-08-17-payment-import-nyko.sql): that file's Step 1 tried
-- to match "PRACHI RUGS" (bank sheet's spelling), but the party master's
-- actual row is "M/S. Prachi Rugs" — a different string, not just a case
-- difference. `WHERE p.name = 'PRACHI RUGS'` matched zero parties, so the
-- INSERT ... SELECT silently inserted 0 rows for all 3 Prachi Rugs
-- invoices in that file (P-41, P-42, P-44) and the matching Step 2 payment
-- backfill (resolved by invoice_no against a bill row that was never
-- created) also silently no-opped. Confirmed live via Supabase SQL editor
-- 2026-08-19: none of P-41/P-42/P-44 exist in bill_pass_register today,
-- while every other party in that file (Aramex, UPS — whose names matched
-- case-insensitively but not letter-for-letter differently) landed fine.
-- Re-running here with the correct party name.
--
-- Section 1 uses the same NOT EXISTS guard as the 2026-08-17 file so this
-- is safe to run even if some of it has already landed.
--
-- NOT included here (left for the user, see the round's project doc):
--  - AG/26-27/7 (bank ledger says UPS, 23,400.00, 2026-05-16) and
--    SHIVAM/26-27/7821 (bank ledger says Shivam Enterprises, 17,448.00,
--    2026-07-16) both looked like new invoices at first, but checking
--    before writing this file found they ALREADY EXIST in
--    bill_pass_register at the exact same amounts — just attached to
--    "A G Computer" and "Shivam Export Fabrics" respectively (both real,
--    separate parties from "UPS"/"Shivam Enterprises"), via the 2026-08-17
--    Master Bill Pass File import. Same invoice number, same amount, same
--    date — almost certainly the same real bill, but it's not possible to
--    tell from here whether the bank ledger's party label or the Master
--    Bill Pass File's party label is the correct one. Not touched either
--    way; flagged for the user to confirm which party actually issued it.
--  - On Point Express: bank SR 8 shows one NEFT of 62,460 covering TWO
--    invoice refs together ("R2526J2177, R2526J2644") but R2526J2644 alone
--    is already on file at 10,460.70 — can't tell how the other 51,999.30
--    splits without the original invoice, so R2526J2177 is not created.
--  - On Point Express R2526J4826: bank shows 5,053.00 paid (2 installments)
--    against a bill on file for 4,738.00 — 315.00 more than the recorded
--    invoice amount. Flagged, not auto-corrected.
--  - RUKHSAR BANO / RUKSAR BANO, SHARDA INTERNATIONAL RUGS / SHARDA RUGS,
--    NEW KR PRITINGS / New KR Printer, VEERA JK / Veera Industries,
--    RK WASH / R.K. Stone Wash, BUY PACKING & MATERIAL / Shree Shyam
--    Packing — bank-sheet party names that are CLOSE to but not exactly an
--    existing party master name. Could be the same vendor spelled
--    differently, or a different vendor entirely — needs the user to
--    confirm before any bill is attached to the wrong party.
--  - ASHIK ALI (5 invoices, ~2,24,155.60 total) — no matching party at all
--    in the party master. Needs a decision: create as a new party, or is
--    this an existing party under another name?
--  - OFFICE EXP. / RD ONE CARD PAYMENT / AJAY CARD PAYMENT — these are
--    internal expense/credit-card categories in the bank sheet, not
--    vendor bills, so deliberately excluded from bill_pass_register
--    (consistent with how "INTERNAL EXP." rows have always been treated).

BEGIN;

-- ===== Section 1: Prachi Rugs — re-run with the correct party name =====

INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_date, invoice_recv_date, total_amt, total_paid, party_type, remark)
SELECT c.id, p.id, 'P-41', '2025-10-31', '2025-10-31', 27495.0, 27495.0, 'Purchase', 'Imported from NYKO-PNB bank ledger (SR 9) — corrected re-run 2026-08-19, see 2026-08-17-payment-import-nyko.sql party-name bug note above.'
FROM companies c, parties p
WHERE c.name = 'Nyko Mart' AND p.name = 'M/S. Prachi Rugs'
AND NOT EXISTS (
  SELECT 1 FROM bill_pass_register b2 JOIN companies c2 ON c2.id=b2.company_id
  WHERE c2.name = 'Nyko Mart' AND (b2.invoice_no = 'P-41' OR b2.vendor_invoice_no = 'P-41')
);

INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_date, invoice_recv_date, total_amt, total_paid, party_type, remark)
SELECT c.id, p.id, 'P-42', '2025-05-11', '2025-05-11', 33547.0, 33547.0, 'Purchase', 'Imported from NYKO-PNB bank ledger (SR 31) — corrected re-run 2026-08-19, see 2026-08-17-payment-import-nyko.sql party-name bug note above.'
FROM companies c, parties p
WHERE c.name = 'Nyko Mart' AND p.name = 'M/S. Prachi Rugs'
AND NOT EXISTS (
  SELECT 1 FROM bill_pass_register b2 JOIN companies c2 ON c2.id=b2.company_id
  WHERE c2.name = 'Nyko Mart' AND (b2.invoice_no = 'P-42' OR b2.vendor_invoice_no = 'P-42')
);

INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_date, invoice_recv_date, total_amt, total_paid, party_type, remark)
SELECT c.id, p.id, 'P-44', '2025-01-11', '2025-01-11', 14993.0, 14993.0, 'Purchase', 'Imported from NYKO-PNB bank ledger (SR 17) — corrected re-run 2026-08-19, see 2026-08-17-payment-import-nyko.sql party-name bug note above.'
FROM companies c, parties p
WHERE c.name = 'Nyko Mart' AND p.name = 'M/S. Prachi Rugs'
AND NOT EXISTS (
  SELECT 1 FROM bill_pass_register b2 JOIN companies c2 ON c2.id=b2.company_id
  WHERE c2.name = 'Nyko Mart' AND (b2.invoice_no = 'P-44' OR b2.vendor_invoice_no = 'P-44')
);

-- Matching audit-trail payment rows (Step 1's bills were never created, so
-- the corresponding Step 2 payment inserts in the 2026-08-17 file also
-- silently matched 0 rows — re-run here now that the bills above exist).
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 27495.0, '2025-10-31', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 9, corrected re-run 2026-08-19]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-41' OR b.vendor_invoice_no = 'P-41')
AND NOT EXISTS (SELECT 1 FROM bill_pass_register_payments bp WHERE bp.bill_pass_register_id = b.id)
LIMIT 1;

INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 33547.0, '2025-05-11', 'NEFT', 'INVOICE - P-42 [Imported from NYKO-PNB SR 31, corrected re-run 2026-08-19]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-42' OR b.vendor_invoice_no = 'P-42')
AND NOT EXISTS (SELECT 1 FROM bill_pass_register_payments bp WHERE bp.bill_pass_register_id = b.id)
LIMIT 1;

INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 14993.0, '2025-01-11', 'NEFT', 'P-44, INVOICE [Imported from NYKO-PNB SR 17, corrected re-run 2026-08-19]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-44' OR b.vendor_invoice_no = 'P-44')
AND NOT EXISTS (SELECT 1 FROM bill_pass_register_payments bp WHERE bp.bill_pass_register_id = b.id)
LIMIT 1;

COMMIT;
