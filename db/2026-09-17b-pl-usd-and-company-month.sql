-- 2026-09-17 (evening) — two P&L additions, both requested together:
--
-- 1) USD order value on P&L — "P&L me order value usd me bhi chahiye".
--    Both existing views (pl_dashboard_by_company_view,
--    pl_dashboard_by_month_view) get ONE new column, total_sale_value_usd,
--    computed the same way total_sale_value_inr already is (orders.order_
--    value_usd, netted against order_refunds.refund_amount_usd, plus the
--    historical CSV rows' sale_profit_ledger.sale_value_usd) — same
--    sources, same netting logic, just the USD sibling column. Added via
--    CREATE OR REPLACE VIEW, appending the new column at the very END of
--    each SELECT list (Postgres only allows CREATE OR REPLACE to APPEND
--    columns, never insert/reorder — see the 2026-09-17 (late) file's own
--    header note on error 42P16). Every existing column, in the same
--    order, is untouched — nothing that already reads these views breaks.
--
-- 2) P&L by Company, with an FY filter — "P&L by Company (FY add karna
--    hai)". The existing company view is an all-time, one-row-per-company
--    COMPARISON table by design (see its own comment); the existing month
--    view has months but no per-company split. Neither can answer "this
--    company, this FY" on its own. New view pl_dashboard_by_company_month_
--    view: the SAME metrics as both existing views, grouped by
--    (company_id, month) — the CRM page sums the FY's months per company
--    in application code (the exact same FY-window pattern the P&L by
--    Month FY selector already uses), so no further SQL is needed to add
--    more FY logic later.
--
--    This view's CTEs mirror pl_dashboard_by_month_view's CTEs 1:1 (same
--    joins, same NET-of-credit-notes courier/duty logic, same real-if-
--    known portal fee model) with company_id carried through every GROUP
--    BY — every source table already has its own company_id column
--    (orders, purchase_bills, washing_entries, bank_statement_lines,
--    internal_expenses, sale_profit_ledger, bill_pass_register), so this
--    is additive grouping, not new business logic. The verification
--    queries at the bottom check this view's own numbers reconcile back
--    to the two existing views' — run them after applying, before trusting
--    this for real reporting.
--
-- Run this AFTER db/2026-09-17-pl-cn-allocation-and-portal-real.sql (that
-- file must already be live — this one only appends to what it created).
-- Safe to re-run: the two ALTERs are OR REPLACE (idempotent), the new
-- view's CREATE is preceded by DROP IF EXISTS.

