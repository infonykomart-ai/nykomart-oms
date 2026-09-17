-- 2026-09-17 (late) — two approved P&L accuracy upgrades.
--
-- 1) PORTAL MODEL SWITCH — "real-if-known, warna 25%" (user approved
--    verbatim). The screenshots (eBay "Transaction fees", Amazon
--    "amazon_fees", Etsy fees) proved the flat 25% guess is far off where
--    real statements exist (real fees ~10-15%). So:
--        portal expense = real matched fee cost  when the scope has ANY
--                                                          matched fees
--                       = 25% of sale (old estimate) otherwise
--    per company / per month, independently. Import statements store by
--    store and the P&L shifts itself from estimate to real — no switch
--    to press. portal_expenses_25pct keeps showing the raw estimate for
--    comparison; portal_expense_effective_inr is what net_earn subtracts.
--
-- 2) COURIER/DUTY CN AUTO-PROPORTIONAL ("CN auto-proportional baantna
--    theek hai? — theek hai", user approved). A courier/duty credit note
--    arrives against an invoice; per-AWB allocation is:
--        awb_cn = bill_cn_total × (awb_gross / SUM(all awb_gross on bill))
--    plus the AWB's OWN per-AWB credit_note_amt (freight_bill_awb_assign-
--    ments / duty_bill_awb_assignments columns — the manual single-AWB
--    path the user kept). So reconciliation/reporting reads NET:
--        net freight = gross_shipping_amt − awb_cn_share − own_cn
--    New views freight_awb_net_view / duty_awb_net_view; P&L courier/duty
--    expense now sums the NET amounts (a CN genuinely reduces expense —
--    it's our money back, not marketplace income). bill_pass_register's
--    payable side is untouched (payments/balance flow unchanged).
--
-- THE ONLY 2026-09-17 P&L SQL YOU NEED TO RUN (the earlier
-- db/2026-09-17-pl-expense-breakdown.sql is now a superseded stub).
--
-- NOT CREATE OR REPLACE — DELIBERATE DROP + CREATE. Reason (the exact
-- error the user hit running the earlier file in Supabase):
--   ERROR 42P16: cannot change name of view column "net_earn" to
--   "portal_expenses_25pct"
-- Postgres's CREATE OR REPLACE VIEW may only APPEND columns to an
-- existing view; renaming / reordering / inserting between existing
-- columns is rejected. The live month view predates portal_expenses_25pct
-- (and the live company view, once any earlier file ran, predates
-- portal_expense_effective_inr sitting mid-list) — so OR REPLACE can't
-- express these changes. DROP VIEW ... CASCADE + CREATE VIEW can; the
-- CASCADE drops this app's own dependent views, which the full CREATE
-- VIEW statements below rebuild identically. No tables are touched, no
-- data is lost (views hold no data), and ownership/grants are preserved
-- because the views are recreated by the same owner.
--
-- Re-runnable: the DROPs are IF EXISTS, the CREATEs are unconditional
-- full definitions. Running it twice is a no-op-ish rebuild — safe.
--
-- DROP ORDER MATTERS: on a RE-RUN the P&L views (and any schema view built
-- on them) depend on the net views, so dependents go first:
--   1. pl_dashboard_by_month_view  (built on the company view on re-run)
--   2. pl_dashboard_by_company_view
--   3. freight_awb_net_view / duty_awb_net_view  (bottom of the chain)

-- ============================================================================
-- 1. Per-AWB NET views (fresh objects — DROP IF EXISTS keeps the file
--    re-runnable; dependents dropped first — see the drop-order note above).
-- ============================================================================
DROP VIEW IF EXISTS pl_dashboard_by_month_view;
DROP VIEW IF EXISTS pl_dashboard_by_company_view;
DROP VIEW IF EXISTS duty_awb_net_view;
DROP VIEW IF EXISTS freight_awb_net_view;
CREATE VIEW freight_awb_net_view AS
SELECT
  a.id AS assignment_id,
  a.freight_bill_id,
  a.order_id,
  a.order_shipment_id,
  os.awb_no,
  COALESCE(v.gross_shipping_amt, 0) AS gross_shipping_amt,
  -- whole-bill CN split pro-rata across the bill's AWBs by gross amount...
  COALESCE(fb.credit_note_amt, 0)
    * (COALESCE(v.gross_shipping_amt, 0) / NULLIF(bill_gross.total_gross, 0))
  -- ...plus this AWB's own captured CN (single-AWB note, user-entered)
    + COALESCE(a.credit_note_amt, 0)
    - COALESCE(a.debit_note_amt, 0)   -- a debit note REVERSES a credit (billed later)
    AS cn_allocated_inr,
  COALESCE(v.gross_shipping_amt, 0)
    - (COALESCE(fb.credit_note_amt, 0)
         * (COALESCE(v.gross_shipping_amt, 0) / NULLIF(bill_gross.total_gross, 0))
       + COALESCE(a.credit_note_amt, 0)
       - COALESCE(a.debit_note_amt, 0)) AS net_shipping_amt
FROM freight_bill_awb_assignments a
JOIN freight_bills fb ON fb.id = a.freight_bill_id
LEFT JOIN order_shipments os ON os.id = a.order_shipment_id
LEFT JOIN freight_reconciliation_view v ON v.assignment_id = a.id
LEFT JOIN (
  SELECT x.freight_bill_id, SUM(COALESCE(v2.gross_shipping_amt, 0)) AS total_gross
  FROM freight_bill_awb_assignments x
  LEFT JOIN freight_reconciliation_view v2 ON v2.assignment_id = x.id
  GROUP BY x.freight_bill_id
) bill_gross ON bill_gross.freight_bill_id = a.freight_bill_id;
COMMENT ON VIEW freight_awb_net_view IS
  '2026-09-17: per-AWB NET freight after credit notes — whole-bill CN split '
  'pro-rata by AWB gross (user-approved auto rule) + the AWB''s own '
  'credit_note_amt/debit_note_amt (manual single-AWB capture). Feeds the P&L '
  'courier expense net of CNs. Bill payable (bill_pass_register) unchanged.';

CREATE VIEW duty_awb_net_view AS
SELECT
  a.id AS assignment_id,
  a.duty_tax_bill_id,
  a.order_id,
  a.order_shipment_id,
  os.awb_no,
  COALESCE(v.duty_gross_amt, 0) AS gross_duty_amt,
  COALESCE(dtb.credit_note_amt, 0)
    * (COALESCE(v.duty_gross_amt, 0) / NULLIF(bill_gross.total_gross, 0))
    + COALESCE(a.credit_note_amt, 0)
    - COALESCE(a.debit_note_amt, 0)
    AS cn_allocated_inr,
  COALESCE(v.duty_gross_amt, 0)
    - (COALESCE(dtb.credit_note_amt, 0)
         * (COALESCE(v.duty_gross_amt, 0) / NULLIF(bill_gross.total_gross, 0))
       + COALESCE(a.credit_note_amt, 0)
       - COALESCE(a.debit_note_amt, 0)) AS net_duty_amt
FROM duty_bill_awb_assignments a
JOIN duty_tax_bills dtb ON dtb.id = a.duty_tax_bill_id
LEFT JOIN order_shipments os ON os.id = a.order_shipment_id
LEFT JOIN duty_reconciliation_view v ON v.assignment_id = a.id
LEFT JOIN (
  SELECT x.duty_tax_bill_id, SUM(COALESCE(v2.duty_gross_amt, 0)) AS total_gross
  FROM duty_bill_awb_assignments x
  LEFT JOIN duty_reconciliation_view v2 ON v2.assignment_id = x.id
  GROUP BY x.duty_tax_bill_id
) bill_gross ON bill_gross.duty_tax_bill_id = a.duty_tax_bill_id;
COMMENT ON VIEW duty_awb_net_view IS
  '2026-09-17: per-AWB NET duty after credit notes — same auto-proportional '
  'CN split as freight_awb_net_view, by duty gross amount.';

-- ============================================================================
-- 2. P&L views — net courier/duty + portal real-if-known
-- ============================================================================
-- (DROP + CREATE, not OR REPLACE — see the header note on error 42P16.
-- The two P&L views were already dropped above, before the net views,
-- because on a re-run they DEPEND on the net views.)
CREATE VIEW pl_dashboard_by_company_view AS
WITH order_refund_totals AS (
  SELECT order_id, SUM(refund_amount_inr) AS refund_total_inr
  FROM order_refunds
  GROUP BY order_id
),
-- 2026-09-17 (late): NET courier/duty — freight/duty AWB gross MINUS their
-- allocated CN share (freight_awb_net_view / duty_awb_net_view above).
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
  -- 2026-09-17 (late): REAL-IF-KNOWN portal expense — matched fees when
  -- any exist for this scope, else the 25% estimate (user-approved).
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
  bank_inflow_inr
FROM combined
LEFT JOIN (
  SELECT company_id, SUM(amount_inr) AS total_internal_expenses_inr
  FROM internal_expenses GROUP BY company_id
) ie ON ie.company_id = combined.company_id;
COMMENT ON VIEW pl_dashboard_by_company_view IS
  '2026-09-17 (late): portal expense is REAL-IF-KNOWN — matched Etsy/eBay/Amazon fees when the scope has '
  'any, else the flat 25% estimate (portal_expense_effective_inr; the raw estimate stays in '
  'portal_expenses_25pct for comparison). Courier/duty expense is now NET of credit notes '
  '(auto-proportional per-AWB CN split + per-AWB manual notes — see freight_awb_net_view / '
  'duty_awb_net_view). History: 2026-08-20 live rebuild, 2026-08-25 refund netting, 2026-08-27 '
  'purchase adjustments, 2026-09-17 breakdown columns + washing + fee hybrid.';

-- (Already dropped above — see the drop-order note; CREATE only here.)
CREATE VIEW pl_dashboard_by_month_view AS
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
  c.bank_inflow_inr
FROM combined c
LEFT JOIN expense_agg ea ON ea.month = c.month
ORDER BY c.month DESC;
COMMENT ON VIEW pl_dashboard_by_month_view IS
  '2026-09-17 (late): portal expense REAL-IF-KNOWN per month (matched fees when any, else 25%); '
  'courier/duty NET of CNs. Month-wise history mirrors the company view''s comment.';

-- ============================================================================
-- Verification:
-- ============================================================================
-- 1) CN allocation sums back to the bill's CN total (freight):
-- SELECT fb.invoice_no, fb.credit_note_amt AS bill_cn,
--        SUM(n.cn_allocated_inr) AS allocated_cn
-- FROM freight_bills fb
-- JOIN freight_awb_net_view n ON n.freight_bill_id = fb.id
-- WHERE fb.credit_note_amt > 0
-- GROUP BY fb.invoice_no, fb.credit_note_amt;
-- Expect allocated_cn ≈ bill_cn (± per-AWB manual notes).
-- 2) Portal model check — months with fees use real, others 25%:
-- SELECT month, portal_fees_matched_inr, portal_expenses_25pct,
--        portal_expense_effective_inr
-- FROM pl_dashboard_by_month_view ORDER BY month DESC LIMIT 12;
