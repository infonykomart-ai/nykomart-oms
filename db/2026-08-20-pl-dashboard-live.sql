-- 2026-08-20 — P&L Dashboard goes live (part 2 of the order-value fix —
-- see db/2026-08-20-order-value-fix.sql for part 1: Courier/Duty Bill
-- Report + freight/duty reconciliation views). User confirmed via
-- AskUserQuestion:
--   1. P&L should switch to orders.order_value_inr as revenue, same as
--      the Courier/Duty fix, instead of only ever reading the
--      CSV-imported `sale_profit_ledger` table.
--   2. Expenses = order-tied Courier + Duty (per order, via
--      freight_reconciliation_view/duty_reconciliation_view) PLUS EVERY
--      purchase_bills row, company-wide — whether or not that bill is
--      linked to a specific order (purchase_bills.order_id is optional;
--      general raw-material stock purchases have no order to attach to).
--   3. Month grouping is now orders.order_date (was invoice_date before).
--
-- ASSUMPTION (stated, not separately confirmed — flag if wrong): Cancelled
-- orders are excluded from both revenue and expense (not a real sale).
-- Returned orders stay included (a return is a fulfilled sale that came
-- back; the separate `refunds` table handles the return itself).
--
-- sale_profit_ledger is NOT dropped or ignored. Its rows with order_id
-- IS NULL are genuine pre-`orders`-table historical backfill (the
-- Statement Entry CSV-import screen still exists for exactly this case —
-- see src/lib/statement-import/tables.ts's comment) and have no other
-- source, so they're still folded into both views. Rows WITH an order_id
-- are now skipped (the live order they point at is counted via `orders`
-- directly) to avoid double-counting the same sale twice.
--
-- New view: order_courier_duty_expense_view — one row per order, its
-- Courier+Duty expense summed across every AWB/shipment. Feeds both P&L
-- views below; not used directly by application code (matches the
-- existing freight/duty reconciliation views' pattern — ad-hoc/reporting
-- use).
--
-- CREATE OR REPLACE VIEW throughout: both pl_dashboard_* views keep the
-- exact same output column list/order/names as before (only the 2 new
-- trailing columns from the 2026-08-20 internal_expenses round stayed
-- appended at the end, unchanged) — no application code needs to change;
-- crm/page.tsx already just reads these views by column name.
--
-- Dry-run tested against the local scratch Postgres before delivery.

BEGIN;

CREATE OR REPLACE VIEW order_courier_duty_expense_view AS
SELECT
  o.id AS order_id, o.company_id, o.order_date, o.status,
  COALESCE(courier.amt, 0) AS courier_expense_inr,
  COALESCE(duty.amt, 0)    AS duty_expense_inr
FROM orders o
LEFT JOIN (SELECT order_id, SUM(gross_shipping_amt) AS amt FROM freight_reconciliation_view GROUP BY order_id) courier ON courier.order_id = o.id
LEFT JOIN (SELECT order_id, SUM(duty_gross_amt)      AS amt FROM duty_reconciliation_view    GROUP BY order_id) duty    ON duty.order_id    = o.id;
COMMENT ON VIEW order_courier_duty_expense_view IS
  'Per-order Courier+Duty expense (summed across every AWB/shipment on that order), used by the live P&L views '
  'below. Not itself company-scoped in RLS — inherits from `orders`.';

CREATE OR REPLACE VIEW pl_dashboard_by_company_view AS
WITH order_agg AS (
  SELECT o.company_id,
    SUM(o.order_value_inr) FILTER (WHERE o.status <> 'Cancelled')                                            AS total_sale_value_inr,
    SUM(COALESCE(cd.courier_expense_inr,0) + COALESCE(cd.duty_expense_inr,0)) FILTER (WHERE o.status <> 'Cancelled') AS order_expenses_inr
  FROM orders o
  LEFT JOIN order_courier_duty_expense_view cd ON cd.order_id = o.id
  GROUP BY o.company_id
),
purchase_agg AS (
  SELECT company_id, SUM(g_total_plus_gst) AS purchase_expenses_inr
  FROM purchase_bills
  WHERE company_id IS NOT NULL
  GROUP BY company_id
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
    COALESCE(oa.order_expenses_inr,0) + COALESCE(pa.purchase_expenses_inr,0) + COALESCE(ha.hist_expense_inr,0) AS total_expenses_inr
  FROM companies c
  LEFT JOIN order_agg oa      ON oa.company_id = c.id
  LEFT JOIN purchase_agg pa   ON pa.company_id = c.id
  LEFT JOIN historical_agg ha ON ha.company_id = c.id
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
  (((total_sale_value_inr - total_expenses_inr) - (total_sale_value_inr * 0.25)) - COALESCE(ie.total_internal_expenses_inr, 0)) AS net_earn_after_overhead
FROM combined
LEFT JOIN (
  SELECT company_id, SUM(amount_inr) AS total_internal_expenses_inr
  FROM internal_expenses GROUP BY company_id
) ie ON ie.company_id = combined.company_id;
COMMENT ON VIEW pl_dashboard_by_company_view IS
  '2026-08-20: rebuilt to be live off orders.order_value_inr + Courier/Duty reconciliation + purchase_bills '
  '(company-wide) instead of only the CSV-imported sale_profit_ledger — see db/2026-08-20-order-value-fix.sql. '
  'Pre-`orders`-table historical rows in sale_profit_ledger (order_id IS NULL) are still folded in so old '
  'history is not lost.';

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
order_agg AS (
  SELECT date_trunc('month', o.order_date)::date AS month,
    SUM(o.order_value_inr)                                                                    AS sale_inr,
    SUM(COALESCE(cd.courier_expense_inr,0) + COALESCE(cd.duty_expense_inr,0))                  AS order_expense_inr
  FROM orders o
  LEFT JOIN order_courier_duty_expense_view cd ON cd.order_id = o.id
  WHERE o.status <> 'Cancelled'
  GROUP BY date_trunc('month', o.order_date)
),
purchase_agg AS (
  SELECT date_trunc('month', vendor_invoice_date)::date AS month, SUM(g_total_plus_gst) AS purchase_expense_inr
  FROM purchase_bills
  WHERE vendor_invoice_date IS NOT NULL
  GROUP BY date_trunc('month', vendor_invoice_date)
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
    COALESCE(oa.order_expense_inr, 0) + COALESCE(pa.purchase_expense_inr, 0) + COALESCE(ha.hist_expense_inr, 0) AS total_expenses_inr
  FROM months m
  LEFT JOIN order_agg oa      ON oa.month = m.month
  LEFT JOIN purchase_agg pa   ON pa.month = m.month
  LEFT JOIN historical_agg ha ON ha.month = m.month
)
SELECT
  c.month,
  c.total_sale_value_inr,
  c.total_expenses_inr,
  ((c.total_sale_value_inr - c.total_expenses_inr) - (c.total_sale_value_inr * 0.25)) AS net_earn,
  (((c.total_sale_value_inr - c.total_expenses_inr) - (c.total_sale_value_inr * 0.25)) / NULLIF(c.total_sale_value_inr, 0)) AS profit_pct,
  COALESCE(ea.total_internal_expenses_inr, 0) AS total_internal_expenses_inr,
  (((c.total_sale_value_inr - c.total_expenses_inr) - (c.total_sale_value_inr * 0.25)) - COALESCE(ea.total_internal_expenses_inr, 0)) AS net_earn_after_overhead
FROM combined c
LEFT JOIN expense_agg ea ON ea.month = c.month
ORDER BY c.month DESC;
COMMENT ON VIEW pl_dashboard_by_month_view IS
  'Old P&L Dashboard''s month-wise block (previously hardcoded to a trailing 24 months via SUMPRODUCT over '
  'YEAR()/MONTH()) — a view naturally covers all history; LIMIT 24 in the application query if only a '
  'trailing window should be shown. 2026-08-20: rebuilt to be live off orders.order_date/order_value_inr + '
  'Courier/Duty + purchase_bills instead of only sale_profit_ledger — see pl_dashboard_by_company_view''s '
  'comment and db/2026-08-20-order-value-fix.sql.';

COMMIT;

-- Verification (run after commit):
-- select * from pl_dashboard_by_company_view order by company_name;
-- select * from pl_dashboard_by_month_view limit 12;
