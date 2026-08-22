-- Generated from NYKO-PNB — Nyko Mart — clear/unambiguous rows only
BEGIN;

-- Step 1: create 13 new bill_pass_register rows for invoices
-- that don't exist in the system yet (their whole amount is set to the SUM of
-- the bank-confirmed payment(s) found for them — i.e. treated as fully paid,
-- since a bank debit is direct evidence of the real amount actually billed).
INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_date, invoice_recv_date, total_amt, total_paid, party_type, remark)
SELECT c.id, p.id, 'RJ2425004469', '2025-10-31', '2025-10-31', 46644.22, 46644.22, 'Purchase', 'Imported from NYKO-PNB bank ledger (SR 10) — 2026-08-17.'
FROM companies c, parties p
WHERE c.name = 'Nyko Mart' AND p.name = 'ARAMEX'
AND NOT EXISTS (
  SELECT 1 FROM bill_pass_register b2 JOIN companies c2 ON c2.id=b2.company_id
  WHERE c2.name = 'Nyko Mart' AND (b2.invoice_no = 'RJ2425004469' OR b2.vendor_invoice_no = 'RJ2425004469')
);
INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_date, invoice_recv_date, total_amt, total_paid, party_type, remark)
SELECT c.id, p.id, 'RJ2425004631', '2025-03-11', '2025-03-11', 97935.49, 97935.49, 'Purchase', 'Imported from NYKO-PNB bank ledger (SR 26) — 2026-08-17.'
FROM companies c, parties p
WHERE c.name = 'Nyko Mart' AND p.name = 'ARAMEX'
AND NOT EXISTS (
  SELECT 1 FROM bill_pass_register b2 JOIN companies c2 ON c2.id=b2.company_id
  WHERE c2.name = 'Nyko Mart' AND (b2.invoice_no = 'RJ2425004631' OR b2.vendor_invoice_no = 'RJ2425004631')
);
INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_date, invoice_recv_date, total_amt, total_paid, party_type, remark)
SELECT c.id, p.id, 'RJ2425004810', '2025-05-11', '2025-05-11', 46862.83, 46862.83, 'Purchase', 'Imported from NYKO-PNB bank ledger (SR 32) — 2026-08-17.'
FROM companies c, parties p
WHERE c.name = 'Nyko Mart' AND p.name = 'ARAMEX'
AND NOT EXISTS (
  SELECT 1 FROM bill_pass_register b2 JOIN companies c2 ON c2.id=b2.company_id
  WHERE c2.name = 'Nyko Mart' AND (b2.invoice_no = 'RJ2425004810' OR b2.vendor_invoice_no = 'RJ2425004810')
);
INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_date, invoice_recv_date, total_amt, total_paid, party_type, remark)
SELECT c.id, p.id, 'P-41', '2025-10-31', '2025-10-31', 27495.0, 27495.0, 'Purchase', 'Imported from NYKO-PNB bank ledger (SR 9) — 2026-08-17.'
FROM companies c, parties p
WHERE c.name = 'Nyko Mart' AND p.name = 'PRACHI RUGS'
AND NOT EXISTS (
  SELECT 1 FROM bill_pass_register b2 JOIN companies c2 ON c2.id=b2.company_id
  WHERE c2.name = 'Nyko Mart' AND (b2.invoice_no = 'P-41' OR b2.vendor_invoice_no = 'P-41')
);
INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_date, invoice_recv_date, total_amt, total_paid, party_type, remark)
SELECT c.id, p.id, 'P-42', '2025-05-11', '2025-05-11', 33547.0, 33547.0, 'Purchase', 'Imported from NYKO-PNB bank ledger (SR 31) — 2026-08-17.'
FROM companies c, parties p
WHERE c.name = 'Nyko Mart' AND p.name = 'PRACHI RUGS'
AND NOT EXISTS (
  SELECT 1 FROM bill_pass_register b2 JOIN companies c2 ON c2.id=b2.company_id
  WHERE c2.name = 'Nyko Mart' AND (b2.invoice_no = 'P-42' OR b2.vendor_invoice_no = 'P-42')
);
INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_date, invoice_recv_date, total_amt, total_paid, party_type, remark)
SELECT c.id, p.id, 'P-44', '2025-01-11', '2025-01-11', 14993.0, 14993.0, 'Purchase', 'Imported from NYKO-PNB bank ledger (SR 17) — 2026-08-17.'
FROM companies c, parties p
WHERE c.name = 'Nyko Mart' AND p.name = 'PRACHI RUGS'
AND NOT EXISTS (
  SELECT 1 FROM bill_pass_register b2 JOIN companies c2 ON c2.id=b2.company_id
  WHERE c2.name = 'Nyko Mart' AND (b2.invoice_no = 'P-44' OR b2.vendor_invoice_no = 'P-44')
);
INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_date, invoice_recv_date, total_amt, total_paid, party_type, remark)
SELECT c.id, p.id, '108100143679', '2025-10-31', '2025-10-31', 57718.42, 57718.42, 'Purchase', 'Imported from NYKO-PNB bank ledger (SR 13) — 2026-08-17.'
FROM companies c, parties p
WHERE c.name = 'Nyko Mart' AND p.name = 'UPS'
AND NOT EXISTS (
  SELECT 1 FROM bill_pass_register b2 JOIN companies c2 ON c2.id=b2.company_id
  WHERE c2.name = 'Nyko Mart' AND (b2.invoice_no = '108100143679' OR b2.vendor_invoice_no = '108100143679')
);
INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_date, invoice_recv_date, total_amt, total_paid, party_type, remark)
SELECT c.id, p.id, '108100144094', '2025-05-11', '2025-05-11', 18915.42, 18915.42, 'Purchase', 'Imported from NYKO-PNB bank ledger (SR 33) — 2026-08-17.'
FROM companies c, parties p
WHERE c.name = 'Nyko Mart' AND p.name = 'UPS'
AND NOT EXISTS (
  SELECT 1 FROM bill_pass_register b2 JOIN companies c2 ON c2.id=b2.company_id
  WHERE c2.name = 'Nyko Mart' AND (b2.invoice_no = '108100144094' OR b2.vendor_invoice_no = '108100144094')
);
INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_date, invoice_recv_date, total_amt, total_paid, party_type, remark)
SELECT c.id, p.id, '108100144631', '2025-05-11', '2025-05-11', 33593.33, 33593.33, 'Purchase', 'Imported from NYKO-PNB bank ledger (SR 34) — 2026-08-17.'
FROM companies c, parties p
WHERE c.name = 'Nyko Mart' AND p.name = 'UPS'
AND NOT EXISTS (
  SELECT 1 FROM bill_pass_register b2 JOIN companies c2 ON c2.id=b2.company_id
  WHERE c2.name = 'Nyko Mart' AND (b2.invoice_no = '108100144631' OR b2.vendor_invoice_no = '108100144631')
);
INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_date, invoice_recv_date, total_amt, total_paid, party_type, remark)
SELECT c.id, p.id, '108100145742', '2025-05-11', '2025-05-11', 26950.42, 26950.42, 'Purchase', 'Imported from NYKO-PNB bank ledger (SR 35) — 2026-08-17.'
FROM companies c, parties p
WHERE c.name = 'Nyko Mart' AND p.name = 'UPS'
AND NOT EXISTS (
  SELECT 1 FROM bill_pass_register b2 JOIN companies c2 ON c2.id=b2.company_id
  WHERE c2.name = 'Nyko Mart' AND (b2.invoice_no = '108100145742' OR b2.vendor_invoice_no = '108100145742')
);
INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_date, invoice_recv_date, total_amt, total_paid, party_type, remark)
SELECT c.id, p.id, '108100146260', '2025-10-11', '2025-10-11', 1459.42, 1459.42, 'Purchase', 'Imported from NYKO-PNB bank ledger (SR 48) — 2026-08-17.'
FROM companies c, parties p
WHERE c.name = 'Nyko Mart' AND p.name = 'UPS'
AND NOT EXISTS (
  SELECT 1 FROM bill_pass_register b2 JOIN companies c2 ON c2.id=b2.company_id
  WHERE c2.name = 'Nyko Mart' AND (b2.invoice_no = '108100146260' OR b2.vendor_invoice_no = '108100146260')
);
INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_date, invoice_recv_date, total_amt, total_paid, party_type, remark)
SELECT c.id, p.id, '108100146637', '2025-10-11', '2025-10-11', 82884.13, 82884.13, 'Purchase', 'Imported from NYKO-PNB bank ledger (SR 47) — 2026-08-17.'
FROM companies c, parties p
WHERE c.name = 'Nyko Mart' AND p.name = 'UPS'
AND NOT EXISTS (
  SELECT 1 FROM bill_pass_register b2 JOIN companies c2 ON c2.id=b2.company_id
  WHERE c2.name = 'Nyko Mart' AND (b2.invoice_no = '108100146637' OR b2.vendor_invoice_no = '108100146637')
);
INSERT INTO bill_pass_register (company_id, party_id, invoice_no, invoice_date, invoice_recv_date, total_amt, total_paid, party_type, remark)
SELECT c.id, p.id, '108500032342', '2025-10-11', '2025-10-11', 3296.06, 3296.06, 'Purchase', 'Imported from NYKO-PNB bank ledger (SR 49) — 2026-08-17.'
FROM companies c, parties p
WHERE c.name = 'Nyko Mart' AND p.name = 'UPS'
AND NOT EXISTS (
  SELECT 1 FROM bill_pass_register b2 JOIN companies c2 ON c2.id=b2.company_id
  WHERE c2.name = 'Nyko Mart' AND (b2.invoice_no = '108500032342' OR b2.vendor_invoice_no = '108500032342')
);

