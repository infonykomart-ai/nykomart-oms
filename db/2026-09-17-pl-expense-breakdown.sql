-- 2026-09-17 — P&L: full expense breakdown + washing + marketplace-fee hybrid.
-- (Supersedes this morning's breakdown-only version of this same file —
-- everything below is idempotent CREATE OR REPLACE, safe to run once now;
-- if you already ran the earlier version, just run this one again.)
--
-- USER ASKS THIS FILE ANSWERS:
--   "jo jo expense huye vo sab aane chahiye na"  → 5 breakdown columns
--   (washing chalan P&L me automatic nahi ja raha tha) → expense_washing_inr
--   "platform fee bhi apn update karne lag gaye" → portal_fees_matched_inr
--
-- WHAT CHANGES VS THE LIVE SCHEMA:
--   1. 5 breakdown columns appended (courier / duty / purchase / note-adjustments
--      shown negative / pre-orders CSV history) so the single Expenses number is
--      auditable line by line.
--   2. WASHING now flows in automatically: washing_entries.amount + debit_charges
--      (chalan-date month) joins total_expenses_inr — NO manual Expenses-screen
--      entry needed anymore. Do NOT also log washing under the "Washing" category
--      in Expenses for the same chalan, or it will count twice.
--   3. MARKETPLACE-FEE HYBRID: real matched Etsy/eBay/Amazon fees (statement
--      imports, same matching keys as matchMarketplaceFees() — company_id +
--      normalized marketplace order no) REDUCE the flat 25% portal estimate,
--      clamped at zero:  effective portal = GREATEST(0.25*sale − matched, 0).
--      They are NOT added to total_expenses_inr (that would double-subtract
--      against the 25% estimate). Conversions to INR use the official
--      exchange-rate master as of each fee line's own date (Etsy ledger is
--      already INR; eBay/Amazon at that currency's rate — a missing rate row
--      skips the line; verification query at the end lists those).
--   4. All pre-existing columns keep name/order — this app queries named
--      .select() columns, so appending is safe.
--
-- Both views: CREATE OR REPLACE with full definitions — safe to re-run.

-- ============================================================================
-- 1. pl_dashboard_by_company_view — original columns preserved, 7 appended
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
-- 2026-09-17: washing chalans become a real P&L expense line (amount +
-- debit charges). Removes the old "manual Expenses entry required" gap —
-- see file header. FY/date validation guards chalan_date (2026-09-17).
washing_agg AS (
  SELECT company_id, SUM(COALESCE(amount, 0) + COALESCE(debit_charges, 0)) AS washing_inr
  FROM washing_entries
  GROUP BY company_id
),
-- 2026-09-17 marketplace-fee hybrid. Aggregated PER SOURCE first (so a
-- data quirk matching one order in two marketplaces can't multiply rows),
-- then per order, then per company. Same matching keys as
-- src/lib/orders/marketplace-fees.ts (leading '#' trimmed, both sides).
-- COST CONVENTION: every source below yields a POSITIVE = fee cost number —
--   Etsy  fees_and_taxes is NEGATIVE for charges / positive for credits,
--         so cost = −SUM(fees_and_taxes) (a credit reduces cost);
--   eBay  tax-invoice lines are charges, cost = +SUM(total_amount * rate);
--   Amazon amazon_fees are charges, cost = +SUM(amazon_fees * rate).
-- Conversions use the official exchange-rate master as of each fee line's
-- own date (Etsy ledger is already INR; a missing rate row skips the
-- line — verification query at the end lists those).
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
      + COALESCE(wa.washing_inr, 0)
      + COALESCE(ha.hist_expense_inr,0) AS total_expenses_inr,
    COALESCE(ca.courier_inr, 0)   AS expense_courier_inr,
    COALESCE(ca.duty_inr, 0)      AS expense_duty_inr,
    COALESCE(pa.purchase_expenses_gross_inr, 0) AS expense_purchase_inr,
    -COALESCE(padj.adjustment_total_inr, 0)     AS expense_purchase_adjustments_inr,
    COALESCE(wa.washing_inr, 0)                 AS expense_washing_inr,
    COALESCE(ha.hist_expense_inr, 0)            AS expense_historical_inr,
    COALESCE(mf.fees_matched_inr, 0)            AS portal_fees_matched_inr
  FROM companies c
  LEFT JOIN order_agg oa              ON oa.company_id = c.id
  LEFT JOIN purchase_agg pa           ON pa.company_id = c.id
  LEFT JOIN purchase_adjustments padj ON padj.company_id = c.id
  LEFT JOIN washing_agg wa            ON wa.company_id = c.id
  LEFT JOIN marketplace_fee_totals mf ON mf.company_id = c.id
  LEFT JOIN historical_agg ha         ON ha.company_id = c.id
  LEFT JOIN courier_agg ca            ON ca.company_id = c.id
)
SELECT
  combined.company_id, company_name,
  total_sale_value_inr,
  total_expenses_inr,
  (total_sale_value_inr - total_expenses_inr)                          AS net_total_value,
  (total_sale_value_inr * 0.25)                                        AS portal_expenses_25pct,
  -- 2026-09-17: net_earn now uses the HYBRID portal expense — the flat
  -- 25% estimate minus the real matched Etsy/eBay/Amazon fee COST
  -- (portal_fees_matched_inr is positive = cost, credits already netted
  -- per source), never below zero. portal_expenses_25pct stays the raw
  -- estimate so the two are always comparable.
  ((total_sale_value_inr - total_expenses_inr) - GREATEST((total_sale_value_inr * 0.25) - portal_fees_matched_inr, 0)) AS net_earn,
  (((total_sale_value_inr - total_expenses_inr) - GREATEST((total_sale_value_inr * 0.25) - portal_fees_matched_inr, 0)) / NULLIF(total_sale_value_inr, 0)) AS profit_pct,
  COALESCE(ie.total_internal_expenses_inr, 0) AS total_internal_expenses_inr,
  (((total_sale_value_inr - total_expenses_inr) - GREATEST((total_sale_value_inr * 0.25) - portal_fees_matched_inr, 0)) - COALESCE(ie.total_internal_expenses_inr, 0)) AS net_earn_after_overhead,
  -- 2026-09-17 breakdown (appended at the end — see file header):
  expense_courier_inr,
  expense_duty_inr,
  expense_purchase_inr,
  expense_purchase_adjustments_inr,
  expense_washing_inr,
  expense_historical_inr,
  portal_fees_matched_inr