-- ============================================================================
-- 1. USD column on pl_dashboard_by_company_view
-- ============================================================================
CREATE OR REPLACE VIEW pl_dashboard_by_company_view AS
WITH order_refund_totals AS (
  SELECT order_id,
    SUM(refund_amount_inr) AS refund_total_inr,
    SUM(refund_amount_usd) AS refund_total_usd
  FROM order_refunds
  GROUP BY order_id
),
courier_agg AS (
  SELECT o.company_id,
    SUM(COALESCE(fn.net_shipping_amt, 0)) FILTER (WHERE o.status <> 'Cancelled') AS courier_net_inr,
    SUM(COALESCE(dn.net_duty_amt, 0))     FILTER (WHERE o.status <> 'Cancelled') AS duty_net_inr
  FROM orders o
  LEFT JOIN freight_awb_net_view fn ON fn.order_id = o.id
  LEFT JOIN duty_awb_net_view   dn ON dn.order_id = o.id
  WHERE o.status <> 'Cancelled'
  GROUP BY o.company_id
),
order_agg AS (
  SELECT o.company_id,
    SUM(o.order_value_inr - COALESCE(ort.refund_total_inr, 0)) FILTER (WHERE o.status <> 'Cancelled') AS total_sale_value_inr,
    SUM(o.order_value_usd - COALESCE(ort.refund_total_usd, 0)) FILTER (WHERE o.status <> 'Cancelled') AS total_sale_value_usd,
    SUM(COALESCE(fn.net_shipping_amt,0) + COALESCE(dn.net_duty_amt,0)) FILTER (WHERE o.status <> 'Cancelled') AS order_expenses_inr
  FROM orders o
  LEFT JOIN freight_awb_net_view fn ON fn.order_id = o.id
  LEFT JOIN duty_awb_net_view   dn ON dn.order_id = o.id
  LEFT JOIN order_refund_totals ort ON ort.order_id = o.id
  WHERE o.status <> 'Cancelled'
  GROUP BY o.company_id
),
purchase_agg AS (
  SELECT company_id, SUM(g_total_plus_gst) AS purchase_expenses_gross_inr
  FROM purchase_bills
  WHERE company_id IS NOT NULL
  GROUP BY company_id
),
purchase_adjustments AS (
  SELECT bpr.company_id, SUM(a.amount) AS adjustment_total_inr
  FROM bill_pass_register_adjustments a
  JOIN bill_pass_register bpr ON bpr.id = a.bill_pass_register_id
  WHERE bpr.source = 'purchase_bill'
  GROUP BY bpr.company_id
),
washing_agg AS (
  SELECT company_id, SUM(COALESCE(amount, 0) + COALESCE(debit_charges, 0)) AS washing_inr
  FROM washing_entries
  GROUP BY company_id
),
etsy_fee_by_order AS (
  SELECT o.id AS order_id, SUM(-COALESCE(e.fees_and_taxes, 0)) AS fees_inr
  FROM orders o
  JOIN etsy_ledger_lines e
    ON e.company_id = o.company_id
   AND e.order_number = btrim(regexp_replace(o.marketplace_order_no, '^\s*#+', ''))
  WHERE o.status <> 'Cancelled'
  GROUP BY o.id
),
ebay_fee_by_order AS (
  SELECT o.id AS order_id,
    SUM(COALESCE(b.total_amount, 0) * ru.rate_to_inr) AS fees_inr
  FROM orders o
  JOIN ebay_tax_invoice_lines b
    ON b.company_id = o.company_id
   AND b.order_number = btrim(regexp_replace(o.marketplace_order_no, '^\s*#+', ''))
  LEFT JOIN LATERAL get_official_rate_as_of(COALESCE(b.currency, 'USD'), COALESCE(b.txn_date, o.order_date, CURRENT_DATE)) ru ON true
  WHERE o.status <> 'Cancelled'
  GROUP BY o.id
),
amazon_fee_by_order AS (
  SELECT o.id AS order_id,
    SUM(COALESCE(a.amazon_fees, 0) * ra.rate_to_inr) AS fees_inr
  FROM orders o
  JOIN amazon_transactions a
    ON a.company_id = o.company_id
   AND a.order_id = btrim(regexp_replace(o.marketplace_order_no, '^\s*#+', ''))
  LEFT JOIN LATERAL get_official_rate_as_of(COALESCE(a.currency, 'USD'), COALESCE(a.txn_date, o.order_date, CURRENT_DATE)) ra ON true
  WHERE o.status <> 'Cancelled'
  GROUP BY o.id
),
marketplace_fee_totals AS (
  SELECT o.company_id,
    SUM(COALESCE(e.fees_inr, 0) + COALESCE(b.fees_inr, 0) + COALESCE(a.fees_inr, 0)) AS fees_matched_inr
  FROM orders o
  LEFT JOIN etsy_fee_by_order e    ON e.order_id = o.id
  LEFT JOIN ebay_fee_by_order b    ON b.order_id = o.id
  LEFT JOIN amazon_fee_by_order a  ON a.order_id = o.id
  WHERE o.status <> 'Cancelled'
    AND (e.order_id IS NOT NULL OR b.order_id IS NOT NULL OR a.order_id IS NOT NULL)
  GROUP BY o.company_id
),
bank_inflow AS (
  SELECT bsl.company_id,
    SUM(COALESCE(bsl.cr_amount, 0)) AS inflow_inr
  FROM bank_statement_lines bsl
  JOIN bank_recon_links brl ON brl.statement_line_id = bsl.id
  WHERE bsl.cr_amount IS NOT NULL
    AND brl.target_type IN ('order_sale', 'bill_payment', 'expense', 'salary_payment', 'card_expense')
  GROUP BY bsl.company_id
),
historical_agg AS (
  SELECT company_id,
    SUM(total_value_inr) AS hist_sale_inr,
    SUM(sale_value_usd) AS hist_sale_usd,
    SUM(total_expenses_inr) AS hist_expense_inr
  FROM sale_profit_ledger
  WHERE order_id IS NULL
  GROUP BY company_id
),
combined AS (
  SELECT
    c.id AS company_id, c.name AS company_name,
    COALESCE(oa.total_sale_value_inr,0) + COALESCE(ha.hist_sale_inr,0) AS total_sale_value_inr,
    COALESCE(oa.total_sale_value_usd,0) + COALESCE(ha.hist_sale_usd,0) AS total_sale_value_usd,
    COALESCE(oa.order_expenses_inr,0)
      + (COALESCE(pa.purchase_expenses_gross_inr,0) - COALESCE(padj.adjustment_total_inr,0))
      + COALESCE(wa.washing_inr, 0)
      + COALESCE(ha.hist_expense_inr,0) AS total_expenses_inr,
    COALESCE(ca.courier_net_inr, 0)             AS expense_courier_inr,
    COALESCE(ca.duty_net_inr, 0)                AS expense_duty_inr,
    COALESCE(pa.purchase_expenses_gross_inr, 0) AS expense_purchase_inr,
    -COALESCE(padj.adjustment_total_inr, 0)     AS expense_purchase_adjustments_inr,
    COALESCE(wa.washing_inr, 0)                 AS expense_washing_inr,
    COALESCE(ha.hist_expense_inr, 0)            AS expense_historical_inr,
    COALESCE(mf.fees_matched_inr, 0)            AS portal_fees_matched_inr,
    COALESCE(bi.inflow_inr, 0)                  AS bank_inflow_inr
  FROM companies c
  LEFT JOIN order_agg oa              ON oa.company_id = c.id
  LEFT JOIN purchase_agg pa           ON pa.company_id = c.id
  LEFT JOIN purchase_adjustments padj ON padj.company_id = c.id
  LEFT JOIN washing_agg wa            ON wa.company_id = c.id
  LEFT JOIN marketplace_fee_totals mf ON mf.company_id = c.id
  LEFT JOIN historical_agg ha         ON ha.company_id = c.id
  LEFT JOIN courier_agg ca            ON ca.company_id = c.id
  LEFT JOIN bank_inflow bi            ON bi.company_id = c.id
)
SELECT
  combined.company_id, company_name,
  total_sale_value_inr,
  total_expenses_inr,
  (total_sale_value_inr - total_expenses_inr)                          AS net_total_value,
  (total_sale_value_inr * 0.25)                                        AS portal_expenses_25pct,
  CASE WHEN portal_fees_matched_inr > 0 THEN portal_fees_matched_inr
       ELSE (total_sale_value_inr * 0.25) END                          AS portal_expense_effective_inr,
  ((total_sale_value_inr - total_expenses_inr)
     - CASE WHEN portal_fees_matched_inr > 0 THEN portal_fees_matched_inr
            ELSE (total_sale_value_inr * 0.25) END)                    AS net_earn,
  (((total_sale_value_inr - total_expenses_inr)
     - CASE WHEN portal_fees_matched_inr > 0 THEN portal_fees_matched_inr
            ELSE (total_sale_value_inr * 0.25) END) / NULLIF(total_sale_value_inr, 0)) AS profit_pct,
  COALESCE(ie.total_internal_expenses_inr, 0) AS total_internal_expenses_inr,
  (((total_sale_value_inr - total_expenses_inr)
     - CASE WHEN portal_fees_matched_inr > 0 THEN portal_fees_matched_inr
            ELSE (total_sale_value_inr * 0.25) END)
     - COALESCE(ie.total_internal_expenses_inr, 0)) AS net_earn_after_overhead,
  expense_courier_inr,
  expense_duty_inr,
  expense_purchase_inr,
  expense_purchase_adjustments_inr,
  expense_washing_inr,
  expense_historical_inr,
  portal_fees_matched_inr,
  bank_inflow_inr,
  total_sale_value_usd                                                  -- 2026-09-17 (evening): NEW, appended last
