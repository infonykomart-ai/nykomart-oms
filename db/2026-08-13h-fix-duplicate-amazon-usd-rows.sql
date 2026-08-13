-- Fix: USD Amazon transactions were imported TWICE (screenshot shows
-- 790 rows / fees_sum -28810.20 / total_sum 73778.52 — exactly double
-- the correct 395 rows / -14405.10 / 36889.26 verified earlier this
-- session directly from the real USD CSV). AUD (77 rows) and GBP (112
-- rows) in the same screenshot are correct — do NOT touch those.
--
-- This removes the extra copy of every duplicated USD row, keeping
-- exactly one copy of each. Safe to run even if you're not 100% sure
-- there are duplicates — it only deletes rows that are byte-for-byte
-- identical to another row already kept.

BEGIN;

-- Step 1 — sanity check BEFORE deleting: should show ~395 duplicate
-- groups (i.e. rows where the exact same data appears twice or more).
SELECT count(*) AS duplicate_groups, sum(cnt - 1) AS extra_rows_to_delete
FROM (
  SELECT company_id, txn_date, transaction_status, transaction_type, order_id,
         product_details, total_product_charges, total_promotional_rebates,
         amazon_fees, other, total_amount, currency, count(*) AS cnt
  FROM amazon_transactions
  WHERE company_id = (SELECT id FROM companies WHERE name = 'Nyko Mart')
    AND currency = 'USD'
  GROUP BY company_id, txn_date, transaction_status, transaction_type, order_id,
           product_details, total_product_charges, total_promotional_rebates,
           amazon_fees, other, total_amount, currency
  HAVING count(*) > 1
) d;

-- Step 2 — delete the extra copies, keeping the oldest (lowest ctid) row
-- from each duplicate group.
DELETE FROM amazon_transactions t
WHERE t.company_id = (SELECT id FROM companies WHERE name = 'Nyko Mart')
  AND t.currency = 'USD'
  AND t.ctid NOT IN (
    SELECT min(t2.ctid)
    FROM amazon_transactions t2
    WHERE t2.company_id = (SELECT id FROM companies WHERE name = 'Nyko Mart')
      AND t2.currency = 'USD'
    GROUP BY t2.company_id, t2.txn_date, t2.transaction_status, t2.transaction_type,
             t2.order_id, t2.product_details, t2.total_product_charges,
             t2.total_promotional_rebates, t2.amazon_fees, t2.other,
             t2.total_amount, t2.currency
  );

-- Step 3 — confirm: should now read 395 / -14405.10 / 36889.26 /
-- 2025-12-01 / 2026-08-12, matching AUD and GBP's already-correct pattern.
SELECT currency, count(*) AS rows, sum(amazon_fees) AS fees_sum, sum(total_amount) AS total_sum,
       min(txn_date) AS earliest, max(txn_date) AS latest
FROM amazon_transactions
WHERE company_id = (SELECT id FROM companies WHERE name = 'Nyko Mart')
  AND currency = 'USD'
GROUP BY currency;

COMMIT;
