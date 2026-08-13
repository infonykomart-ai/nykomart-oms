-- Read-only — run in Supabase SQL editor to see exactly what's actually
-- sitting in the database right now for Etsy Monthly Tax Invoices and
-- Amazon Transactions, with the EXPECTED numbers (re-derived by hand from
-- your real source files) written next to each query as a comment — just
-- compare what comes back against the comment.

-- ============================================================
-- ETSY — etsy_monthly_tax_invoices (loaded via the invoice SQL file)
-- ============================================================
-- EXPECT: 7 rows, Jan-Jul 2026, invoice_no's below, total_inr within a
-- few rupees of: 76591 / 44385 / 65546 / 61784 / 79946 / 47534 / 53982
SELECT invoice_no, invoice_date, period_from, period_to, subtotal_inr, gst_amount_inr, total_inr
FROM etsy_monthly_tax_invoices
WHERE company_id = (SELECT id FROM companies WHERE name = 'Nyko Mart')
  AND invoice_no IN ('887040947','905379983','932567858','957103440','976134559','998844310','1022384424')
ORDER BY invoice_date;
-- If this returns 0 rows: the invoice SQL file wasn't run yet (or was
-- run against the wrong company/database). If it returns rows but
-- total_inr looks very different from the numbers above: something
-- pasted wrong — re-run the SQL file fresh.

-- ============================================================
-- ETSY — etsy_ledger_lines (loaded via CSV Upload, Etsy Ledger template)
-- ============================================================
-- EXPECT: 7 CSVs' worth of rows (7 months, Jan-Jul 2026), all with
-- order_number auto-filled where the row belongs to an order.
SELECT count(*) AS total_rows, min(txn_date) AS earliest, max(txn_date) AS latest,
       count(*) FILTER (WHERE order_number IS NOT NULL) AS rows_with_order_number
FROM etsy_ledger_lines
WHERE company_id = (SELECT id FROM companies WHERE name = 'Nyko Mart');
-- If total_rows = 0: the Etsy Ledger CSVs (etsy_statement_2026_N.csv)
-- haven't been imported via CSV Upload yet — that's why the "🧾 Etsy
-- fees matched" link can't show on any order, regardless of the invoice
-- SQL above (that's a DIFFERENT table — invoices are the monthly summary,
-- ledger lines are the per-transaction detail the order-matching uses).

-- ============================================================
-- AMAZON — amazon_transactions (loaded via CSV Upload, per-country templates)
-- ============================================================
-- EXPECT exactly these 3 rows (re-derived by hand from your real CSVs —
-- not guessed):
--   GBP: 112 rows, fees sum -1729.85, total sum 2686.06,  dates 2025-12-02 .. 2026-08-13
--   USD: 395 rows, fees sum -14405.10, total sum 36889.26, dates 2025-12-01 .. 2026-08-12
--   AUD: 77 rows,  fees sum -4922.74, total sum 6284.50,  dates 2025-12-02 .. 2026-08-10
SELECT currency, count(*) AS rows, sum(amazon_fees) AS fees_sum, sum(total_amount) AS total_sum,
       min(txn_date) AS earliest, max(txn_date) AS latest
FROM amazon_transactions
WHERE company_id = (SELECT id FROM companies WHERE name = 'Nyko Mart')
GROUP BY currency
ORDER BY currency;
-- Compare each row against the EXPECT block above:
--  - Missing a currency entirely (e.g. no AUD row) -> that country's CSV
--    hasn't been imported yet.
--  - Row count matches but dates look shifted by roughly a month (e.g.
--    earliest/latest off by ~30 days) -> that file was imported using an
--    app build from BEFORE the "raw: true" date-corruption fix landed;
--    delete those rows and re-import the same CSV fresh.
--  - fees_sum / total_sum very different from EXPECT even though row
--    count matches -> numbers got mis-parsed; re-import.
DELETE FROM amazon_transactions
WHERE company_id = (SELECT id FROM companies WHERE name = 'Nyko Mart')
  AND false; -- <- change to a real currency filter (e.g. currency = 'AUD') and remove this comment ONLY if you need to wipe one country's rows before re-importing it. Left as a no-op (false) so this file can't accidentally delete anything by just being run.