FROM combined
LEFT JOIN (
  SELECT company_id, SUM(amount_inr) AS total_internal_expenses_inr
  FROM internal_expenses GROUP BY company_id
) ie ON ie.company_id = combined.company_id;
COMMENT ON VIEW pl_dashboard_by_company_view IS
  '2026-09-17 (evening): + total_sale_value_usd (appended last — same netting as the INR column, '
  'via orders.order_value_usd / order_refunds.refund_amount_usd / sale_profit_ledger.sale_value_usd). '
  'History: see pl_dashboard_by_month_view''s comment for everything before this.';

-- ============================================================================
-- 2. USD column on pl_dashboard_by_month_view
-- ============================================================================
CREATE OR REPLACE VIEW pl_dashboard_by_month_view AS
WITH months AS (
  SELECT DISTINCT date_trunc('month', order_date)::date AS month FROM orders WHERE status <> 'Cancelled'
  UNION
  SELECT DISTINCT date_trunc('month', vendor_invoice_date)::date AS month FROM purchase_bills WHERE vendor_invoice_date IS NOT NULL
  UNION
  SELECT DISTINCT date_trunc('month', chalan_date)::date AS month FROM washing_entries
  UNION
  SELECT DISTINCT date_trunc('month', invoice_date)::date AS month FROM sale_profit_ledger WHERE order_id IS NULL AND invoice_date IS NOT NULL
  UNION
  SELECT DISTINCT date_trunc('month', expense_date)::date AS month FROM internal_expenses
),
order_refund_totals AS (
  SELECT order_id,
    SUM(refund_amount_inr) AS refund_total_inr,
    SUM(refund_amount_usd) AS refund_total_usd
  FROM order_refunds
  GROUP BY order_id
),
courier_agg AS (
  SELECT date_trunc('month', o.order_date)::date AS month,
    SUM(COALESCE(fn.net_shipping_amt, 0)) AS courier_net_inr,
    SUM(COALESCE(dn.net_duty_amt, 0))     AS duty_net_inr
  FROM orders o
  LEFT JOIN freight_awb_net_view fn ON fn.order_id = o.id
  LEFT JOIN duty_awb_net_view   dn ON dn.order_id = o.id
  WHERE o.status <> 'Cancelled'
  GROUP BY date_trunc('month', o.order_date)
),
order_agg AS (
  SELECT date_trunc('month', o.order_date)::date AS month,
    SUM(o.order_value_inr - COALESCE(ort.refund_total_inr, 0))                                 AS sale_inr,
    SUM(o.order_value_usd - COALESCE(ort.refund_total_usd, 0))                                 AS sale_usd,
    SUM(COALESCE(fn.net_shipping_amt,0) + COALESCE(dn.net_duty_amt,0))                         AS order_expense_inr
  FROM orders o
  LEFT JOIN freight_awb_net_view fn ON fn.order_id = o.id
  LEFT JOIN duty_awb_net_view   dn ON dn.order_id = o.id
  LEFT JOIN order_refund_totals ort ON ort.order_id = o.id
  WHERE o.status <> 'Cancelled'
  GROUP BY date_trunc('month', o.order_date)
),
purchase_agg AS (
  SELECT date_trunc('month', vendor_invoice_date)::date AS month, SUM(g_total_plus_gst) AS purchase_expense_gross_inr
  FROM purchase_bills
  WHERE vendor_invoice_date IS NOT NULL
  GROUP BY date_trunc('month', vendor_invoice_date)
),
purchase_adjustments AS (
  SELECT date_trunc('month', bpr.invoice_date)::date AS month, SUM(a.amount) AS adjustment_total_inr
  FROM bill_pass_register_adjustments a
  JOIN bill_pass_register bpr ON bpr.id = a.bill_pass_register_id
  WHERE bpr.source = 'purchase_bill' AND bpr.invoice_date IS NOT NULL
  GROUP BY date_trunc('month', bpr.invoice_date)
),
washing_agg AS (
  SELECT date_trunc('month', chalan_date)::date AS month,
    SUM(COALESCE(amount, 0) + COALESCE(debit_charges, 0)) AS washing_inr
  FROM washing_entries
  GROUP BY date_trunc('month', chalan_date)
),
etsy_fee_by_order AS (
  SELECT o.id AS order_id,
    date_trunc('month', o.order_date)::date AS month,
    SUM(-COALESCE(e.fees_and_taxes, 0)) AS fees_inr
  FROM orders o
  JOIN etsy_ledger_lines e
    ON e.company_id = o.company_id
   AND e.order_number = btrim(regexp_replace(o.marketplace_order_no, '^\s*#+', ''))
  WHERE o.status <> 'Cancelled'
  GROUP BY o.id, date_trunc('month', o.order_date)
),
ebay_fee_by_order AS (
  SELECT o.id AS order_id,
    date_trunc('month', o.order_date)::date AS month,
    SUM(COALESCE(b.total_amount, 0) * ru.rate_to_inr) AS fees_inr
  FROM orders o
  JOIN ebay_tax_invoice_lines b
    ON b.company_id = o.company_id
   AND b.order_number = btrim(regexp_replace(o.marketplace_order_no, '^\s*#+', ''))
  LEFT JOIN LATERAL get_official_rate_as_of(COALESCE(b.currency, 'USD'), COALESCE(b.txn_date, o.order_date, CURRENT_DATE)) ru ON true
  WHERE o.status <> 'Cancelled'
  GROUP BY o.id, date_trunc('month', o.order_date)
),
amazon_fee_by_order AS (
  SELECT o.id AS order_id,
    date_trunc('month', o.order_date)::date AS month,
    SUM(COALESCE(a.amazon_fees, 0) * ra.rate_to_inr) AS fees_inr
  FROM orders o
  JOIN amazon_transactions a
    ON a.company_id = o.company_id
   AND a.order_id = btrim(regexp_replace(o.marketplace_order_no, '^\s*#+', ''))
  LEFT JOIN LATERAL get_official_rate_as_of(COALESCE(a.currency, 'USD'), COALESCE(a.txn_date, o.order_date, CURRENT_DATE)) ra ON true
  WHERE o.status <> 'Cancelled'
  GROUP BY o.id, date_trunc('month', o.order_date)
),
marketplace_fee_totals AS (
  SELECT om.month,
    SUM(COALESCE(e.fees_inr, 0) + COALESCE(b.fees_inr, 0) + COALESCE(a.fees_inr, 0)) AS fees_matched_inr
  FROM (
    SELECT DISTINCT o.id, date_trunc('month', o.order_date)::date AS month
    FROM orders o
    WHERE o.status <> 'Cancelled'
  ) om
  LEFT JOIN etsy_fee_by_order e    ON e.order_id = om.id
  LEFT JOIN ebay_fee_by_order b    ON b.order_id = om.id
  LEFT JOIN amazon_fee_by_order a  ON a.order_id = om.id
  WHERE e.order_id IS NOT NULL OR b.order_id IS NOT NULL OR a.order_id IS NOT NULL
  GROUP BY om.month
),
bank_inflow AS (
  SELECT date_trunc('month', bsl.txn_date)::date AS month,
    SUM(COALESCE(bsl.cr_amount, 0)) AS inflow_inr
  FROM bank_statement_lines bsl
  JOIN bank_recon_links brl ON brl.statement_line_id = bsl.id
  WHERE bsl.cr_amount IS NOT NULL AND bsl.txn_date IS NOT NULL
    AND brl.target_type IN ('order_sale', 'bill_payment', 'expense', 'salary_payment', 'card_expense')
  GROUP BY date_trunc('month', bsl.txn_date)
),
historical_agg AS (
  SELECT date_trunc('month', invoice_date)::date AS month,
    SUM(total_value_inr) AS hist_sale_inr,
    SUM(sale_value_usd) AS hist_sale_usd,
    SUM(total_expenses_inr) AS hist_expense_inr
  FROM sale_profit_ledger
  WHERE order_id IS NULL AND invoice_date IS NOT NULL
  GROUP BY date_trunc('month', invoice_date)
),
expense_agg AS (
  SELECT date_trunc('month', expense_date)::date AS month, SUM(amount_inr) AS total_internal_expenses_inr
  FROM internal_expenses
  GROUP BY date_trunc('month', expense_date)
),
combined AS (
  SELECT
    m.month,
    COALESCE(oa.sale_inr, 0) + COALESCE(ha.hist_sale_inr, 0) AS total_sale_value_inr,
    COALESCE(oa.sale_usd, 0) + COALESCE(ha.hist_sale_usd, 0) AS total_sale_value_usd,
    COALESCE(oa.order_expense_inr, 0)
      + (COALESCE(pa.purchase_expense_gross_inr, 0) - COALESCE(padj.adjustment_total_inr, 0))
      + COALESCE(wa.washing_inr, 0)
      + COALESCE(ha.hist_expense_inr, 0) AS total_expenses_inr,
    COALESCE(ca.courier_net_inr, 0)   AS expense_courier_inr,
    COALESCE(ca.duty_net_inr, 0)      AS expense_duty_inr,
    COALESCE(pa.purchase_expense_gross_inr, 0) AS expense_purchase_inr,
    -COALESCE(padj.adjustment_total_inr, 0)    AS expense_purchase_adjustments_inr,
    COALESCE(wa.washing_inr, 0)                AS expense_washing_inr,
    COALESCE(ha.hist_expense_inr, 0)           AS expense_historical_inr,
    COALESCE(mf.fees_matched_inr, 0)           AS portal_fees_matched_inr,
    COALESCE(bi.inflow_inr, 0)                 AS bank_inflow_inr
  FROM months m
  LEFT JOIN order_agg oa              ON oa.month = m.month
  LEFT JOIN purchase_agg pa           ON pa.month = m.month
  LEFT JOIN purchase_adjustments padj ON padj.month = m.month
  LEFT JOIN washing_agg wa            ON wa.month = m.month
  LEFT JOIN marketplace_fee_totals mf ON mf.month = m.month
  LEFT JOIN historical_agg ha         ON ha.month = m.month
  LEFT JOIN courier_agg ca            ON ca.month = m.month
  LEFT JOIN bank_inflow bi            ON bi.month = m.month
)
SELECT
  c.month,
  c.total_sale_value_inr,
  c.total_expenses_inr,
  (c.total_sale_value_inr * 0.25) AS portal_expenses_25pct,
  CASE WHEN c.portal_fees_matched_inr > 0 THEN c.portal_fees_matched_inr
       ELSE (c.total_sale_value_inr * 0.25) END AS portal_expense_effective_inr,
  ((c.total_sale_value_inr - c.total_expenses_inr)
     - CASE WHEN c.portal_fees_matched_inr > 0 THEN c.portal_fees_matched_inr
            ELSE (c.total_sale_value_inr * 0.25) END) AS net_earn,
  (((c.total_sale_value_inr - c.total_expenses_inr)
     - CASE WHEN c.portal_fees_matched_inr > 0 THEN c.portal_fees_matched_inr
            ELSE (c.total_sale_value_inr * 0.25) END) / NULLIF(c.total_sale_value_inr, 0)) AS profit_pct,
  COALESCE(ea.total_internal_expenses_inr, 0) AS total_internal_expenses_inr,
  (((c.total_sale_value_inr - c.total_expenses_inr)
     - CASE WHEN c.portal_fees_matched_inr > 0 THEN c.portal_fees_matched_inr
            ELSE (c.total_sale_value_inr * 0.25) END)
     - COALESCE(ea.total_internal_expenses_inr, 0)) AS net_earn_after_overhead,
  c.expense_courier_inr,
  c.expense_duty_inr,
  c.expense_purchase_inr,
  c.expense_purchase_adjustments_inr,
  c.expense_washing_inr,
  c.expense_historical_inr,
  c.portal_fees_matched_inr,
  c.bank_inflow_inr,
  c.total_sale_value_usd                                                -- 2026-09-17 (evening): NEW, appended last
