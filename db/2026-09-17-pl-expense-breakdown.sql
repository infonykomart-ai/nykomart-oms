-- 2026-09-17 — P&L expense breakdown ("jo jo expense huye vo sab aane
-- chahiye na jis se confirm ho ki kya kya kese kese ghataya jara").
--
-- WHAT: the two P&L views keep every existing column EXACTLY as-is, and
-- gain 5 new breakdown columns that show WHAT the single "Expenses (INR)"
-- number is actually made of:
--   expense_courier_inr             — per-order courier (freight reconciliation)
--   expense_duty_inr                — per-order duty (duty reconciliation)
--   expense_purchase_inr            — purchase bills (company-wide, GST-inclusive)
--   expense_purchase_adjustments_inr— Debit/Credit Note netting (shown negative)
--   expense_historical_inr          — pre-orders-table CSV ledger history
-- so total_expenses_inr = sum of the five, visible line by line instead of
-- one opaque number. The app adds columns to the EXACT RIGHT of the views
-- (safe: this app's queries use named .select() columns, not SELECT *).
--
-- Both views are CREATE OR REPLACE with the full original definition plus
-- the new columns, so this file is safe to re-run. No data changes — the
-- numbers themselves are untouched, only newly visible.

-- ============================================================================
-- 1. pl_dashboard_by_company_view — original columns preserved, 5 appended
-- ============================================================================
CREATE OR REPLACE VIEW pl_dashboard_by_company_view AS
WITH order_refund_totals AS (
  SELECT order_id, SUM(refund_amount_inr) AS refund_total_inr
  FROM order_refunds
  GROUP BY order_id
),
courier_agg AS (
  SELECT cd.company_id,
    SUM(COALESCE(cd.courier_expense_inr,0)) FILTER (WHERE o.status <> 'Cancelled') AS courier_inr,
    SUM(COALESCE(cd.duty_expense_inr,0))    FILTER (WHERE o.status <> 'Cancelled') AS duty_inr
  FROM orders o
  LEFT JOIN order_courier_duty_expense_view cd ON cd.order_id = o.id
  GROUP BY cd.company_id
),
order_agg AS (
  SELECT o.company_id,
    SUM(o.order_value_inr - COALESCE(ort.refund_total_inr, 0)) FILTER (WHERE o.status <> 'Cancelled')               AS total_sale_value_inr,
    SUM(COALESCE(cd.courier_expense_inr,0) + COALESCE(cd.duty_expense_inr,0)) FILTER (WHERE o.status <> 'Cancelled') AS order_expenses_inr
  FROM orders o
  LEFT JOIN order_courier_duty_expense_view cd ON cd.order_id = o.id
  LEFT JOIN order_refund_totals ort            ON ort.order_id = o.id
  GROUP BY o.company_id
),
purchase_agg AS (
  SELECT company_id, SUM(g_total_plus_gst) AS purchase_expenses_gross_inr
  FROM purchase_bills
  WHERE company_id IS NOT NULL
  GROUP BY company_id
),
-- 2026-08-27: Debit/Credit Note adjustments applied against a
-- source='purchase_bill' bill_pass_register row net OUT of purchase
-- expense (a debit note for a vendor shortage/return means we really
-- spent less than the bill's face value) — see
-- db/2026-08-27-note-linking-and-adjustments.sql.
purchase_adjustments AS (
  SELECT bpr.company_id, SUM(a.amount) AS adjustment_total_inr
  FROM bill_pass_register_adjustments a
  JOIN bill_pass_register bpr ON bpr.id = a.bill_pass_register_id
  WHERE bpr.source = 'purchase_bill'
  GROUP BY bpr.company_id
),
historical_agg AS (
  -- pre-`orders`-table CSV backfill rows only — see comment above.
  SELECT company_id, SUM(total_value_inr) AS hist_sale_inr, SUM(total_expenses_inr) AS hist_expense_inr
  FROM sale_profit_ledger
  WHERE order_id IS NULL
  GROUP BY company_id
),
combined AS (
  SELECT
    c.id AS company_id, c.name AS company_name,
    COALESCE(oa.total_sale_value_inr,0) + COALESCE(ha.hist_sale_inr,0) AS total_sale_value_inr,
    COALESCE(oa.order_expenses_inr,0)
      + (COALESCE(pa.purchase_expenses_gross_inr,0) - COALESCE(padj.adjustment_total_inr,0))
      + COALESCE(ha.hist_expense_inr,0) AS total_expenses_inr,
    COALESCE(ca.courier_inr, 0)   AS expense_courier_inr,
    COALESCE(ca.duty_inr, 0)      AS expense_duty_inr,
    COALESCE(pa.purchase_expenses_gross_inr, 0) AS expense_purchase_inr,
    -COALESCE(padj.adjustment_total_inr, 0)     AS expense_purchase_adjustments_inr,
    COALESCE(ha.hist_expense_inr, 0)            AS expense_historical_inr
  FROM companies c
  LEFT JOIN order_agg oa            ON oa.company_id = c.id
  LEFT JOIN purchase_agg pa         ON pa.company_id = c.id
  LEFT JOIN purchase_adjustments padj ON padj.company_id = c.id
  LEFT JOIN historical_agg ha       ON ha.company_id = c.id
  LEFT JOIN courier_agg ca          ON ca.company_id = c.id
)
SELECT
  combined.company_id, company_name,
  total_sale_value_inr,
  total_expenses_inr,
  (total_sale_value_inr - total_expenses_inr)                          AS net_total_value,
  (total_sale_value_inr * 0.25)                                        AS portal_expenses_25pct,
  ((total_sale_value_inr - total_expenses_inr) - (total_sale_value_inr * 0.25)) AS net_earn,
  (((total_sale_value_inr - total_expenses_inr) - (total_sale_value_inr * 0.25)) / NULLIF(total_sale_value_inr, 0)) AS profit_pct,
  COALESCE(ie.total_internal_expenses_inr, 0) AS total_internal_expenses_inr,
  (((total_sale_value_inr - total_expenses_inr) - (total_sale_value_inr * 0.25)) - COALESCE(ie.total_internal_expenses_inr, 0)) AS net_earn_after_overhead,
  -- 2026-09-17 breakdown (appended at the end — see file header):
  expense_courier_inr,
  expense_duty_inr,
  expense_purchase_inr,
  expense_purchase_adjustments_inr,
  expense_historical_inr
FROM combined
LEFT JOIN (
  SELECT company_id, SUM(amount_inr) AS total_internal_expenses_inr
  FROM internal_expenses GROUP BY company_id
) ie ON ie.company_id = combined.company_id;
COMMENT ON VIEW pl_dashboard_by_company_view IS
  '2026-08-20: rebuilt to be live off orders.order_value_inr + Courier/Duty reconciliation + purchase_bills '
  '(company-wide) instead of only the CSV-imported sale_profit_ledger — see db/2026-08-20-order-value-fix.sql. '
  'Pre-`orders`-table historical rows in sale_profit_ledger (order_id IS NULL) are still folded in so old '
  'history is not lost. 2026-08-27: purchase expense now nets out Debit/Credit Note adjustments applied '
  'against purchase bills (bill_pass_register_adjustments) — see db/2026-08-27-note-linking-and-adjustments.sql. '
  '2026-09-17: +5 expense-breakdown columns (courier/duty/purchase/adjustments/historical) so the single '
  'Expenses number is auditable line by line — see db/2026-09-17-pl-expense-breakdown.sql.';

-- ============================================================================
-- 2. pl_dashboard_by_month_view — same 5 breakdown columns, month-bucketed
-- ============================================================================
CREATE OR REPLACE VIEW pl_dashboard_by_month_view AS
WITH months AS (
  SELECT DISTINCT date_trunc('month', order_date)::date AS month FROM orders WHERE status <> 'Cancelled'
  UNION
  SELECT DISTINCT date_trunc('month', vendor_invoice_date)::date AS month FROM purchase_bills WHERE vendor_invoice_date IS NOT NULL
  UNION
  SELECT DISTINCT date_trunc('month', invoice_date)::date AS month FROM sale_profit_ledger WHERE order_id IS NULL AND invoice_date IS NOT NULL
  UNION
  SELECT DISTINCT date_trunc('month', expense_date)::date AS month FROM internal_expenses
),
order_refund_totals AS (
  SELECT order_id, SUM(refund_amount_inr) AS refund_total_inr
  FROM order_refunds
  GROUP BY order_id
),
courier_agg AS (
  SELECT date_trunc('month', o.order_date)::date AS month,
    SUM(COALESCE(cd.courier_expense_inr,0)) AS courier_inr,
    SUM(COALESCE(cd.duty_expense_inr,0))    AS duty_inr
  FROM orders o
  LEFT JOIN order_courier_duty_expense_view cd ON cd.order_id = o.id
  WHERE o.status <> 'Cancelled'
  GROUP BY date_trunc('month', o.order_date)
),
order_agg AS (
  SELECT date_trunc('month', o.order_date)::date AS month,
    SUM(o.order_value_inr - COALESCE(ort.refund_total_inr, 0))                                 AS sale_inr,
    SUM(COALESCE(cd.courier_expense_inr,0) + COALESCE(cd.duty_expense_inr,0))                  AS order_expense_inr
  FROM orders o
  LEFT JOIN order_courier_duty_expense_view cd ON cd.order_id = o.id
  LEFT JOIN order_refund_totals ort            ON ort.order_id = o.id
  WHERE o.status <> 'Cancelled'
  GROUP BY date_trunc('month', o.order_date)
),
purchase_agg AS (
  SELECT date_trunc('month', vendor_invoice_date)::date AS month, SUM(g_total_plus_gst) AS purchase_expense_gross_inr
  FROM purchase_bills
  WHERE vendor_invoice_date IS NOT NULL
  GROUP BY date_trunc('month', vendor_invoice_date)
),
-- 2026-08-27: same purchase-adjustment netting as pl_dashboard_by_company_
-- view, bucketed by the TARGET bill's own invoice_date (the month that
-- purchase expense was originally booked) — not the note's own date, so a
-- Debit Note entered next month for last month's shortage still corrects
-- the month the expense actually belongs to.
purchase_adjustments AS (
  SELECT date_trunc('month', bpr.invoice_date)::date AS month, SUM(a.amount) AS adjustment_total_inr
  FROM bill_pass_register_adjustments a
  JOIN bill_pass_register bpr ON bpr.id = a.bill_pass_register_id
  WHERE bpr.source = 'purchase_bill' AND bpr.invoice_date IS NOT NULL
  GROUP BY date_trunc('month', bpr.invoice_date)
),
historical_agg AS (
  SELECT date_trunc('month', invoice_date)::date AS month,
    SUM(total_value_inr) AS hist_sale_inr, SUM(total_expenses_inr) AS hist_expense_inr
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
    COALESCE(oa.order_expense_inr, 0)
      + (COALESCE(pa.purchase_expense_gross_inr, 0) - COALESCE(padj.adjustment_total_inr, 0))
      + COALESCE(ha.hist_expense_inr, 0) AS total_expenses_inr,
    COALESCE(ca.courier_inr, 0)   AS expense_courier_inr,
    COALESCE(ca.duty_inr, 0)      AS expense_duty_inr,
    COALESCE(pa.purchase_expense_gross_inr, 0) AS expense_purchase_inr,
    -COALESCE(padj.adjustment_total_inr, 0)    AS expense_purchase_adjustments_inr,
    COALESCE(ha.hist_expense_inr, 0)           AS expense_historical_inr
  FROM months m
  LEFT JOIN order_agg oa              ON oa.month = m.month
  LEFT JOIN purchase_agg pa           ON pa.month = m.month
  LEFT JOIN purchase_adjustments padj ON padj.month = m.month
  LEFT JOIN historical_agg ha         ON ha.month = m.month
  LEFT JOIN courier_agg ca            ON ca.month = m.month
)
SELECT
  c.month,
  c.total_sale_value_inr,
  c.total_expenses_inr,
  ((c.total_sale_value_inr - c.total_expenses_inr) - (c.total_sale_value_inr * 0.25)) AS net_earn,
  (((c.total_sale_value_inr - c.total_expenses_inr) - (c.total_sale_value_inr * 0.25)) / NULLIF(c.total_sale_value_inr, 0)) AS profit_pct,
  COALESCE(ea.total_internal_expenses_inr, 0) AS total_internal_expenses_inr,
  (((c.total_sale_value_inr - c.total_expenses_inr) - (c.total_sale_value_inr * 0.25)) - COALESCE(ea.total_internal_expenses_inr, 0)) AS net_earn_after_overhead,
  -- 2026-09-17 breakdown (appended at the end — see file header):
  c.expense_courier_inr,
  c.expense_duty_inr,
  c.expense_purchase_inr,
  c.expense_purchase_adjustments_inr,
  c.expense_historical_inr
FROM combined c
LEFT JOIN expense_agg ea ON ea.month = c.month
ORDER BY c.month DESC;
COMMENT ON VIEW pl_dashboard_by_month_view IS
  'Old P&L Dashboard''s month-wise block (previously hardcoded to a trailing 24 months via SUMPRODUCT over '
  'YEAR()/MONTH()) — a view naturally covers all history; LIMIT 24 in the application query if only a '
  'trailing window should be shown. 2026-08-20: rebuilt to be live off orders.order_date/order_value_inr + '
  'Courier/Duty + purchase_bills instead of only sale_profit_ledger — see pl_dashboard_by_company_view''s '
  'comment and db/2026-08-20-order-value-fix.sql. 2026-08-27: purchase expense now nets out Debit/Credit '
  'Note adjustments applied against purchase bills, bucketed by the target bill''s own invoice month — see '
  'db/2026-08-27-note-linking-and-adjustments.sql. 2026-09-17: +5 expense-breakdown columns — see '
  'db/2026-09-17-pl-expense-breakdown.sql.';
