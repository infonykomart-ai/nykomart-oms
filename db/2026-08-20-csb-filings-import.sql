-- 2026-08-20 -- Import customs shipping bill (CSB) filings from
-- coustom_shiping_bill_.xlsx into the (previously empty) csb_filings table.
-- Of 1014 rows in the file, only 79 had real data (925 blank template rows,
-- 10 held the literal placeholder text "CSB-IV"); after removing exact-duplicate
-- rows (literal copy-paste repeats in the source file) that leaves 71 rows.
--
-- Column mapping (inferred from column names -- csb_filings had zero existing
-- rows to verify against, flagged to the user before this was written):
--   DISPATCHNO.            -> hawb_number
--   SHIPPINGBILLNO.        -> csb_number
--   DATE                   -> filing_date
--   SHIPPINGBILLAMT.INR    -> fob_value_inr
--   SHIPPINGBILLAMT.USD    -> total_taxable_value (taxable_value_currency = 'USD')
--   SHIPPINGBILLEXCHANGERATE -> exchange_rate
--
-- csb_filings has no FK to orders/companies/dispatch_invoices -- it's a
-- standalone table keyed by hawb_number/invoice_no only, so this import carries
-- no company-attribution risk. Some rows have amounts still blank in the source
-- file (csb_number/filing_date known, amounts not yet filed) -- imported as NULL.
--
-- Dry-run tested against the local scratch Postgres before delivery.