FROM combined
LEFT JOIN (
  SELECT company_id, SUM(amount_inr) AS total_internal_expenses_inr
  FROM internal_expenses GROUP BY company_id
) ie ON ie.company_id = combined.company_id;
COMMENT ON VIEW pl_dashboard_by_company_view IS
  '2026-08-20: rebuilt to be live off orders.order_value_inr + Courier/Duty reconciliation + purchase_bills '
  '(company-wide) instead of only the CSV-imported sale_profit_ledger. 2026-08-27: purchase expense nets out '
  'Debit/Credit Note adjustments. 2026-09-17: +expense breakdown columns, WASHING (washing_entries amount+'
  'debit_charges) now folds into total_expenses_inr automatically, and net_earn uses the HYBRID portal expense '
  '(25% estimate − real matched Etsy/eBay/Amazon fees, clamped at 0) — see db/2026-09-17-pl-expense-breakdown.sql. '
  'Do NOT also log washing chalans as manual Expenses rows (double count).';

-- ============================================================================
-- 2. pl_dashboard_by_month_view — same treatment, month-bucketed
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
-- 2026-08-27: bucketed by the TARGET bill's own invoice_date (the month
-- that purchase expense was originally booked) — see company view.
purchase_adjustments AS (
  SELECT date_trunc('month', bpr.invoice_date)::date AS month, SUM(a.amount) AS adjustment_total_inr
  FROM bill_pass_register_adjustments a
  JOIN bill_pass_register bpr ON bpr.id = a.bill_pass_register_id
  WHERE bpr.source = 'purchase_bill' AND bpr.invoice_date IS NOT NULL
  GROUP BY date_trunc('month', bpr.invoice_date)
),
-- 2026-09-17: washing bucketed by the CHALAN's own date.
washing_agg AS (
  SELECT date_trunc('month', chalan_date)::date AS month,
    SUM(COALESCE(amount, 0) + COALESCE(debit_charges, 0)) AS washing_inr
  FROM washing_entries
  GROUP BY date_trunc('month', chalan_date)
),
-- 2026-09-17: matched fees bucketed by the ORDER's month — they offset the
-- 25% estimate, and that estimate is a % of the SAME month's sales.
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
      + COALESCE(wa.washing_inr, 0)
      + COALESCE(ha.hist_expense_inr, 0) AS total_expenses_inr,
    COALESCE(ca.courier_inr, 0)   AS expense_courier_inr,
    COALESCE(ca.duty_inr, 0)      AS expense_duty_inr,
    COALESCE(pa.purchase_expense_gross_inr, 0) AS expense_purchase_inr,
    -COALESCE(padj.adjustment_total_inr, 0)    AS expense_purchase_adjustments_inr,
    COALESCE(wa.washing_inr, 0)                AS expense_washing_inr,
    COALESCE(ha.hist_expense_inr, 0)           AS expense_historical_inr,
    COALESCE(mf.fees_matched_inr, 0)           AS portal_fees_matched_inr
  FROM months m
  LEFT JOIN order_agg oa              ON oa.month = m.month
  LEFT JOIN purchase_agg pa           ON pa.month = m.month
  LEFT JOIN purchase_adjustments padj ON padj.month = m.month
  LEFT JOIN washing_agg wa            ON wa.month = m.month
  LEFT JOIN marketplace_fee_totals mf ON mf.month = m.month
  LEFT JOIN historical_agg ha         ON ha.month = m.month
  LEFT JOIN courier_agg ca            ON ca.month = m.month
)
SELECT
  c.month,
  c.total_sale_value_inr,
  c.total_expenses_inr,
  ((c.total_sale_value_inr - c.total_expenses_inr) - GREATEST((c.total_sale_value_inr * 0.25) - c.portal_fees_matched_inr, 0)) AS net_earn,
  (((c.total_sale_value_inr - c.total_expenses_inr) - GREATEST((c.total_sale_value_inr * 0.25) - c.portal_fees_matched_inr, 0)) / NULLIF(c.total_sale_value_inr, 0)) AS profit_pct,
  COALESCE(ea.total_internal_expenses_inr, 0) AS total_internal_expenses_inr,
  (((c.total_sale_value_inr - c.total_expenses_inr) - GREATEST((c.total_sale_value_inr * 0.25) - c.portal_fees_matched_inr, 0)) - COALESCE(ea.total_internal_expenses_inr, 0)) AS net_earn_after_overhead,
  -- 2026-09-17 breakdown (appended at the end — see file header):
  c.expense_courier_inr,
  c.expense_duty_inr,
  c.expense_purchase_inr,
  c.expense_purchase_adjustments_inr,
  c.expense_washing_inr,
  c.expense_historical_inr,
  c.portal_fees_matched_inr
