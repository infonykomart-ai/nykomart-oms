-- 2026-08-12 (round 8): "YE COURIOR COMPANY KI DETAILS HAI" — bank details
-- for 7 courier companies (UPS, FedEx, Aramex, West Express, Shiprocket,
-- On Point, Delhivery). User confirmed these already exist in Party
-- Master under their short names from the original 37-party seed (see
-- claude/portal-payment-reconciliation-notes.md) — so this UPDATEs the
-- EXISTING rows by a fuzzy ILIKE match on name rather than inserting new
-- rows under the long legal names given here, to avoid creating duplicate
-- courier parties.
--
-- Requires db/2026-08-12-party-bank-details.sql to have been run FIRST
-- (adds the bank_name/account_no/ifsc_code columns this file writes to).
--
-- IMPORTANT: the ILIKE patterns below are a best-effort guess at each
-- courier's existing short name — if your live Party Master spells one
-- differently than expected, that UPDATE will simply match 0 rows (silent,
-- not an error). The final SELECT at the bottom lists every party row that
-- matched ANY pattern — run this whole file in the Supabase SQL Editor and
-- check that all 7 couriers appear in that result. Any missing from the
-- list needs its bank details added by hand (Party Master -> Edit) instead.

UPDATE parties SET bank_name = 'Standard Chartered Bank', account_no = '22205442397', ifsc_code = 'SCBL0036084'
  WHERE name ILIKE '%UPS%';

UPDATE parties SET bank_name = 'Bank of America', account_no = '72783015', ifsc_code = 'BOFA0MM6205'
  WHERE name ILIKE '%fedex%' OR name ILIKE '%fed ex%';

UPDATE parties SET bank_name = 'The Hong Kong and Shanghai Banking Corporation', account_no = '030537476002', ifsc_code = 'HSBC0400002'
  WHERE name ILIKE '%aramex%';

UPDATE parties SET bank_name = 'HDFC Bank Ltd, Gopal Bari, Jaipur', account_no = '99999828023134', ifsc_code = 'HDFC0007047'
  WHERE name ILIKE '%west%express%' OR name ILIKE '%westexpress%';

UPDATE parties SET bank_name = 'ICICI Bank', account_no = 'BFRS4782966', ifsc_code = 'ICIC0000104'
  WHERE name ILIKE '%ship%rocket%';

UPDATE parties SET bank_name = 'ICICI Bank Ltd., Sahkar Marg, Jaipur', account_no = '679005601344', ifsc_code = 'ICIC0006790'
  WHERE name ILIKE '%on%point%' OR name ILIKE '%onpoint%';

UPDATE parties SET bank_name = 'HDFC Bank', account_no = '12022320000801', ifsc_code = 'HDFC0001202'
  WHERE name ILIKE '%delhivery%';

-- Verification — every party row that matched any of the 7 patterns above.
-- Should show 7 rows (one per courier); fewer means a name didn't match
-- and needs a manual Party Master edit for that courier's bank details.
SELECT name, bank_name, account_no, ifsc_code
FROM parties
WHERE name ILIKE '%UPS%'
   OR name ILIKE '%fedex%' OR name ILIKE '%fed ex%'
   OR name ILIKE '%aramex%'
   OR name ILIKE '%west%express%' OR name ILIKE '%westexpress%'
   OR name ILIKE '%ship%rocket%'
   OR name ILIKE '%on%point%' OR name ILIKE '%onpoint%'
   OR name ILIKE '%delhivery%'
ORDER BY name;
