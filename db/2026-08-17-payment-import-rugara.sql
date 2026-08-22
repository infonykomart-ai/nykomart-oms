-- Generated from RUGARA-PNB — Rugara — clear/unambiguous rows only
BEGIN;

-- Step 1: create 0 new bill_pass_register rows for invoices
-- that don't exist in the system yet (their whole amount is set to the SUM of
-- the bank-confirmed payment(s) found for them — i.e. treated as fully paid,
-- since a bank debit is direct evidence of the real amount actually billed).

-- Step 2: one bill_pass_register_payments row per bank-ledger transaction
-- (59 rows) — resolved by invoice number + company at run time (works for
-- both bills that already existed and the ones Step 1 just created).
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1.0, '2026-03-03', 'UPI', 'UPS [Imported from RUGARA-PNB SR 29]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100151850' OR b.vendor_invoice_no = '108100151850')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 14086.5, '2026-03-03', 'UPI', 'UPS [Imported from RUGARA-PNB SR 30]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100151850' OR b.vendor_invoice_no = '108100151850')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 48569.89, '2026-03-03', 'UPI', 'UPS [Imported from RUGARA-PNB SR 31]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100153450' OR b.vendor_invoice_no = '108100153450')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 4398.61, '2026-03-03', 'UPI', 'UPS [Imported from RUGARA-PNB SR 32]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100154869' OR b.vendor_invoice_no = '108100154869')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 25993.0, '2026-09-04', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 88]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = 'P-62' OR b.vendor_invoice_no = 'P-62')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 23326.24, '2026-05-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 180]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100163749' OR b.vendor_invoice_no = '108100163749')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 4641.57, '2026-05-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 181]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100166679' OR b.vendor_invoice_no = '108100166679')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 4171.81, '2026-05-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 182]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100165010' OR b.vendor_invoice_no = '108100165010')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1531.92, '2026-05-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 183]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100166297' OR b.vendor_invoice_no = '108100166297')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1531.92, '2026-05-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 184]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100166298' OR b.vendor_invoice_no = '108100166298')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 542.48, '2026-05-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 185]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108500038052' OR b.vendor_invoice_no = '108500038052')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 382.05, '2026-05-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 186]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108500038053' OR b.vendor_invoice_no = '108500038053')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1564.12, '2026-05-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 187]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100167472' OR b.vendor_invoice_no = '108100167472')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1541.85, '2026-05-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 188]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100167473' OR b.vendor_invoice_no = '108100167473')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 871.05, '2026-05-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 189]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108500038331' OR b.vendor_invoice_no = '108500038331')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 273.46, '2026-05-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 190]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108500038332' OR b.vendor_invoice_no = '108500038332')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1540.9, '2026-05-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 191]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100170071' OR b.vendor_invoice_no = '108100170071')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1540.9, '2026-05-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 192]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100170072' OR b.vendor_invoice_no = '108100170072')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 490.75, '2026-05-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 193]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108500038859' OR b.vendor_invoice_no = '108500038859')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 28187.27, '2026-02-06', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 232]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100169301' OR b.vendor_invoice_no = '108100169301')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 14264.65, '2026-02-06', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 233]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100167874' OR b.vendor_invoice_no = '108100167874')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 10531.11, '2026-02-06', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 234]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100170490' OR b.vendor_invoice_no = '108100170490')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1578.03, '2026-02-06', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 235]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100170074' OR b.vendor_invoice_no = '108100170074')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1540.9, '2026-02-06', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 236]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100170073' OR b.vendor_invoice_no = '108100170073')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1155.82, '2026-02-06', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 237]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108500038862' OR b.vendor_invoice_no = '108500038862')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 496.22, '2026-02-06', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 238]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108500038861' OR b.vendor_invoice_no = '108500038861')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 260.24, '2026-02-06', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 239]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108500038860' OR b.vendor_invoice_no = '108500038860')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 129.52, '2026-02-06', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 240]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108500038859' OR b.vendor_invoice_no = '108500038859')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 0.01, '2026-02-06', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 244]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100166679' OR b.vendor_invoice_no = '108100166679')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 48290.35, '2026-06-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 272]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100173593' OR b.vendor_invoice_no = '108100173593')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 11482.58, '2026-06-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 273]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100174068' OR b.vendor_invoice_no = '108100174068')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 6513.82, '2026-06-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 274]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100174309' OR b.vendor_invoice_no = '108100174309')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 4084.87, '2026-06-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 275]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108500039610' OR b.vendor_invoice_no = '108500039610')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 3812.7, '2026-06-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 276]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100173216' OR b.vendor_invoice_no = '108100173216')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 3169.27, '2026-06-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 277]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100172065' OR b.vendor_invoice_no = '108100172065')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1554.2, '2026-06-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 278]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100171086' OR b.vendor_invoice_no = '108100171086')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1554.2, '2026-06-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 279]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108100171085' OR b.vendor_invoice_no = '108100171085')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1129.48, '2026-06-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 280]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108500039477' OR b.vendor_invoice_no = '108500039477')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 275.66, '2026-06-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 281]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108500039102' OR b.vendor_invoice_no = '108500039102')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 212.62, '2026-06-15', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 282]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '108500039101' OR b.vendor_invoice_no = '108500039101')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 15371.7, '2026-07-29', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 319]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '276427730' OR b.vendor_invoice_no = '276427730')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 11657.0, '2026-07-29', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 320]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '276430665' OR b.vendor_invoice_no = '276430665')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 9091.1, '2026-07-29', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 321]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '276429836' OR b.vendor_invoice_no = '276429836')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 7734.6, '2026-07-29', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 322]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '276430094' OR b.vendor_invoice_no = '276430094')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 7367.5, '2026-07-29', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 323]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '276430993' OR b.vendor_invoice_no = '276430993')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2439.5, '2026-07-29', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 324]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '276431216' OR b.vendor_invoice_no = '276431216')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1918.1, '2026-07-29', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 325]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '276430340' OR b.vendor_invoice_no = '276430340')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 50180.2, '2026-04-08', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 333]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '276426942' OR b.vendor_invoice_no = '276426942')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 7636.1, '2026-04-08', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 334]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '276431830' OR b.vendor_invoice_no = '276431830')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1770.4, '2026-04-08', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 335]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '276431055' OR b.vendor_invoice_no = '276431055')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1234.0, '2026-04-08', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 336]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '276429514' OR b.vendor_invoice_no = '276429514')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1896.0, '2026-05-08', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 338]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '276429289' OR b.vendor_invoice_no = '276429289')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 33904.5, '2026-05-08', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 339]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '276429044' OR b.vendor_invoice_no = '276429044')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 12164.0, '2026-08-13', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 346]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '276432735' OR b.vendor_invoice_no = '276432735')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 5860.2, '2026-08-13', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 347]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '276432002' OR b.vendor_invoice_no = '276432002')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 3336.0, '2026-08-13', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 348]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '276432892' OR b.vendor_invoice_no = '276432892')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 2508.1, '2026-08-13', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 349]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '276433057' OR b.vendor_invoice_no = '276433057')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 1898.8, '2026-08-13', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 350]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '276431919' OR b.vendor_invoice_no = '276431919')
LIMIT 1;
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, remark)
SELECT b.id, 265.6, '2026-08-13', 'UPI', 'AGAINST BILL [Imported from RUGARA-PNB SR 351]'
FROM bill_pass_register b JOIN companies c ON c.id = b.company_id
WHERE c.name = 'Rugara' AND (b.invoice_no = '276431055' OR b.vendor_invoice_no = '276431055')
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