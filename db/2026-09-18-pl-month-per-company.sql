-- 2026-09-18 — "p&l by month sabhi company ka ek sath aara hai kya ... moth
-- vise bhi alag company ke hisab se aayega" — the month view previously
-- aggregated ALL companies together into one number per month, which the
-- user flagged as wrong. This rebuilds pl_dashboard_by_month_view with a
-- company_id/company_name column pair (every aggregation CTE now groups by
-- company_id + month) so the CRM page can filter the month table by the
-- company switcher, same as every other company-scoped widget.
--
-- NOT CREATE OR REPLACE — DROP + CREATE, exactly like the 2026-09-17 P&L
-- file: the new company_id/company_name columns sit at the FRONT of the
-- column list and Postgres's CREATE OR REPLACE VIEW may only APPEND
-- columns (it can never insert/reorder/rename), so OR REPLACE would fail
-- with the same 42P16 the user already hit once in Supabase. Views hold no
-- data — nothing is lost by the drop.
--
-- Drop order matters on a re-run: dependents first (the month view is
-- built AFTER the company view here but nothing depends on the month
-- view), so a plain IF EXISTS pair is enough. freight_awb_net_view /
-- duty_awb_net_view are NOT dropped — the later file owns them and this
-- change doesn't touch their shape.
--
-- Re-runnable: DROP IF EXISTS + full CREATE. Running twice is a no-op-ish
-- rebuild — safe.
--
-- Historical months (sale_profit_ledger rows with order_id IS NULL) keep
-- company_id from the ledger row itself, same column the live orders path
-- uses, so both halves group consistently.

DROP VIEW IF EXISTS pl_dashboard_by_month_view;

CREATE VIEW pl_dashboard_by_month_view AS
WITH months AS (
  SELECT company_id, date_trunc('month', order_date)::date AS month
  FROM orders WHERE status <> 'Cancelled'
  UNION
  SELECT company_id, date_trunc('month', vendor_invoice_date)::date FROM purchase_bills WHERE vendor_invoice_date IS NOT NULL
  UNION
  SELECT company_id, date_trunc('month', chalan_date)::date FROM washing_entries
  UNION
  SELECT company_id, date_trunc('month', invoice_date)::date FROM sale_profit_ledger WHERE order_id IS NULL AND invoice_date IS NOT NULL
  UNION
  SELECT company_id, date_trunc('month', expense_date)::date FROM internal_expenses
),
order_refund_totals AS (
  SELECT order_id, SUM(refund_amount_inr) AS refund_total_inr
  FROM order_refunds
  GROUP BY order_id
),
courier_agg AS (
  SELECT o.company_id,
    date_trunc('month', o.order_date)::date AS month,
    SUM(COALESCE(fn.net_shipping_amt, 0)) AS courier_net_inr,
    SUM(COALESCE(dn.net_duty_amt, 0))     AS duty_net_inr
  FROM orders o
  LEFT JOIN freight_awb_net_view fn ON fn.order_id = o.id
  LEFT JOIN duty_awb_net_view   dn ON dn.order_id = o.id
  WHERE o.status <> 'Cancelled'
  GROUP BY o.company_id, date_trunc('month', o.order_date)
),
order_agg AS (
  SELECT o.company_id,
    date_trunc('month', o.order_date)::date AS month,
    SUM(o.order_value_inr - COALESCE(ort.refund_total_inr, 0))         AS sale_inr,
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
  WHERE vendor_invoice_date IS NOT NULL
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
  SELECT o.id AS order_id,
    o.company_id,
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
  SELECT o.id AS order_id,
    o.company_id,
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
  SELECT o.id AS order_id,
    o.company_id,
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
    SELECT DISTINCT o.company_id, o.id, date_trunc('month', o.order_date)::date AS month
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
  SELECT bsl.company_id,
    date_trunc('month', bsl.txn_date)::date AS month,
    SUM(COALESCE(bsl.cr_amount, 0)) AS inflow_inr
  FROM bank_statement_lines bsl
  JOIN bank_recon_links brl ON brl.statement_line_id = bsl.id
  WHERE bsl.cr_amount IS NOT NULL AND bsl.txn_date IS NOT NULL
    AND brl.target_type IN ('order_sale', 'bill_payment', 'expense', 'salary_payment', 'card_expense')
  GROUP BY bsl.company_id, date_trunc('month', bsl.txn_date)
),
historical_agg AS (
  SELECT company_id, date_trunc('month', invoice_date)::date AS month,
    SUM(total_value_inr) AS hist_sale_inr, SUM(total_expenses_inr) AS hist_expense_inr
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
    m.company_id,
    m.month,
    COALESCE(oa.sale_inr, 0) + COALESCE(ha.hist_sale_inr, 0) AS total_sale_value_inr,
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
  FROM (SELECT DISTINCT company_id, month FROM months) m
  LEFT JOIN order_agg oa              ON oa.company_id = m.company_id AND oa.month = m.month
  LEFT JOIN purchase_agg pa           ON pa.company_id = m.company_id AND pa.month = m.month
  LEFT JOIN purchase_adjustments padj ON padj.company_id = m.company_id AND padj.month = m.month
  LEFT JOIN washing_agg wa            ON wa.company_id = m.company_id AND wa.month = m.month
  LEFT JOIN marketplace_fee_totals mf ON mf.company_id = m.company_id AND mf.month = m.month
  LEFT JOIN historical_agg ha         ON ha.company_id = m.company_id AND ha.month = m.month
  LEFT JOIN courier_agg ca            ON ca.company_id = m.company_id AND ca.month = m.month
  LEFT JOIN bank_inflow bi            ON bi.company_id = m.company_id AND bi.month = m.month
)
SELECT
  c.company_id,
  co.name AS company_name,
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
  c.bank_inflow_inr
FROM combined c
LEFT JOIN companies co ON co.id = c.company_id
LEFT JOIN expense_agg ea ON ea.company_id = c.company_id AND ea.month = c.month
ORDER BY c.month DESC;
COMMENT ON VIEW pl_dashboard_by_month_view IS
  '2026-09-18: per-COMPANY month rows — every aggregation groups by company_id + month so the CRM page can '
  'filter P&L by Month through the company switcher (was: all companies merged into one row per month). '
  'Portal REAL-IF-KNOWN and net-of-CN courier/duty unchanged from 2026-09-17 (late).';

-- ============================================================================
-- Verification:
-- ============================================================================
-- 1) Row count per company+month — should be one row per (company, month):
-- SELECT company_name, count(*) FROM pl_dashboard_by_month_view GROUP BY company_name;
-- 2) Cross-check one month's totals against the company view:
-- SELECT v.company_name, v.month, v.total_sale_value_inr, cv.total_sale_value_inr
-- FROM pl_dashboard_by_month_view v
-- JOIN pl_dashboard_by_company_view cv ON cv.company_id = v.company_id
-- WHERE v.month = date_trunc('month', CURRENT_DATE);