FROM combined c
LEFT JOIN expense_agg ea ON ea.month = c.month
ORDER BY c.month DESC;
COMMENT ON VIEW pl_dashboard_by_month_view IS
  '2026-09-17 (evening): + total_sale_value_usd (appended last). History: 2026-09-17 (late) — '
  'portal expense REAL-IF-KNOWN, courier/duty NET of CNs; see that migration''s comment.';

-- ============================================================================
-- 3. NEW: pl_dashboard_by_company_month_view — P&L by Company, FY-filterable
-- ============================================================================
-- Same shape as pl_dashboard_by_month_view (one row per month) PLUS
-- company_id/company_name, so the CRM page can sum an FY's worth of months
-- per company in JS (exactly like the existing P&L-by-Month FY selector
-- already sums plMonthRowsFiltered) to answer "this company, this FY".
DROP VIEW IF EXISTS pl_dashboard_by_company_month_view;
CREATE VIEW pl_dashboard_by_company_month_view AS
WITH company_months AS (
  SELECT DISTINCT company_id, date_trunc('month', order_date)::date AS month FROM orders WHERE status <> 'Cancelled'
  UNION
  SELECT DISTINCT company_id, date_trunc('month', vendor_invoice_date)::date AS month FROM purchase_bills WHERE vendor_invoice_date IS NOT NULL AND company_id IS NOT NULL
  UNION
  SELECT DISTINCT company_id, date_trunc('month', chalan_date)::date AS month FROM washing_entries
  UNION
  SELECT DISTINCT company_id, date_trunc('month', invoice_date)::date AS month FROM sale_profit_ledger WHERE order_id IS NULL AND invoice_date IS NOT NULL
  UNION
  SELECT DISTINCT company_id, date_trunc('month', expense_date)::date AS month FROM internal_expenses
),
order_refund_totals AS (
  SELECT order_id,
    SUM(refund_amount_inr) AS refund_total_inr,
    SUM(refund_amount_usd) AS refund_total_usd
  FROM order_refunds
  GROUP BY order_id
),
courier_agg AS (
  SELECT o.company_id, date_trunc('month', o.order_date)::date AS month,
    SUM(COALESCE(fn.net_shipping_amt, 0)) AS courier_net_inr,
    SUM(COALESCE(dn.net_duty_amt, 0))     AS duty_net_inr
  FROM orders o
  LEFT JOIN freight_awb_net_view fn ON fn.order_id = o.id
  LEFT JOIN duty_awb_net_view   dn ON dn.order_id = o.id
  WHERE o.status <> 'Cancelled'
  GROUP BY o.company_id, date_trunc('month', o.order_date)
),
order_agg AS (
  SELECT o.company_id, date_trunc('month', o.order_date)::date AS month,
    SUM(o.order_value_inr - COALESCE(ort.refund_total_inr, 0)) AS sale_inr,
    SUM(o.order_value_usd - COALESCE(ort.refund_total_usd, 0)) AS sale_usd,
    SUM(COALESCE(fn.net_shipping_amt,0) + COALESCE(dn.net_duty_amt,0)) AS order_expense_inr
  FROM orders o
  LEFT JOIN freight_awb_net_view fn ON fn.order_id = o.id
  LEFT JOIN duty_awb_net_view   dn ON dn.order_id = o.id
  LEFT JOIN order_refund_totals ort ON ort.order_id = o.id
  WHERE o.status <> 'Cancelled'
  GROUP BY o.company_id, date_trunc('month', o.order_date)
),
purchase_agg AS (
  SELECT company_id, date_trunc('month', vendor_invoice_date)::date AS month, SUM(g_total_plus_gst) AS purchase_expense_gross_inr
  FROM purchase_bills
  WHERE vendor_invoice_date IS NOT NULL AND company_id IS NOT NULL
  GROUP BY company_id, date_trunc('month', vendor_invoice_date)
),
purchase_adjustments AS (
  SELECT bpr.company_id, date_trunc('month', bpr.invoice_date)::date AS month, SUM(a.amount) AS adjustment_total_inr
  FROM bill_pass_register_adjustments a
  JOIN bill_pass_register bpr ON bpr.id = a.bill_pass_register_id
  WHERE bpr.source = 'purchase_bill' AND bpr.invoice_date IS NOT NULL
  GROUP BY bpr.company_id, date_trunc('month', bpr.invoice_date)
),
washing_agg AS (
  SELECT company_id, date_trunc('month', chalan_date)::date AS month,
    SUM(COALESCE(amount, 0) + COALESCE(debit_charges, 0)) AS washing_inr
  FROM washing_entries
  GROUP BY company_id, date_trunc('month', chalan_date)
),
etsy_fee_by_order AS (
  SELECT o.id AS order_id, o.company_id,
    date_trunc('month', o.order_date)::date AS month,
    SUM(-COALESCE(e.fees_and_taxes, 0)) AS fees_inr
  FROM orders o
  JOIN etsy_ledger_lines e
    ON e.company_id = o.company_id
   AND e.order_number = btrim(regexp_replace(o.marketplace_order_no, '^\s*#+', ''))
  WHERE o.status <> 'Cancelled'
  GROUP BY o.id, o.company_id, date_trunc('month', o.order_date)
),
ebay_fee_by_order AS (
  SELECT o.id AS order_id, o.company_id,
    date_trunc('month', o.order_date)::date AS month,
    SUM(COALESCE(b.total_amount, 0) * ru.rate_to_inr) AS fees_inr
  FROM orders o
  JOIN ebay_tax_invoice_lines b
    ON b.company_id = o.company_id
   AND b.order_number = btrim(regexp_replace(o.marketplace_order_no, '^\s*#+', ''))
  LEFT JOIN LATERAL get_official_rate_as_of(COALESCE(b.currency, 'USD'), COALESCE(b.txn_date, o.order_date, CURRENT_DATE)) ru ON true
  WHERE o.status <> 'Cancelled'
  GROUP BY o.id, o.company_id, date_trunc('month', o.order_date)
),
amazon_fee_by_order AS (
  SELECT o.id AS order_id, o.company_id,
    date_trunc('month', o.order_date)::date AS month,
    SUM(COALESCE(a.amazon_fees, 0) * ra.rate_to_inr) AS fees_inr
  FROM orders o
  JOIN amazon_transactions a
    ON a.company_id = o.company_id
   AND a.order_id = btrim(regexp_replace(o.marketplace_order_no, '^\s*#+', ''))
  LEFT JOIN LATERAL get_official_rate_as_of(COALESCE(a.currency, 'USD'), COALESCE(a.txn_date, o.order_date, CURRENT_DATE)) ra ON true
  WHERE o.status <> 'Cancelled'
  GROUP BY o.id, o.company_id, date_trunc('month', o.order_date)
),
marketplace_fee_totals AS (
  SELECT om.company_id, om.month,
    SUM(COALESCE(e.fees_inr, 0) + COALESCE(b.fees_inr, 0) + COALESCE(a.fees_inr, 0)) AS fees_matched_inr
  FROM (
    SELECT DISTINCT o.id, o.company_id, date_trunc('month', o.order_date)::date AS month
    FROM orders o
    WHERE o.status <> 'Cancelled'
  ) om
  LEFT JOIN etsy_fee_by_order e    ON e.order_id = om.id
  LEFT JOIN ebay_fee_by_order b    ON b.order_id = om.id
  LEFT JOIN amazon_fee_by_order a  ON a.order_id = om.id
  WHERE e.order_id IS NOT NULL OR b.order_id IS NOT NULL OR a.order_id IS NOT NULL
  GROUP BY om.company_id, om.month
),
bank_inflow AS (
  SELECT bsl.company_id, date_trunc('month', bsl.txn_date)::date AS month,
    SUM(COALESCE(bsl.cr_amount, 0)) AS inflow_inr
  FROM bank_statement_lines bsl
  JOIN bank_recon_links brl ON brl.statement_line_id = bsl.id
  WHERE bsl.cr_amount IS NOT NULL AND bsl.txn_date IS NOT NULL
    AND brl.target_type IN ('order_sale', 'bill_payment', 'expense', 'salary_payment', 'card_expense')
  GROUP BY bsl.company_id, date_trunc('month', bsl.txn_date)
),
historical_agg AS (
  SELECT company_id, date_trunc('month', invoice_date)::date AS month,
    SUM(total_value_inr) AS hist_sale_inr,
    SUM(sale_value_usd) AS hist_sale_usd,
    SUM(total_expenses_inr) AS hist_expense_inr
  FROM sale_profit_ledger
  WHERE order_id IS NULL AND invoice_date IS NOT NULL
  GROUP BY company_id, date_trunc('month', invoice_date)
),
expense_agg AS (
  SELECT company_id, date_trunc('month', expense_date)::date AS month, SUM(amount_inr) AS total_internal_expenses_inr
  FROM internal_expenses
  GROUP BY company_id, date_trunc('month', expense_date)
),
combined AS (
  SELECT
    cm.company_id, cm.month,
    COALESCE(oa.sale_inr, 0) + COALESCE(ha.hist_sale_inr, 0) AS total_sale_value_inr,
    COALESCE(oa.sale_usd, 0) + COALESCE(ha.hist_sale_usd, 0) AS total_sale_value_usd,
    COALESCE(oa.order_expense_inr, 0)
      + (COALESCE(pa.purchase_expense_gross_inr, 0) - COALESCE(padj.adjustment_total_inr, 0))
      + COALESCE(wa.washing_inr, 0)
      + COALESCE(ha.hist_expense_inr, 0) AS total_expenses_inr,
    COALESCE(ca.courier_net_inr, 0)   AS expense_courier_inr,
    COALESCE(ca.duty_net_inr, 0)      AS expense_duty_inr,
    COALESCE(pa.purchase_expense_gross_inr, 0) AS expense_purchase_inr,
    -COALESCE(padj.adjustment_total_inr, 0)    AS expense_purchase_adjustments_inr,
    COALESCE(wa.washing_inr, 0)                AS expense_washing_inr,
    COALESCE(ha.hist_expense_inr, 0)           AS expense_historical_inr,
    COALESCE(mf.fees_matched_inr, 0)           AS portal_fees_matched_inr,
    COALESCE(bi.inflow_inr, 0)                 AS bank_inflow_inr
  FROM company_months cm
  LEFT JOIN order_agg oa              ON oa.company_id = cm.company_id AND oa.month = cm.month
  LEFT JOIN purchase_agg pa           ON pa.company_id = cm.company_id AND pa.month = cm.month
  LEFT JOIN purchase_adjustments padj ON padj.company_id = cm.company_id AND padj.month = cm.month
  LEFT JOIN washing_agg wa            ON wa.company_id = cm.company_id AND wa.month = cm.month
  LEFT JOIN marketplace_fee_totals mf ON mf.company_id = cm.company_id AND mf.month = cm.month
  LEFT JOIN historical_agg ha         ON ha.company_id = cm.company_id AND ha.month = cm.month
  LEFT JOIN courier_agg ca            ON ca.company_id = cm.company_id AND ca.month = cm.month
  LEFT JOIN bank_inflow bi            ON bi.company_id = cm.company_id AND bi.month = cm.month
)
SELECT
  c.company_id,
  comp.name AS company_name,
  c.month,
  c.total_sale_value_inr,
  c.total_sale_value_usd,
  c.total_expenses_inr,
  (c.total_sale_value_inr * 0.25) AS portal_expenses_25pct,
  CASE WHEN c.portal_fees_matched_inr > 0 THEN c.portal_fees_matched_inr
       ELSE (c.total_sale_value_inr * 0.25) END AS portal_expense_effective_inr,
  ((c.total_sale_value_inr - c.total_expenses_inr)
     - CASE WHEN c.portal_fees_matched_inr > 0 THEN c.portal_fees_matched_inr
            ELSE (c.total_sale_value_inr * 0.25) END) AS net_earn,
  (((c.total_sale_value_inr - c.total_expenses_inr)
     - CASE WHEN c.portal_fees_matched_inr > 0 THEN c.portal_fees_matched_inr
            ELSE (c.total_sale_value_inr * 0.25) END) / NULLIF(c.total_sale_value_inr, 0)) AS profit_pct,
  COALESCE(ea.total_internal_expenses_inr, 0) AS total_internal_expenses_inr,
  (((c.total_sale_value_inr - c.total_expenses_inr)
     - CASE WHEN c.portal_fees_matched_inr > 0 THEN c.portal_fees_matched_inr
            ELSE (c.total_sale_value_inr * 0.25) END)
     - COALESCE(ea.total_internal_expenses_inr, 0)) AS net_earn_after_overhead,
  c.expense_courier_inr,
  c.expense_duty_inr,
  c.expense_purchase_inr,
  c.expense_purchase_adjustments_inr,
  c.expense_washing_inr,
  c.expense_historical_inr,
  c.portal_fees_matched_inr,
  c.bank_inflow_inr
