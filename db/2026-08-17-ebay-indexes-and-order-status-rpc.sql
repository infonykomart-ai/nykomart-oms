-- 2026-08-17 performance fixes (2 of the perf-audit's remaining findings)
--
-- 1) ebay_tax_invoice_lines had NO indexes beyond its primary key, unlike
--    its two sibling marketplace-ledger tables (etsy_ledger_lines,
--    amazon_transactions), which both already have a (company_id, date)
--    index and an order-number index. orders/page.tsx's eBay fee-matching
--    query (`.eq/.in("company_id", ...).in("order_number", ...)`) was
--    doing a full sequential scan of this table on every Orders hub page
--    load. Mirrors the exact index shape already used for the other two
--    tables (see db/schema.sql's etsy_ledger_lines / amazon_transactions
--    CREATE INDEX statements).
--
-- 2) crm/page.tsx pulled EVERY order row's `status` column for the current
--    company (no limit) just to count how many orders are in each status,
--    doing the GROUP BY in Node instead of the database. Harmless today at
--    current row counts, but scales badly (grows with total order count,
--    not with what's actually shown). get_order_status_counts() does the
--    same aggregation as a single indexed GROUP BY query instead —
--    idx_orders_status already exists (see db/schema.sql), so this is a
--    same-database-shape change, not a new index.
--
-- Both statements are idempotent (IF NOT EXISTS / CREATE OR REPLACE) —
-- safe to run again if this file is re-run by mistake.

CREATE INDEX IF NOT EXISTS idx_ebay_tax_company_date  ON ebay_tax_invoice_lines(company_id, txn_date);
CREATE INDEX IF NOT EXISTS idx_ebay_tax_order_number  ON ebay_tax_invoice_lines(order_number) WHERE order_number IS NOT NULL;

CREATE OR REPLACE FUNCTION get_order_status_counts(p_company_id uuid)
RETURNS TABLE (status order_status, cnt bigint)
LANGUAGE sql STABLE AS $$
  SELECT o.status, count(*)
  FROM orders o
  WHERE o.company_id = p_company_id
  GROUP BY o.status;
$$;