-- Step 2: one bill_pass_register_payments row per bank-ledger transaction
-- (283 rows) — resolved by invoice number + company at run time (works for
-- both bills that already existed and the ones Step 1 just created).
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 27495.0, '2025-10-31', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 9]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-41' OR b.vendor_invoice_no = 'P-41')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 46644.22, '2025-10-31', 'NEFT', 'RJ2425004469 - Part -2 [Imported from NYKO-PNB SR 10]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425004469' OR b.vendor_invoice_no = 'RJ2425004469')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 57718.42, '2025-10-31', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 13]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100143679' OR b.vendor_invoice_no = '108100143679')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 14993.0, '2025-01-11', 'NEFT', 'P-44, INVOICE [Imported from NYKO-PNB SR 17]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-44' OR b.vendor_invoice_no = 'P-44')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 97935.49, '2025-03-11', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 26]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425004631' OR b.vendor_invoice_no = 'RJ2425004631')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 33547.0, '2025-05-11', 'NEFT', 'INVOICE - P-42 [Imported from NYKO-PNB SR 31]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-42' OR b.vendor_invoice_no = 'P-42')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 46862.83, '2025-05-11', 'NEFT', 'INVOICE - RJ2425004810 [Imported from NYKO-PNB SR 32]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425004810' OR b.vendor_invoice_no = 'RJ2425004810')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 18915.42, '2025-05-11', 'NEFT', 'INVOICE-108100144094 [Imported from NYKO-PNB SR 33]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100144094' OR b.vendor_invoice_no = '108100144094')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 33593.33, '2025-05-11', 'NEFT', 'INVOICE-108100144631 [Imported from NYKO-PNB SR 34]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100144631' OR b.vendor_invoice_no = '108100144631')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 26950.42, '2025-05-11', 'NEFT', 'INVOICE-108100145742 [Imported from NYKO-PNB SR 35]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100145742' OR b.vendor_invoice_no = '108100145742')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 82884.13, '2025-10-11', 'NEFT', 'INVOICE-108100146637 [Imported from NYKO-PNB SR 47]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100146637' OR b.vendor_invoice_no = '108100146637')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1459.42, '2025-10-11', 'NEFT', 'INVOICE-108100146260 [Imported from NYKO-PNB SR 48]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100146260' OR b.vendor_invoice_no = '108100146260')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 3296.06, '2025-10-11', 'NEFT', 'INVOICE-108500032342 [Imported from NYKO-PNB SR 49]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500032342' OR b.vendor_invoice_no = '108500032342')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 32025.0, '2025-11-21', 'UPI', 'INVOICE PAID -C45 [Imported from NYKO-PNB SR 69]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'C-45' OR b.vendor_invoice_no = 'C-45')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1000.0, '2025-08-12', 'UPI', 'CRADIT CARD [Imported from NYKO-PNB SR 103]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'R2526J4826' OR b.vendor_invoice_no = 'R2526J4826')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 123805.35, '2025-12-12', 'NEFT', '108100149837 - Invoice [Imported from NYKO-PNB SR 117]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100149837' OR b.vendor_invoice_no = '108100149837')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 15000.0, '2025-12-13', 'UPI', 'CARD PAYMENT [Imported from NYKO-PNB SR 119]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'R2526J4435' OR b.vendor_invoice_no = 'R2526J4435')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 15000.0, '2025-12-17', 'UPI', 'RD LOHRA CARD [Imported from NYKO-PNB SR 127]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'R2526J3611' OR b.vendor_invoice_no = 'R2526J3611')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 10000.0, '2025-12-25', 'UPI', 'CARD PAYMENT [Imported from NYKO-PNB SR 137]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'R2526J3611' OR b.vendor_invoice_no = 'R2526J3611')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 47555.5, '2026-07-01', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 161]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276394966' OR b.vendor_invoice_no = '276394966')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 14574.1, '2026-08-01', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 162]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276404105' OR b.vendor_invoice_no = '276404105')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 15830.51, '2026-08-01', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 163]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100150851' OR b.vendor_invoice_no = '108100150851')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 21335.14, '2026-08-01', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 164]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100151030' OR b.vendor_invoice_no = '108100151030')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 31728.31, '2026-08-01', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 165]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100151298' OR b.vendor_invoice_no = '108100151298')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 21947.0, '2026-08-01', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 166]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-58' OR b.vendor_invoice_no = 'P-58')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 18024.9, '2026-08-01', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 174]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276405779' OR b.vendor_invoice_no = '276405779')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 37742.0, '2026-07-01', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 175]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276406566' OR b.vendor_invoice_no = '276406566')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 5419.2, '2026-08-01', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 176]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276406176' OR b.vendor_invoice_no = '276406176')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 45097.5, '2026-01-13', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 181]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'C-51' OR b.vendor_invoice_no = 'C-51')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 25355.0, '2026-01-20', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 191]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-60' OR b.vendor_invoice_no = 'P-60')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 29270.0, '2026-01-20', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 192]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-61' OR b.vendor_invoice_no = 'P-61')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 21989.0, '2026-01-27', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 201]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-67' OR b.vendor_invoice_no = 'P-67')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 13481.0, '2026-01-27', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 202]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-63' OR b.vendor_invoice_no = 'P-63')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 22550.0, '2026-01-27', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 203]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-69' OR b.vendor_invoice_no = 'P-69')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 11817.39, '2026-01-27', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 204]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425005611' OR b.vendor_invoice_no = 'RJ2425005611')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1958.67, '2026-01-27', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 205]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425006240' OR b.vendor_invoice_no = 'RJ2425006240')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1034.74, '2026-01-27', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 206]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425005931' OR b.vendor_invoice_no = 'RJ2425005931')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 76824.81, '2026-01-27', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 207]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425005435' OR b.vendor_invoice_no = 'RJ2425005435')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 44215.0, '2026-01-29', 'UPI', 'INVOICE [Imported from NYKO-PNB SR 209]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'R2526J3920' OR b.vendor_invoice_no = 'R2526J3920')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 31774.87, '2026-01-30', 'UPI', 'INVOICE [Imported from NYKO-PNB SR 211]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'R2526J3920' OR b.vendor_invoice_no = 'R2526J3920')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 4477.2, '2026-01-30', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 213]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276402280' OR b.vendor_invoice_no = '276402280')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 25406.7, '2026-01-30', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 214]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276407361' OR b.vendor_invoice_no = '276407361')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 25444.8, '2026-01-30', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 215]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276397926' OR b.vendor_invoice_no = '276397926')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 4053.0, '2026-10-02', 'UPI', 'CREDIT CARD [Imported from NYKO-PNB SR 227]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'R2526J4826' OR b.vendor_invoice_no = 'R2526J4826')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 27127.0, '2026-10-02', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 238]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-70' OR b.vendor_invoice_no = 'P-70')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 16474.0, '2026-10-02', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 239]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-71' OR b.vendor_invoice_no = 'P-71')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 77277.2, '2026-11-02', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 240]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276404998' OR b.vendor_invoice_no = '276404998')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 29497.4, '2026-11-02', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 241]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276408152' OR b.vendor_invoice_no = '276408152')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 39314.62, '2026-11-02', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 242]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'NA-81' OR b.vendor_invoice_no = 'NA-81')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 10022.25, '2026-11-02', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 244]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'AK-015' OR b.vendor_invoice_no = 'AK-015')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 73224.51, '2026-02-25', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 264]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425007226' OR b.vendor_invoice_no = 'RJ2425007226')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2500.39, '2026-02-25', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 265]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425006782' OR b.vendor_invoice_no = 'RJ2425006782')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 719.36, '2026-02-25', 'NEFT', 'INVOICE [Imported from NYKO-PNB SR 266]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425006685' OR b.vendor_invoice_no = 'RJ2425006685')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 18114.0, '2026-02-25', 'NEFT', 'PRACHI RUGS [Imported from NYKO-PNB SR 268]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-72' OR b.vendor_invoice_no = 'P-72')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 28418.0, '2026-02-25', 'UPI', 'WEST EXPRESS [Imported from NYKO-PNB SR 271]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'WEL-25-26-3575' OR b.vendor_invoice_no = 'WEL-25-26-3575')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 141772.42, '2026-02-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 280]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100151759' OR b.vendor_invoice_no = '108100151759')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 11235.72, '2026-02-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 281]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500034986' OR b.vendor_invoice_no = '108500034986')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2951.18, '2026-02-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 282]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100152194' OR b.vendor_invoice_no = '108100152194')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 83596.4, '2026-02-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 283]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100152339' OR b.vendor_invoice_no = '108100152339')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 24509.74, '2026-02-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 284]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500035126' OR b.vendor_invoice_no = '108500035126')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1791.78, '2026-02-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 285]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100152646' OR b.vendor_invoice_no = '108100152646')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 51899.93, '2026-02-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 286]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100152734' OR b.vendor_invoice_no = '108100152734')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2950.48, '2026-02-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 287]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100153191' OR b.vendor_invoice_no = '108100153191')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 10338.23, '2026-02-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 288]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500035252' OR b.vendor_invoice_no = '108500035252')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 38015.4, '2026-02-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 289]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276408836' OR b.vendor_invoice_no = '276408836')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 8762.6, '2026-02-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 290]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276409249' OR b.vendor_invoice_no = '276409249')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 38574.5, '2026-02-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 291]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276409513' OR b.vendor_invoice_no = '276409513')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 52228.3, '2026-02-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 292]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276410286' OR b.vendor_invoice_no = '276410286')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 4553.1, '2026-02-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 293]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276410287' OR b.vendor_invoice_no = '276410287')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 4627.2, '2026-02-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 294]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276410856' OR b.vendor_invoice_no = '276410856')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 7678.0, '2026-02-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 295]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276411672' OR b.vendor_invoice_no = '276411672')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 54418.42, '2026-04-03', 'UPI', 'AJAY LOHRA ONE CARD [Imported from NYKO-PNB SR 301]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'R2526J4385' OR b.vendor_invoice_no = 'R2526J4385')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1842.0, '2026-04-03', 'UPI', 'AJAY LOHRA RBL CARD [Imported from NYKO-PNB SR 302]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'R2526J3920' OR b.vendor_invoice_no = 'R2526J3920')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 28247.0, '2026-06-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 312]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-78' OR b.vendor_invoice_no = 'P-78')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 18481.0, '2026-06-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 313]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'p-76' OR b.vendor_invoice_no = 'p-76')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 26959.0, '2026-06-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 314]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'p-77' OR b.vendor_invoice_no = 'p-77')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1422.0, '2026-06-03', 'UPI', 'AGAINST BILL [Imported from NYKO-PNB SR 315]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'CC/25-26/141' OR b.vendor_invoice_no = 'CC/25-26/141')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 31488.0, '2026-11-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 335]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-75' OR b.vendor_invoice_no = 'P-75')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 50000.0, '2026-11-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 337]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'AK-016' OR b.vendor_invoice_no = 'AK-016')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 22928.26, '2026-11-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 338]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500035506' OR b.vendor_invoice_no = '108500035506')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 5909.99, '2026-11-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 339]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100153742' OR b.vendor_invoice_no = '108100153742')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 35962.5, '2026-11-03', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 340]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'C-59' OR b.vendor_invoice_no = 'C-59')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 49631.68, '2026-03-18', 'UPI', 'AGAINST BILL [Imported from NYKO-PNB SR 352]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100153379' OR b.vendor_invoice_no = '108100153379')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 17706.53, '2026-03-18', 'UPI', 'AGAINST BILL [Imported from NYKO-PNB SR 353]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100153864' OR b.vendor_invoice_no = '108100153864')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 32025.0, '2026-03-23', 'NEFT', 'INVOICE-C-72 [Imported from NYKO-PNB SR 365]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'C-72' OR b.vendor_invoice_no = 'C-72')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 26754.0, '2026-03-23', 'NEFT', 'INVOICE-79 [Imported from NYKO-PNB SR 366]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-79' OR b.vendor_invoice_no = 'P-79')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 23252.0, '2026-03-23', 'NEFT', 'INVOICE-81 [Imported from NYKO-PNB SR 367]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-81' OR b.vendor_invoice_no = 'P-81')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 215.18, '2026-03-23', 'NEFT', 'INVOICE PAID [Imported from NYKO-PNB SR 368]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500035703' OR b.vendor_invoice_no = '108500035703')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1208.36, '2026-03-23', 'NEFT', 'INVOICE PAID [Imported from NYKO-PNB SR 369]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100154707' OR b.vendor_invoice_no = '108100154707')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2131.36, '2026-03-23', 'NEFT', 'INVOICE PAID [Imported from NYKO-PNB SR 370]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100154808' OR b.vendor_invoice_no = '108100154808')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 7417.35, '2026-03-23', 'NEFT', 'INVOICE PAID [Imported from NYKO-PNB SR 371]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500035608' OR b.vendor_invoice_no = '108500035608')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 4209.03, '2026-03-23', 'NEFT', 'INVOICE PAID [Imported from NYKO-PNB SR 372]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100154258' OR b.vendor_invoice_no = '108100154258')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 8547.23, '2026-03-23', 'NEFT', 'INVOICE PAID [Imported from NYKO-PNB SR 373]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100155803' OR b.vendor_invoice_no = '108100155803')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 17841.25, '2026-03-23', 'NEFT', 'INVOICE PAID [Imported from NYKO-PNB SR 374]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100155392' OR b.vendor_invoice_no = '108100155392')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 31013.07, '2026-03-23', 'NEFT', 'INVOICE PAID [Imported from NYKO-PNB SR 375]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100154388' OR b.vendor_invoice_no = '108100154388')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 25526.5, '2026-03-23', 'NEFT', 'INVOICE PAID [Imported from NYKO-PNB SR 376]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'AK-016' OR b.vendor_invoice_no = 'AK-016')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 14327.3, '2026-03-23', 'NEFT', 'INVOICE PAID [Imported from NYKO-PNB SR 377]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276411464' OR b.vendor_invoice_no = '276411464')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 24576.4, '2026-03-23', 'NEFT', 'INVOICE PAID [Imported from NYKO-PNB SR 378]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276413657' OR b.vendor_invoice_no = '276413657')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 42864.2, '2026-03-23', 'NEFT', 'INVOICE PAID [Imported from NYKO-PNB SR 379]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276411851' OR b.vendor_invoice_no = '276411851')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 10901.3, '2026-03-23', 'NEFT', 'INVOICE PAID [Imported from NYKO-PNB SR 380]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276411761' OR b.vendor_invoice_no = '276411761')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 28203.97, '2026-03-23', 'NEFT', 'INVOICE PAID [Imported from NYKO-PNB SR 381]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425007035' OR b.vendor_invoice_no = 'RJ2425007035')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 22571.0, '2026-03-23', 'NEFT', 'INVOICE PAID [Imported from NYKO-PNB SR 382]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'WEL/25-26/3975' OR b.vendor_invoice_no = 'WEL/25-26/3975')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 6562.5, '2026-03-24', 'NEFT', 'INVOICE-C-72 [Imported from NYKO-PNB SR 385]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'C-72' OR b.vendor_invoice_no = 'C-72')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 50000.0, '2026-09-04', 'NEFT', 'INVOICE-18- PART 1 [Imported from NYKO-PNB SR 430]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'AK-018' OR b.vendor_invoice_no = 'AK-018')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 22666.0, '2026-09-04', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 431]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-82' OR b.vendor_invoice_no = 'P-82')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 23247.0, '2026-04-16', 'UPI', 'AGAINST BILL [Imported from NYKO-PNB SR 464]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/25-26/1417' OR b.vendor_invoice_no = 'INV/25-26/1417')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 26945.0, '2026-04-21', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 483]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-84' OR b.vendor_invoice_no = 'P-84')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 20860.0, '2026-04-21', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 484]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-85' OR b.vendor_invoice_no = 'P-85')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 41481.0, '2026-04-21', 'UPI', 'AGAINST BILL [Imported from NYKO-PNB SR 486]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'WEL/25-26/4155' OR b.vendor_invoice_no = 'WEL/25-26/4155')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 76129.01, '2026-04-21', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 487]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100161998' OR b.vendor_invoice_no = '108100161998')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 17184.5, '2026-04-21', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 488]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276414541' OR b.vendor_invoice_no = '276414541')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 9205.5, '2026-04-21', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 489]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276415955' OR b.vendor_invoice_no = '276415955')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 7741.2, '2026-04-21', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 490]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276416633' OR b.vendor_invoice_no = '276416633')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2368.7, '2026-04-21', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 491]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276418656' OR b.vendor_invoice_no = '276418656')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 3575.0, '2026-04-21', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 492]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276418721' OR b.vendor_invoice_no = '276418721')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 42856.75, '2026-04-21', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 493]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'AK-018' OR b.vendor_invoice_no = 'AK-018')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 54144.0, '2026-05-05', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 531]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'AK-021' OR b.vendor_invoice_no = 'AK-021')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 100000.0, '2026-05-05', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 532]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100163590' OR b.vendor_invoice_no = '108100163590')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 23623.0, '2026-05-05', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 533]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-86' OR b.vendor_invoice_no = 'P-86')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 23115.0, '2026-05-05', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 534]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P--1' OR b.vendor_invoice_no = 'P--1')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 8505.0, '2026-06-05', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 536]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/117' OR b.vendor_invoice_no = 'INV/26-27/117')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 7087.5, '2026-06-05', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 537]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/103' OR b.vendor_invoice_no = 'INV/26-27/103')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 4536.0, '2026-06-05', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 538]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/54' OR b.vendor_invoice_no = 'INV/26-27/54')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 3118.5, '2026-06-05', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 539]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/111' OR b.vendor_invoice_no = 'INV/26-27/111')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2835.0, '2026-06-05', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 540]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/80' OR b.vendor_invoice_no = 'INV/26-27/80')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1134.0, '2026-06-05', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 541]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/32' OR b.vendor_invoice_no = 'INV/26-27/32')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 69895.69, '2026-08-05', 'NEFT', 'AGAINST BILL - part - 2 [Imported from NYKO-PNB SR 544]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100163590' OR b.vendor_invoice_no = '108100163590')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 16217.0, '2026-05-13', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 573]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'JAI/26-27/41' OR b.vendor_invoice_no = 'JAI/26-27/41')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 33112.0, '2026-05-13', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 574]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/06' OR b.vendor_invoice_no = 'P/26-27/06')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1497.93, '2026-05-16', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 583]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100166221' OR b.vendor_invoice_no = '108100166221')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 3063.84, '2026-05-16', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 584]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100164558' OR b.vendor_invoice_no = '108100164558')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2470.37, '2026-05-16', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 585]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500037781' OR b.vendor_invoice_no = '108500037781')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2125.09, '2026-05-16', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 586]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500037977' OR b.vendor_invoice_no = '108500037977')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 7848.4, '2026-05-16', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 587]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100168815' OR b.vendor_invoice_no = '108100168815')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 61620.16, '2026-05-16', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 588]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100164843' OR b.vendor_invoice_no = '108100164843')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 13325.35, '2026-05-16', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 589]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100167353' OR b.vendor_invoice_no = '108100167353')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 8476.56, '2026-05-16', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 590]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500038211' OR b.vendor_invoice_no = '108500038211')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2680.13, '2026-05-16', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 591]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500038498' OR b.vendor_invoice_no = '108500038498')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 79118.0, '2026-05-18', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 600]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'AK//26-27/25' OR b.vendor_invoice_no = 'AK//26-27/25')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 43890.01, '2026-05-18', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 601]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'AGRA/26-27/D9' OR b.vendor_invoice_no = 'AGRA/26-27/D9')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 18661.0, '2026-05-18', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 602]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/07' OR b.vendor_invoice_no = 'P/26-27/07')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 16340.0, '2026-05-18', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 603]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-03' OR b.vendor_invoice_no = 'P-03')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 14087.0, '2026-05-18', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 604]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/08' OR b.vendor_invoice_no = 'P/26-27/08')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 29852.0, '2026-05-18', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 605]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'NA-84' OR b.vendor_invoice_no = 'NA-84')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 10736.0, '2026-05-18', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 606]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'NA-85' OR b.vendor_invoice_no = 'NA-85')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 5565.0, '2026-05-18', 'UPI', 'AGAINST BILL [Imported from NYKO-PNB SR 607]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '411' OR b.vendor_invoice_no = '411')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 47596.52, '2026-05-18', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 608]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425007931' OR b.vendor_invoice_no = 'RJ2425007931')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 33365.91, '2026-05-18', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 609]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425007696' OR b.vendor_invoice_no = 'RJ2425007696')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 7963.32, '2026-05-18', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 610]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425007777' OR b.vendor_invoice_no = 'RJ2425007777')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 5417.65, '2026-05-18', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 611]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425007697' OR b.vendor_invoice_no = 'RJ2425007697')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1060.73, '2026-05-18', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 612]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425007778' OR b.vendor_invoice_no = 'RJ2425007778')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 100983.75, '2026-05-20', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 616]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'AK//26-27/29' OR b.vendor_invoice_no = 'AK//26-27/29')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 29055.0, '2026-05-20', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 617]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/10' OR b.vendor_invoice_no = 'P/26-27/10')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 20797.0, '2026-05-20', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 618]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/09' OR b.vendor_invoice_no = 'P/26-27/09')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 854.0, '2026-05-20', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 619]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P-21' OR b.vendor_invoice_no = 'P-21')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 8505.0, '2026-05-20', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 621]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/141' OR b.vendor_invoice_no = 'INV/26-27/141')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 8505.0, '2026-05-20', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 622]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/136' OR b.vendor_invoice_no = 'INV/26-27/136')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 8221.5, '2026-05-20', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 623]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/176' OR b.vendor_invoice_no = 'INV/26-27/176')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 3969.0, '2026-05-20', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 624]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/187' OR b.vendor_invoice_no = 'INV/26-27/187')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2855.0, '2026-05-20', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 625]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/156' OR b.vendor_invoice_no = 'INV/26-27/156')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 6827.0, '2026-05-20', 'UPI', 'AGAINST BILL [Imported from NYKO-PNB SR 626]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'WEL/25-26/3781' OR b.vendor_invoice_no = 'WEL/25-26/3781')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 82350.01, '2026-05-21', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 627]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100166495' OR b.vendor_invoice_no = '108100166495')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 100000.0, '2026-05-23', 'NEFT', 'AGAINST BILL- PART-1 [Imported from NYKO-PNB SR 631]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425007430' OR b.vendor_invoice_no = 'RJ2425007430')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 36610.82, '2026-05-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 634]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425007430' OR b.vendor_invoice_no = 'RJ2425007430')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 20621.08, '2026-05-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 635]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425007577' OR b.vendor_invoice_no = 'RJ2425007577')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 11311.59, '2026-05-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 636]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'RJ2425007578' OR b.vendor_invoice_no = 'RJ2425007578')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 195.84, '2026-05-27', 'NEFT', '[Imported from NYKO-PNB SR 644]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100164841' OR b.vendor_invoice_no = '108100164841')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 47143.61, '2026-05-27', 'NEFT', '[Imported from NYKO-PNB SR 645]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100167687' OR b.vendor_invoice_no = '108100167687')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 21690.0, '2026-05-27', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 648]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/12' OR b.vendor_invoice_no = 'P/26-27/12')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 37533.03, '2026-02-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 677]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100169134' OR b.vendor_invoice_no = '108100169134')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 6200.69, '2026-02-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 678]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100169964' OR b.vendor_invoice_no = '108100169964')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 61954.66, '2026-02-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 679]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100170296' OR b.vendor_invoice_no = '108100170296')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 3159.92, '2026-02-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 680]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100171010' OR b.vendor_invoice_no = '108100171010')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 4588.28, '2026-02-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 681]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500038753' OR b.vendor_invoice_no = '108500038753')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 4867.41, '2026-02-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 682]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500039026' OR b.vendor_invoice_no = '108500039026')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 54104.0, '2026-02-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 683]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'AK-023' OR b.vendor_invoice_no = 'AK-023')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 5670.0, '2026-02-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 684]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/193' OR b.vendor_invoice_no = 'INV/26-27/193')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2268.0, '2026-02-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 685]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/200' OR b.vendor_invoice_no = 'INV/26-27/200')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 5943.0, '2026-02-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 686]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/218' OR b.vendor_invoice_no = 'INV/26-27/218')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 11340.0, '2026-02-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 687]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/268' OR b.vendor_invoice_no = 'INV/26-27/268')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 8200.5, '2026-02-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 688]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/279' OR b.vendor_invoice_no = 'INV/26-27/279')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 50000.0, '2026-04-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 696]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'AK-023' OR b.vendor_invoice_no = 'AK-023')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 89155.09, '2026-06-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 701]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276412733' OR b.vendor_invoice_no = '276412733')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 3763.1, '2026-06-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 702]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276416213' OR b.vendor_invoice_no = '276416213')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 155335.96, '2026-08-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 709]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276410955' OR b.vendor_invoice_no = '276410955')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 7628.7, '2026-08-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 710]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276417037' OR b.vendor_invoice_no = '276417037')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 4187.7, '2026-08-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 711]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276418815' OR b.vendor_invoice_no = '276418815')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 6917.0, '2026-08-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 712]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276419499' OR b.vendor_invoice_no = '276419499')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1762.7, '2026-08-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 713]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276419892' OR b.vendor_invoice_no = '276419892')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2453.3, '2026-08-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 714]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276420123' OR b.vendor_invoice_no = '276420123')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 4086.9, '2026-08-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 715]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276420905' OR b.vendor_invoice_no = '276420905')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 950.6, '2026-08-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 716]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276424195' OR b.vendor_invoice_no = '276424195')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 50000.0, '2026-11-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 732]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'AK-023' OR b.vendor_invoice_no = 'AK-023')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 18820.0, '2026-11-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 734]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/14' OR b.vendor_invoice_no = 'P/26-27/14')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 17076.0, '2026-11-06', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 735]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/15' OR b.vendor_invoice_no = 'P/26-27/15')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 37070.4, '2026-06-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 749]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276420308' OR b.vendor_invoice_no = '276420308')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 33929.9, '2026-06-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 750]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276421089' OR b.vendor_invoice_no = '276421089')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 26648.2, '2026-06-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 751]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276422017' OR b.vendor_invoice_no = '276422017')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 92758.71, '2026-06-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 752]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100171858' OR b.vendor_invoice_no = '108100171858')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2105.99, '2026-06-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 753]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100172576' OR b.vendor_invoice_no = '108100172576')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2744.66, '2026-06-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 754]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100173067' OR b.vendor_invoice_no = '108100173067')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 23020.0, '2026-06-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 758]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/17' OR b.vendor_invoice_no = 'P/26-27/17')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 49783.13, '2026-06-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 759]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'AGRA/26-27/D15' OR b.vendor_invoice_no = 'AGRA/26-27/D15')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 273.0, '2026-06-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 762]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/294' OR b.vendor_invoice_no = 'INV/26-27/294')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 7360.5, '2026-06-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 763]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/321' OR b.vendor_invoice_no = 'INV/26-27/321')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 210.0, '2026-06-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 764]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/332' OR b.vendor_invoice_no = 'INV/26-27/332')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 546.0, '2026-06-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 765]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/339' OR b.vendor_invoice_no = 'INV/26-27/339')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1963.5, '2026-06-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 766]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/354' OR b.vendor_invoice_no = 'INV/26-27/354')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 12999.0, '2026-06-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 767]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/378' OR b.vendor_invoice_no = 'INV/26-27/378')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 4305.0, '2026-06-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 768]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/395' OR b.vendor_invoice_no = 'INV/26-27/395')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 91833.0, '2026-06-27', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 784]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'AK/26-27/30' OR b.vendor_invoice_no = 'AK/26-27/30')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 18134.0, '2026-06-27', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 785]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/16' OR b.vendor_invoice_no = 'P/26-27/16')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 4532.0, '2026-06-27', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 786]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/17' OR b.vendor_invoice_no = 'P/26-27/17')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 22442.0, '2026-06-27', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 787]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/18' OR b.vendor_invoice_no = 'P/26-27/18')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 17930.0, '2026-06-27', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 788]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/22' OR b.vendor_invoice_no = 'P/26-27/22')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 50000.0, '2026-07-07', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 816]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'AK/26-27/032' OR b.vendor_invoice_no = 'AK/26-27/032')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 44805.4, '2026-07-07', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 817]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276415447' OR b.vendor_invoice_no = '276415447')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 54244.3, '2026-07-07', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 818]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276422768' OR b.vendor_invoice_no = '276422768')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 27229.0, '2026-10-07', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 841]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/19' OR b.vendor_invoice_no = 'P/26-27/19')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 25734.0, '2026-10-07', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 842]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/23' OR b.vendor_invoice_no = 'P/26-27/23')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 18777.0, '2026-07-14', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 853]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/24' OR b.vendor_invoice_no = 'P/26-27/24')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 19126.0, '2026-07-14', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 854]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/26' OR b.vendor_invoice_no = 'P/26-27/26')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 19841.0, '2026-07-14', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 855]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/27' OR b.vendor_invoice_no = 'P/26-27/27')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 3351.0, '2026-07-15', 'UPI', 'AGAINST BILL [Imported from NYKO-PNB SR 858]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'WEL/26-27/993' OR b.vendor_invoice_no = 'WEL/26-27/993')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1895.6, '2026-07-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 867]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276426752' OR b.vendor_invoice_no = '276426752')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 11314.6, '2026-07-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 868]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276428113' OR b.vendor_invoice_no = '276428113')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 614.2, '2026-07-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 869]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276428399' OR b.vendor_invoice_no = '276428399')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 6028.0, '2026-07-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 870]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276428462' OR b.vendor_invoice_no = '276428462')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2943.4, '2026-07-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 871]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276428610' OR b.vendor_invoice_no = '276428610')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 11887.5, '2026-07-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 872]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276429432' OR b.vendor_invoice_no = '276429432')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 795.9, '2026-07-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 873]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276429457' OR b.vendor_invoice_no = '276429457')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1282.2, '2026-07-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 874]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276429551' OR b.vendor_invoice_no = '276429551')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 4882.2, '2026-07-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 875]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276430051' OR b.vendor_invoice_no = '276430051')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 30000.0, '2026-07-17', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 876]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276427539' OR b.vendor_invoice_no = '276427539')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 21747.0, '2026-07-22', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 890]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/28' OR b.vendor_invoice_no = 'P/26-27/28')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 19785.0, '2026-07-22', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 891]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/30' OR b.vendor_invoice_no = 'P/26-27/30')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 24713.0, '2026-07-22', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 892]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/31' OR b.vendor_invoice_no = 'P/26-27/31')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 167376.25, '2026-07-22', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 893]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'AK/26-27/032' OR b.vendor_invoice_no = 'AK/26-27/032')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 15598.0, '2026-07-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 903]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100172432' OR b.vendor_invoice_no = '108100172432')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 50871.45, '2026-07-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 904]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100172691' OR b.vendor_invoice_no = '108100172691')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2848.28, '2026-07-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 905]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100174562' OR b.vendor_invoice_no = '108100174562')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2640.92, '2026-07-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 906]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100176507' OR b.vendor_invoice_no = '108100176507')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1393.96, '2026-07-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 907]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108100177493' OR b.vendor_invoice_no = '108100177493')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 6566.73, '2026-07-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 908]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500039221' OR b.vendor_invoice_no = '108500039221')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 8225.93, '2026-07-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 909]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500039343' OR b.vendor_invoice_no = '108500039343')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 9393.4, '2026-07-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 910]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500039373' OR b.vendor_invoice_no = '108500039373')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 5193.11, '2026-07-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 911]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500039462' OR b.vendor_invoice_no = '108500039462')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 493.9, '2026-07-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 912]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500039685' OR b.vendor_invoice_no = '108500039685')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1203.84, '2026-07-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 913]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500040031' OR b.vendor_invoice_no = '108500040031')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 226.49, '2026-07-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 914]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '108500040282' OR b.vendor_invoice_no = '108500040282')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 67605.9, '2026-07-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 919]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276427539' OR b.vendor_invoice_no = '276427539')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1249.1, '2026-07-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 920]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276430156' OR b.vendor_invoice_no = '276430156')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 697.5, '2026-07-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 921]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276430215' OR b.vendor_invoice_no = '276430215')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 4879.4, '2026-07-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 922]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276430870' OR b.vendor_invoice_no = '276430870')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 679.6, '2026-07-25', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 923]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276430969' OR b.vendor_invoice_no = '276430969')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 32588.0, '2026-07-29', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 937]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/32' OR b.vendor_invoice_no = 'P/26-27/32')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 27363.0, '2026-07-29', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 938]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/33' OR b.vendor_invoice_no = 'P/26-27/33')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 30947.7, '2026-07-29', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 939]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/35' OR b.vendor_invoice_no = 'P/26-27/35')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 86878.0, '2026-07-29', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 940]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276429663' OR b.vendor_invoice_no = '276429663')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 35258.0, '2026-07-29', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 941]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'NVR/26-27/87' OR b.vendor_invoice_no = 'NVR/26-27/87')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 4109.5, '2026-04-08', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 964]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276428684' OR b.vendor_invoice_no = '276428684')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 5309.4, '2026-04-08', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 965]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276431032' OR b.vendor_invoice_no = '276431032')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2103.2, '2026-04-08', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 966]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276431702' OR b.vendor_invoice_no = '276431702')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 5966.3, '2026-04-08', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 967]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276431800' OR b.vendor_invoice_no = '276431800')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 3100.4, '2026-04-08', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 968]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276432057' OR b.vendor_invoice_no = '276432057')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 105780.8, '2026-04-08', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 969]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276428860' OR b.vendor_invoice_no = '276428860')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 6996.0, '2026-05-08', 'UPI', 'AGAINST BILL [Imported from NYKO-PNB SR 973]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276417894' OR b.vendor_invoice_no = '276417894')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 10825.5, '2026-12-08', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 1002]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/423' OR b.vendor_invoice_no = 'INV/26-27/423')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1963.5, '2026-12-08', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 1003]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/436' OR b.vendor_invoice_no = 'INV/26-27/436')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2268.0, '2026-12-08', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 1004]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/450' OR b.vendor_invoice_no = 'INV/26-27/450')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 7369.0, '2026-12-08', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR 1005]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/468' OR b.vendor_invoice_no = 'INV/26-27/468')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1805.0, '2026-12-08', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR None]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/479' OR b.vendor_invoice_no = 'INV/26-27/479')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 3443.0, '2026-12-08', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR None]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/483' OR b.vendor_invoice_no = 'INV/26-27/483')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 7509.0, '2026-12-08', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR None]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/489' OR b.vendor_invoice_no = 'INV/26-27/489')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 5847.0, '2026-12-08', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR None]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'INV/26-27/493' OR b.vendor_invoice_no = 'INV/26-27/493')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 147856.0, '2026-08-13', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR None]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'AK/26-27/33' OR b.vendor_invoice_no = 'AK/26-27/33')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 28379.0, '2026-08-13', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR None]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/36' OR b.vendor_invoice_no = 'P/26-27/36')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 30388.0, '2026-08-13', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR None]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/37' OR b.vendor_invoice_no = 'P/26-27/37')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 20784.0, '2026-08-13', 'NEFT', 'AGAINST BILL [Imported from NYKO-PNB SR None]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = 'P/26-27/38' OR b.vendor_invoice_no = 'P/26-27/38')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 70000.0, '2026-08-14', 'NEFT', '[Imported from NYKO-PNB SR None]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276428860' OR b.vendor_invoice_no = '276428860')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 3945.8, '2026-08-14', 'NEFT', '[Imported from NYKO-PNB SR None]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276429254' OR b.vendor_invoice_no = '276429254')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 680.6, '2026-08-14', 'NEFT', '[Imported from NYKO-PNB SR None]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276430404' OR b.vendor_invoice_no = '276430404')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 18692.5, '2026-08-14', 'NEFT', '[Imported from NYKO-PNB SR None]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Nyko Mart' AND (b.invoice_no = '276431189' OR b.vendor_invoice_no = '276431189')
LIMIT 1;

-- NOTE (per user decision 2026-08-17): total_paid is intentionally NOT
-- recomputed/touched for bills that already existed (MATCH_EXISTING).
-- Their total_paid may already reflect these same payments from the original
-- historical master-file import (which had no itemized rows behind it), so
-- overwriting or adding to it here risked erasing or double-counting real
-- payment history. Step 2 above only adds an audit-trail row per bank-ledger
-- transaction; it does not change any bill's total_paid. Newly-created bills
-- (Step 1) already got the correct total_paid at creation time, so nothing
-- further is needed for them either.

COMMIT;