FROM combined c
LEFT JOIN expense_agg ea ON ea.month = c.month
ORDER BY c.month DESC;
COMMENT ON VIEW pl_dashboard_by_month_view IS
  'Month-wise P&L, live off orders + Courier/Duty + purchase_bills + washing + CSV history (see company view''s '
  'comment for the 2026-08-20/08-27/09-17 history). 2026-09-17: washing bucketed by chalan_date; matched '
  'marketplace fees bucketed by the ORDER''s month (they offset that month''s 25% portal estimate) — see '
  'db/2026-09-17-pl-expense-breakdown.sql.';

-- ============================================================================
-- Verification (run after applying — expected results in comments):
-- ============================================================================
-- 1) Per-company washing + matched fees now visible:
-- SELECT company_id, expense_washing_inr, portal_fees_matched_inr
-- FROM pl_dashboard_by_company_view ORDER BY company_name;--  2) Sanity: total_expenses_inr = courier + duty + (purchase + adjustments) + washing + historical
-- SELECT company_id, total_expenses_inr,
--   expense_courier_inr + expense_duty_inr + expense_purchase_inr
--   + expense_purchase_adjustments_inr + expense_washing_inr + expense_historical_inr AS parts_sum
-- FROM pl_dashboard_by_company_view;
-- 3) Portal hybrid sanity: net_earn = sale − expenses − GREATEST(25%sale − fees, 0)
-- SELECT company_id, total_sale_value_inr, total_expenses_inr,
--   portal_expenses_25pct, portal_fees_matched_inr, net_earn,
--   (total_sale_value_inr - total_expenses_inr
--      - GREATEST(portal_expenses_25pct - portal_fees_matched_inr, 0)) AS recomputed
-- FROM pl_dashboard_by_company_view;
-- 3) Fee lines skipped for want of an exchange-rate row (should be ~0 rows):
-- SELECT 'ebay' src, b.id, b.txn_date, b.currency, b.total_amount
--   FROM ebay_tax_invoice_lines b
--   WHERE NOT EXISTS (SELECT 1 FROM get_official_rate_as_of(COALESCE(b.currency,'USD'), COALESCE(b.txn_date, CURRENT_DATE)))
-- UNION ALL
-- SELECT 'amazon', a.id, a.txn_date, a.currency, a.amazon_fees
--   FROM amazon_transactions a
--   WHERE a.currency IS NOT NULL AND NOT EXISTS (SELECT 1 FROM get_official_rate_as_of(a.currency, COALESCE(a.txn_date, CURRENT_DATE)));