FROM combined c
JOIN companies comp ON comp.id = c.company_id
LEFT JOIN expense_agg ea ON ea.company_id = c.company_id AND ea.month = c.month
ORDER BY c.company_id, c.month DESC;
COMMENT ON VIEW pl_dashboard_by_company_month_view IS
  '2026-09-17 (evening): one row per (company, month) — same figures as pl_dashboard_by_company_view '
  'and pl_dashboard_by_month_view, just crossed so the CRM page can sum an FY''s months PER COMPANY '
  '(the FY-by-Company selector). Sum this view''s rows for one company across all its months and it '
  'should equal that company''s row in pl_dashboard_by_company_view (see verification query below).';

-- ============================================================================
-- Verification — run these after applying, compare against the two
-- existing views. Small mismatches (a few paise) can be floating-point
-- rounding across many rows; a mismatch bigger than that means something
-- in this file needs a second look before trusting the FY-by-Company view.
-- ============================================================================
-- 1) Sum-by-company-across-all-months should equal pl_dashboard_by_company_view:
-- SELECT cm.company_id, cm.company_name,
--        SUM(cm.total_sale_value_inr) AS summed_sale_inr,
--        cv.total_sale_value_inr      AS company_view_sale_inr,
--        SUM(cm.total_sale_value_inr) - cv.total_sale_value_inr AS diff
-- FROM pl_dashboard_by_company_month_view cm
-- JOIN pl_dashboard_by_company_view cv ON cv.company_id = cm.company_id
-- GROUP BY cm.company_id, cm.company_name, cv.total_sale_value_inr
-- ORDER BY ABS(SUM(cm.total_sale_value_inr) - cv.total_sale_value_inr) DESC;
--
-- 2) Sum-by-month-across-all-companies should equal pl_dashboard_by_month_view:
-- SELECT cm.month,
--        SUM(cm.total_sale_value_inr) AS summed_sale_inr,
--        mv.total_sale_value_inr      AS month_view_sale_inr,
--        SUM(cm.total_sale_value_inr) - mv.total_sale_value_inr AS diff
-- FROM pl_dashboard_by_company_month_view cm
-- JOIN pl_dashboard_by_month_view mv ON mv.month = cm.month
-- GROUP BY cm.month, mv.total_sale_value_inr
-- ORDER BY ABS(SUM(cm.total_sale_value_inr) - mv.total_sale_value_inr) DESC
-- LIMIT 20;
--
-- 3) USD sanity — a few real rows, eyeball that USD looks like INR/~83-85:
-- SELECT company_name, month, total_sale_value_inr, total_sale_value_usd
-- FROM pl_dashboard_by_company_month_view
-- ORDER BY month DESC LIMIT 10;