BEGIN;

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '883618579254', '18653', '2025-08-17', NULL, NULL, NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '883618579254' AND csb_number = '18653');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '37264838903', '17112', '2026-03-05', 3193.08, 35.4, 'USD', 90.2
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '37264838903' AND csb_number = '17112');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '37264838925', '17113', '2026-03-05', 5682.6, 63, 'USD', 90.2
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '37264838925' AND csb_number = '17113');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '37264838984', '15696', '2026-03-01', 6007.32, 66.6, 'USD', 90.2
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '37264838984' AND csb_number = '15696');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '37264839010', '17114', '2026-03-05', 3030.72, 33.6, 'USD', 90.2
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '37264839010' AND csb_number = '17114');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '37264844396', '22658', '2026-03-07', 8716.8, 96, 'USD', 90.8
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '37264844396' AND csb_number = '22658');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '37264844433', '22659', '2026-03-07', 13783.44, 151.8, 'USD', 90.8
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '37264844433' AND csb_number = '22659');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0444620053', '12760', '2026-03-15', 5448, 60, 'USD', 90.8
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0444620053' AND csb_number = '12760');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0443490268', '12759', '2026-03-15', 2724, 30, 'USD', 90.8
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0443490268' AND csb_number = '12759');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '37264889093', '23209', '2026-03-19', 2288.16, 25.2, 'USD', 90.8
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '37264889093' AND csb_number = '23209');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0444399875', '11171', '2026-03-20', 2832.03, 30.6, 'USD', 92.55
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0444399875' AND csb_number = '11171');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0444264886', '11170', '2026-03-20', 4053.69, 43.8, 'USD', 92.55
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0444264886' AND csb_number = '11170');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0443241296', '15246', '2026-03-20', 14493.33, 156.6, 'USD', 92.55
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0443241296' AND csb_number = '15246');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0445325102', '13657', '2026-03-26', 2054.61, 22.2, 'USD', 92.55
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0445325102' AND csb_number = '13657');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0443952312', '14183', '2026-04-01', 8496.09, 91.8, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0443952312' AND csb_number = '14183');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0443598929', '16223', '2026-04-07', 4199.76, 45.4, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0443598929' AND csb_number = '16223');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0445380936', '11404', '2026-04-11', 8399.52, 90.8, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0445380936' AND csb_number = '11404');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0419653824', '11103', '2026-04-17', 1945.15, 21, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0419653824' AND csb_number = '11103');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0405025832', '11101', '2026-04-17', 4597.63, 49.7, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0405025832' AND csb_number = '11101');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0414489244', '16213', '2026-04-17', 2661.69, 28.8, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0414489244' AND csb_number = '16213');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0412240050', '12550', '2026-04-22', 2064.6, 22.3, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0412240050' AND csb_number = '12550');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0405914265', '12549', '2026-04-22', 1554, 16.8, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0405914265' AND csb_number = '12549');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0439039835', '12027', '2026-04-24', 3021.98, 32.7, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0439039835' AND csb_number = '12027');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0408187877', '11642', '2026-05-02', 1328.3, 14.4, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0408187877' AND csb_number = '11642');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0402376889', '13977', '2026-05-07', 6903.28, 74.6, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0402376889' AND csb_number = '13977');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0422150049', '12716', '2026-05-10', 2730.6, 29.5, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0422150049' AND csb_number = '12716');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0429182056', '12717', '2026-05-10', 2819.4, 30.5, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0429182056' AND csb_number = '12717');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0434779867', '12719', '2026-05-10', 3729.6, 40.3, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0434779867' AND csb_number = '12719');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0427107471', '17347', '2026-05-10', 2064.6, 22.3, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0427107471' AND csb_number = '17347');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0429448886', '12718', '2026-05-10', 1422.65, 15.4, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0429448886' AND csb_number = '12718');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0429808095', '14069', '2026-05-12', 9306.69, 100.6, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0429808095' AND csb_number = '14069');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0412037299', '13324', '2026-05-14', 4170.67, 45.1, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0412037299' AND csb_number = '13324');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0438509105', '13613', '2026-05-16', 1770.88, 19.1, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0438509105' AND csb_number = '13613');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0433795912', '13612', '2026-05-16', 9598.25, 103.8, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0433795912' AND csb_number = '13612');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '872022037231', '19828', '2026-05-21', 42052.5, 450, 'USD', 93.45
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '872022037231' AND csb_number = '19828');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0446059416', '15378', '2026-05-22', 3766.97, 40.7, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0446059416' AND csb_number = '15378');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0448251230', '14510', '2026-05-27', 4278.35, 46.3, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0448251230' AND csb_number = '14510');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0448583640', '12258', '2026-05-26', 7043.5, 76.1, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0448583640' AND csb_number = '12258');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0435432523', '14509', '2026-05-27', 3844.51, 41.6, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0435432523' AND csb_number = '14509');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0414565107', '14508', '2026-05-27', 6839.46, 73.9, 'USD', 92.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0414565107' AND csb_number = '14508');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '872427633051', '13408', '2026-05-31', 3423.06, 35.9, 'USD', 95.35
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '872427633051' AND csb_number = '13408');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '872427544972', '13410', '2026-05-31', 11729, 123, 'USD', 95.35
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '872427544972' AND csb_number = '13410');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0446221463', '12923', '2026-05-31', 5991.79, 62.8, 'USD', 95.35
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0446221463' AND csb_number = '12923');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '872729776985', '10760', '2026-06-08', 45460.9, 479, 'USD', 94.9
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '872729776985' AND csb_number = '10760');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '872730570790', '10757', '2026-06-08', 6643, 70, 'USD', 94.9
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '872730570790' AND csb_number = '10757');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '872731396416', '10756', '2026-06-08', 18846.19, 198.6, 'USD', 94.9
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '872731396416' AND csb_number = '10756');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '872769760340', '22398', '2026-06-09', 96.72, 96.7, 'USD', 1
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '872769760340' AND csb_number = '22398');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '872770465586', '22347', '2026-06-09', 17764.33, 187.2, 'USD', 94.9
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '872770465586' AND csb_number = '22347');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0426302930', '16837', '2026-06-11', 2882.11, 30.4, 'USD', 94.9
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0426302930' AND csb_number = '16837');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0422011145', '17487', '2026-06-12', 3882.36, 40.9, 'USD', 94.9
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0422011145' AND csb_number = '17487');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '873065009193', '22285', '2026-06-17', 15283.65, 161.1, 'USD', 94.9
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '873065009193' AND csb_number = '22285');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '1Z0G054Y0448412744', '13175', '2026-06-23', 2762.14, 29.5, 'USD', 93.6
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '1Z0G054Y0448412744' AND csb_number = '13175');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '873428886226', '14760', '2026-06-24', 29837.81, 318.8, 'USD', 93.6
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '873428886226' AND csb_number = '14760');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '873429350950', '14790', '2026-06-24', 13352.04, 142.7, 'USD', 93.6
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '873429350950' AND csb_number = '14790');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '873479741858', '15492', '2026-06-25', 10500.98, 112.2, 'USD', 93.6
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '873479741858' AND csb_number = '15492');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '873482163808', '15398', '2026-06-25', 4463.78, 47.7, 'USD', 93.6
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '873482163808' AND csb_number = '15398');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '873648078245', '14877', '2026-06-28', 3537.14, 37.8, 'USD', 93.6
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '873648078245' AND csb_number = '14877');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '873648678296', '14920', '2026-06-28', 5221.94, 55.8, 'USD', 93.6
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '873648678296' AND csb_number = '14920');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '874348503764', '16092', '2026-07-15', 4675, 50, 'USD', 93.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '874348503764' AND csb_number = '16092');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '874355067281', '15958', '2026-07-15', 10948.85, 117.1, 'USD', 93.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '874355067281' AND csb_number = '15958');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '874356380170', '15986', '2026-07-15', 20912.21, 223.7, 'USD', 93.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '874356380170' AND csb_number = '15986');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '874357218384', '15936', '2026-07-15', 13218.1, 141.4, 'USD', 93.5
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '874357218384' AND csb_number = '15936');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '874562932348', '16516', '2026-07-19', 14661.12, 153.6, 'USD', 95.45
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '874562932348' AND csb_number = '16516');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '874563211645', '16580', '2026-07-19', 3665.28, 38.4, 'USD', 95.45
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '874563211645' AND csb_number = '16580');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '874563490733', '16495', '2026-07-19', 7330.56, 76.8, 'USD', 95.45
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '874563490733' AND csb_number = '16495');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '874599544072', '15841', '2026-07-21', 3608.01, 37.8, 'USD', 95.45
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '874599544072' AND csb_number = '15841');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '874600236327', '15851', '2026-07-21', 16762.93, 175.6, 'USD', 95.45
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '874600236327' AND csb_number = '15851');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '874967737439', '17779', '2026-07-29', 11167.65, 117, 'USD', 95.45
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '874967737439' AND csb_number = '17779');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '875033538890', '18608', '2026-07-30', 20146.63, 211.1, 'USD', 95.45
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '875033538890' AND csb_number = '18608');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '874830939507', '14755', '2026-07-25', 16975.78, 177.9, 'USD', 95.45
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '874830939507' AND csb_number = '14755');

INSERT INTO csb_filings (hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, taxable_value_currency, exchange_rate)
SELECT '874831532910', '14659', '2026-07-25', 36074.37, 377.9, 'USD', 95.45
WHERE NOT EXISTS (SELECT 1 FROM csb_filings WHERE hawb_number = '874831532910' AND csb_number = '14659');

COMMIT;

-- Verification (run after commit):
-- select count(*) from csb_filings;  -- expect 71
-- select hawb_number, csb_number, filing_date, fob_value_inr, total_taxable_value, exchange_rate from csb_filings order by filing_date;