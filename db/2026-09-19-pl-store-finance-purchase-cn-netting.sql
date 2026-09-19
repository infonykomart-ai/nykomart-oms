-- 2026-09-19 (audit fix, item B3) — pl_dashboard_by_store_view and
-- finance_dashboard_monthly() disagreed with pl_dashboard_by_company_view /
-- pl_dashboard_by_month_view / pl_dashboard_by_company_month_view on net
-- profit for the same period, because only the company/month views netted
-- purchase-bill Credit/Debit Note adjustments out of the purchase expense:
--
--   pl_dashboard_by_company_view (db/2026-09-17-pl-cn-allocation-and-
--   portal-real.sql) has a purchase_adjustments CTE:
--     SUM(bill_pass_register_adjustments.amount)
--       JOIN bill_pass_register WHERE source = 'purchase_bill'
--   and subtracts it from purchase_expenses_gross_inr before computing
--   total_expenses_inr / net_earn.
--
--   pl_dashboard_by_store_view and finance_dashboard_monthly() (both from
--   db/2026-09-18c-pl-purchase-washing-order-linked.sql) added
--   expense_purchase_inr as a GROSS purchase-bill sum only — no adjustments
--   CTE at all. So a purchase-bill Credit/Debit Note reduced the Company
--   P&L tab's net profit but not the Marketplace/Store tab's or the Finance
--   Dashboard's, for the exact same underlying bills/period — two numbers
--   that should reconcile and didn't.
--
-- Fix: give both objects the same purchase_adjustments netting, attributed
-- the same way their existing purchase_agg CTEs already are:
--   - pl_dashboard_by_store_view: via bill_pass_register.source_id ->
--     purchase_bills.id -> purchase_bills.order_id -> orders.store_id
--     (bill_pass_register.source_id is the established loose pointer for
--     source='purchase_bill' rows — see src/app/dashboard/documents/
--     actions.ts, the row is inserted with source_id: <purchase_bills.id>).
--     Only bills WITH order_id can be attributed to a store, same
--     limitation purchase_agg already has (see that view's own comment).
--   - finance_dashboard_monthly(): same join, filter-aware the same way
--     purchase_agg already is (unfiltered = every adjustment on a bill in
--     the date range counts; Marketplace/Country filter active = only
--     adjustments on bills linked to a matching order count).
--
-- Neither pl_dashboard_by_store_view nor finance_dashboard_monthly() is
-- consumed anywhere as "gross purchase cost broken out from adjustments"
-- (unlike pl_dashboard_by_company_view, whose expense_purchase_inr /
-- expense_purchase_adjustments_inr are two separate columns the CRM page
-- displays as two separate line items — src/app/dashboard/crm/page.tsx).
-- Both of these two objects' expense_purchase_inr is read as a single
-- "purchase cost for this scope" figure (src/app/dashboard/crm/page.tsx
-- store-view table + totals; src/app/dashboard/reports/finance-dashboard/
-- page.tsx sumMonthly()/monthCostsInr()) with no adjustments column read
-- alongside it. So the correct, minimal fix here is to net the adjustment
-- directly INTO expense_purchase_inr for these two objects (not add a new
-- column that nothing downstream would read) — same column name, same
-- shape, no database.ts or frontend changes required, and now it means the
-- same thing (net of CN/DN) everywhere it's read.
--
-- DROP + CREATE (view) / DROP + CREATE (function), matching this codebase's
-- own established convention for these exact objects — see
-- db/2026-09-18c-pl-purchase-washing-order-linked.sql's own header note on
-- why (Postgres CREATE OR REPLACE can't reorder/rename FUNCTION return
-- columns; here the column list is unchanged, but DROP+CREATE keeps this
-- file trivially safe to re-run alongside its sibling migrations and
-- matches this table's own git history). Safe to re-run.

-- ============================================================================
-- 1. pl_dashboard_by_store_view — net purchase-bill CN/DN out of
--    expense_purchase_inr, attributed via order_id -> store_id (same as
--    purchase_agg already is).
-- ============================================================================
DROP VIEW IF EXISTS pl_dashboard_by_store_view;
CREATE VIEW pl_dashboard_by_store_view AS
WITH order_refund_totals AS (
  SELECT order_id,
    SUM(refund_amount_inr) AS refund_total_inr,
    SUM(refund_amount_usd) AS refund_total_usd
  FROM order_refunds
  GROUP BY order_id
),
courier_agg AS (
  SELECT o.store_id,
    SUM(COALESCE(fn.net_shipping_amt, 0)) AS courier_net_inr,
    SUM(COALESCE(dn.net_duty_amt, 0))     AS duty_net_inr
  FROM orders o
  LEFT JOIN freight_awb_net_view fn ON fn.order_id = o.id
  LEFT JOIN duty_awb_net_view   dn ON dn.order_id = o.id
  WHERE o.status <> 'Cancelled'
  GROUP BY o.store_id
),
order_agg AS (
  SELECT o.store_id,
    COUNT(*) AS order_count,
    SUM(o.order_value_inr - COALESCE(ort.refund_total_inr, 0)) AS total_sale_value_inr,
    SUM(o.order_value_usd - COALESCE(ort.refund_total_usd, 0)) AS total_sale_value_usd
  FROM orders o
  LEFT JOIN order_refund_totals ort ON ort.order_id = o.id
  WHERE o.status <> 'Cancelled'
  GROUP BY o.store_id
),
etsy_fee_by_order AS (
  SELECT o.id AS order_id, o.store_id, SUM(-COALESCE(e.fees_and_taxes, 0)) AS fees_inr
  FROM orders o
  JOIN etsy_ledger_lines e
    ON e.company_id = o.company_id
   AND e.order_number = btrim(regexp_replace(o.marketplace_order_no, '^\s*#+', ''))
  WHERE o.status <> 'Cancelled'
  GROUP BY o.id, o.store_id
),
ebay_fee_by_order AS (
  SELECT o.id AS order_id, o.store_id,
    SUM(COALESCE(b.total_amount, 0) * ru.rate_to_inr) AS fees_inr
  FROM orders o
  JOIN ebay_tax_invoice_lines b
    ON b.company_id = o.company_id
   AND b.order_number = btrim(regexp_replace(o.marketplace_order_no, '^\s*#+', ''))
  LEFT JOIN LATERAL get_official_rate_as_of(COALESCE(b.currency, 'USD'), COALESCE(b.txn_date, o.order_date, CURRENT_DATE)) ru ON true
  WHERE o.status <> 'Cancelled'
  GROUP BY o.id, o.store_id
),
amazon_fee_by_order AS (
  SELECT o.id AS order_id, o.store_id,
    SUM(COALESCE(a.amazon_fees, 0) * ra.rate_to_inr) AS fees_inr
  FROM orders o
  JOIN amazon_transactions a
    ON a.company_id = o.company_id
   AND a.order_id = btrim(regexp_replace(o.marketplace_order_no, '^\s*#+', ''))
  LEFT JOIN LATERAL get_official_rate_as_of(COALESCE(a.currency, 'USD'), COALESCE(a.txn_date, o.order_date, CURRENT_DATE)) ra ON true
  WHERE o.status <> 'Cancelled'
  GROUP BY o.id, o.store_id
),
marketplace_fee_totals AS (
  SELECT om.store_id,
    SUM(COALESCE(e.fees_inr, 0) + COALESCE(b.fees_inr, 0) + COALESCE(a.fees_inr, 0)) AS fees_matched_inr
  FROM (
    SELECT DISTINCT o.id, o.store_id FROM orders o WHERE o.status <> 'Cancelled'
  ) om
  LEFT JOIN etsy_fee_by_order e   ON e.order_id = om.id
  LEFT JOIN ebay_fee_by_order b   ON b.order_id = om.id
  LEFT JOIN amazon_fee_by_order a ON a.order_id = om.id
  WHERE e.order_id IS NOT NULL OR b.order_id IS NOT NULL OR a.order_id IS NOT NULL
  GROUP BY om.store_id
),
ad_spend_agg AS (
  SELECT store_id,
    SUM(spend_usd)   AS ad_spend_usd,
    SUM(budget_usd)  AS ad_budget_usd
  FROM store_ad_spend
  GROUP BY store_id
),
-- purchase bills attributed to a store via their order's store_id. Only
-- bills WITH order_id filled in can appear here at all (a raw-material
-- stock purchase with no order has no store to attribute to).
purchase_agg AS (
  SELECT o.store_id, SUM(pb.g_total_plus_gst) AS purchase_inr
  FROM purchase_bills pb
  JOIN orders o ON o.id = pb.order_id
  GROUP BY o.store_id
),
-- 2026-09-19 (audit fix, item B3) — NEW. Purchase-bill Credit/Debit Note
-- adjustments, attributed to the same store as the bill they're posted
-- against: bill_pass_register.source_id (source='purchase_bill') ->
-- purchase_bills.id -> order_id -> orders.store_id. Netted into
-- expense_purchase_inr below, same as pl_dashboard_by_company_view already
-- nets it into that view's total_expenses_inr.
purchase_adjustments AS (
  SELECT o.store_id, SUM(a.amount) AS adjustment_total_inr
  FROM bill_pass_register_adjustments a
  JOIN bill_pass_register bpr ON bpr.id = a.bill_pass_register_id
  JOIN purchase_bills pb ON pb.id = bpr.source_id
  JOIN orders o ON o.id = pb.order_id
  WHERE bpr.source = 'purchase_bill'
  GROUP BY o.store_id
),
-- washing entries attributed via their OWN store_id column (set directly on
-- the entry — more reliable than going through order_id).
washing_agg AS (
  SELECT store_id, SUM(COALESCE(amount, 0) + COALESCE(debit_charges, 0)) AS washing_inr
  FROM washing_entries
  WHERE store_id IS NOT NULL
  GROUP BY store_id
),
combined AS (
  SELECT
    s.id AS store_id, s.name AS store_name, s.company_id, comp.name AS company_name,
    COALESCE(oa.order_count, 0)          AS order_count,
    COALESCE(oa.total_sale_value_inr, 0) AS total_sale_value_inr,
    COALESCE(oa.total_sale_value_usd, 0) AS total_sale_value_usd,
    COALESCE(ca.courier_net_inr, 0)      AS expense_courier_inr,
    COALESCE(ca.duty_net_inr, 0)         AS expense_duty_inr,
    COALESCE(mf.fees_matched_inr, 0)     AS portal_fees_matched_inr,
    COALESCE(ad.ad_spend_usd, 0)         AS ad_spend_usd,
    COALESCE(ad.ad_budget_usd, 0)        AS ad_budget_usd,
    COALESCE(pa.purchase_inr, 0) - COALESCE(padj.adjustment_total_inr, 0) AS expense_purchase_inr,
    COALESCE(wa.washing_inr, 0)          AS expense_washing_inr
  FROM stores s
  JOIN companies comp                 ON comp.id = s.company_id
  LEFT JOIN order_agg oa              ON oa.store_id = s.id
  LEFT JOIN courier_agg ca            ON ca.store_id = s.id
  LEFT JOIN marketplace_fee_totals mf ON mf.store_id = s.id
  LEFT JOIN ad_spend_agg ad           ON ad.store_id = s.id
  LEFT JOIN purchase_agg pa           ON pa.store_id = s.id
  LEFT JOIN purchase_adjustments padj ON padj.store_id = s.id
  LEFT JOIN washing_agg wa            ON wa.store_id = s.id
)
SELECT
  store_id, store_name, company_id, company_name,
  order_count,
  total_sale_value_inr,
  total_sale_value_usd,
  expense_courier_inr,
  expense_duty_inr,
  (total_sale_value_inr * 0.25) AS portal_expenses_25pct,
  CASE WHEN portal_fees_matched_inr > 0 THEN portal_fees_matched_inr
       ELSE (total_sale_value_inr * 0.25) END AS portal_expense_effective_inr,
  portal_fees_matched_inr,
  ad_spend_usd,
  ad_budget_usd,
  expense_purchase_inr,
  expense_washing_inr,
  (total_sale_value_inr - expense_courier_inr - expense_duty_inr
    - CASE WHEN portal_fees_matched_inr > 0 THEN portal_fees_matched_inr
           ELSE (total_sale_value_inr * 0.25) END
    - expense_purchase_inr - expense_washing_inr)             AS net_before_overhead_inr,
  ((total_sale_value_inr - expense_courier_inr - expense_duty_inr
    - CASE WHEN portal_fees_matched_inr > 0 THEN portal_fees_matched_inr
           ELSE (total_sale_value_inr * 0.25) END
    - expense_purchase_inr - expense_washing_inr)
    / NULLIF(total_sale_value_inr, 0))                        AS profit_pct_before_overhead,
  (total_sale_value_usd / NULLIF(ad_spend_usd, 0))            AS roas
FROM combined
ORDER BY total_sale_value_inr DESC NULLS LAST;

COMMENT ON VIEW pl_dashboard_by_store_view IS
  '2026-09-19 (audit fix, item B3) — expense_purchase_inr is now NET of purchase-bill Credit/Debit '
  'Note adjustments (bill_pass_register_adjustments where source=purchase_bill), attributed via the '
  'same order_id -> store_id path as the gross purchase sum. Brings this view back in line with '
  'pl_dashboard_by_company_view, which already netted these — the two disagreed on net profit for the '
  'same period before this fix. History: 2026-09-18 (round 8) added expense_purchase_inr/'
  'expense_washing_inr via purchase_bills.order_id / washing_entries.store_id.';

-- ============================================================================
-- 2. finance_dashboard_monthly — same netting, filter-aware the same way
--    purchase_agg already is. Signature unchanged (same 5 args, same return
--    columns) — DROP + CREATE to match this codebase's established
--    convention for this function (see db/2026-09-18c-...sql header note).
-- ============================================================================
DROP FUNCTION IF EXISTS finance_dashboard_monthly(uuid, date, date, uuid, text);

CREATE FUNCTION finance_dashboard_monthly(
  p_company_id uuid,
  p_from date,
  p_to date,
  p_store_id uuid DEFAULT NULL,
  p_buyer_country text DEFAULT NULL
)
RETURNS TABLE (
  month                        date,
  order_count                  bigint,
  total_sale_value_inr         numeric,
  total_sale_value_usd         numeric,
  expense_courier_inr          numeric,
  expense_duty_inr             numeric,
  portal_fees_matched_inr      numeric,
  portal_expense_effective_inr numeric,
  ad_spend_usd                 numeric,
  returns_inr                  numeric,
  expense_purchase_inr         numeric,
  expense_washing_inr          numeric
)
LANGUAGE sql STABLE AS $$
WITH filtered_orders AS (
  SELECT o.*
  FROM orders o
  WHERE o.company_id = p_company_id
    AND o.status <> 'Cancelled'
    AND o.order_date >= p_from AND o.order_date <= p_to
    AND (p_store_id IS NULL OR o.store_id = p_store_id)
    AND (p_buyer_country IS NULL OR o.buyer_country = p_buyer_country)
),
order_refund_totals AS (
  SELECT orf.order_id,
    SUM(orf.refund_amount_inr) AS refund_total_inr,
    SUM(orf.refund_amount_usd) AS refund_total_usd
  FROM order_refunds orf
  WHERE orf.order_id IN (SELECT id FROM filtered_orders)
  GROUP BY orf.order_id
),
courier_agg AS (
  SELECT date_trunc('month', fo.order_date)::date AS month,
    SUM(COALESCE(fn.net_shipping_amt, 0)) AS courier_net_inr,
    SUM(COALESCE(dn.net_duty_amt, 0))     AS duty_net_inr
  FROM filtered_orders fo
  LEFT JOIN freight_awb_net_view fn ON fn.order_id = fo.id
  LEFT JOIN duty_awb_net_view   dn ON dn.order_id = fo.id
  GROUP BY date_trunc('month', fo.order_date)
),
order_agg AS (
  SELECT date_trunc('month', fo.order_date)::date AS month,
    COUNT(*) AS order_count,
    SUM(fo.order_value_inr - COALESCE(ort.refund_total_inr, 0)) AS sale_inr,
    SUM(fo.order_value_usd - COALESCE(ort.refund_total_usd, 0)) AS sale_usd
  FROM filtered_orders fo
  LEFT JOIN order_refund_totals ort ON ort.order_id = fo.id
  GROUP BY date_trunc('month', fo.order_date)
),
etsy_fee AS (
  SELECT fo.id AS order_id, date_trunc('month', fo.order_date)::date AS month,
    SUM(-COALESCE(e.fees_and_taxes, 0)) AS fees_inr
  FROM filtered_orders fo
  JOIN etsy_ledger_lines e
    ON e.company_id = fo.company_id
   AND e.order_number = btrim(regexp_replace(fo.marketplace_order_no, '^\s*#+', ''))
  GROUP BY fo.id, date_trunc('month', fo.order_date)
),
ebay_fee AS (
  SELECT fo.id AS order_id, date_trunc('month', fo.order_date)::date AS month,
    SUM(COALESCE(b.total_amount, 0) * ru.rate_to_inr) AS fees_inr
  FROM filtered_orders fo
  JOIN ebay_tax_invoice_lines b
    ON b.company_id = fo.company_id
   AND b.order_number = btrim(regexp_replace(fo.marketplace_order_no, '^\s*#+', ''))
  LEFT JOIN LATERAL get_official_rate_as_of(COALESCE(b.currency, 'USD'), COALESCE(b.txn_date, fo.order_date, CURRENT_DATE)) ru ON true
  GROUP BY fo.id, date_trunc('month', fo.order_date)
),
amazon_fee AS (
  SELECT fo.id AS order_id, date_trunc('month', fo.order_date)::date AS month,
    SUM(COALESCE(a.amazon_fees, 0) * ra.rate_to_inr) AS fees_inr
  FROM filtered_orders fo
  JOIN amazon_transactions a
    ON a.company_id = fo.company_id
   AND a.order_id = btrim(regexp_replace(fo.marketplace_order_no, '^\s*#+', ''))
  LEFT JOIN LATERAL get_official_rate_as_of(COALESCE(a.currency, 'USD'), COALESCE(a.txn_date, fo.order_date, CURRENT_DATE)) ra ON true
  GROUP BY fo.id, date_trunc('month', fo.order_date)
),
marketplace_fee_by_order AS (
  SELECT fo.id AS order_id, date_trunc('month', fo.order_date)::date AS month,
    COALESCE(e.fees_inr, 0) + COALESCE(b.fees_inr, 0) + COALESCE(a.fees_inr, 0) AS fees_inr
  FROM filtered_orders fo
  LEFT JOIN etsy_fee e   ON e.order_id = fo.id
  LEFT JOIN ebay_fee b   ON b.order_id = fo.id
  LEFT JOIN amazon_fee a ON a.order_id = fo.id
  WHERE e.order_id IS NOT NULL OR b.order_id IS NOT NULL OR a.order_id IS NOT NULL
),
marketplace_fee_agg AS (
  SELECT month, SUM(fees_inr) AS fees_matched_inr FROM marketplace_fee_by_order GROUP BY month
),
ad_spend_agg AS (
  SELECT date_trunc('month', sas.spend_date)::date AS month,
    SUM(sas.spend_usd) AS ad_spend_usd
  FROM store_ad_spend sas
  JOIN stores s ON s.id = sas.store_id
  WHERE s.company_id = p_company_id
    AND sas.spend_date >= p_from AND sas.spend_date <= p_to
    AND (p_store_id IS NULL OR sas.store_id = p_store_id)
  GROUP BY date_trunc('month', sas.spend_date)
),
returns_agg AS (
  SELECT date_trunc('month', orf.refund_date)::date AS month,
    SUM(orf.refund_amount_inr) AS returns_inr
  FROM order_refunds orf
  JOIN orders o2 ON o2.id = orf.order_id
  WHERE o2.company_id = p_company_id
    AND orf.refund_date >= p_from AND orf.refund_date <= p_to
    AND (p_store_id IS NULL OR o2.store_id = p_store_id)
    AND (p_buyer_country IS NULL OR o2.buyer_country = p_buyer_country)
  GROUP BY date_trunc('month', orf.refund_date)
),
-- purchase bills. No filter active: every bill in range counts (linked or
-- not — matches the company-wide total this used to be). A Marketplace/
-- Country filter active: ONLY bills linked (order_id) to an order that
-- itself matches the filter count.
purchase_agg AS (
  SELECT date_trunc('month', pb.vendor_invoice_date)::date AS month,
    SUM(pb.g_total_plus_gst) AS purchase_inr
  FROM purchase_bills pb
  LEFT JOIN orders o3 ON o3.id = pb.order_id
  WHERE pb.company_id = p_company_id
    AND pb.vendor_invoice_date >= p_from AND pb.vendor_invoice_date <= p_to
    AND (
      (p_store_id IS NULL AND p_buyer_country IS NULL)
      OR (o3.id IS NOT NULL
          AND (p_store_id IS NULL OR o3.store_id = p_store_id)
          AND (p_buyer_country IS NULL OR o3.buyer_country = p_buyer_country))
    )
  GROUP BY date_trunc('month', pb.vendor_invoice_date)
),
-- 2026-09-19 (audit fix, item B3) — NEW. Purchase-bill Credit/Debit Note
-- adjustments for the same bills purchase_agg above counts, same
-- date-bucket (the bill's own vendor_invoice_date, so an adjustment always
-- nets against the same month/store/country bucket as its bill) and same
-- filter-aware linked/unlinked split.
purchase_adjustments AS (
  SELECT date_trunc('month', pb.vendor_invoice_date)::date AS month,
    SUM(a.amount) AS adjustment_total_inr
  FROM bill_pass_register_adjustments a
  JOIN bill_pass_register bpr ON bpr.id = a.bill_pass_register_id
  JOIN purchase_bills pb ON pb.id = bpr.source_id
  LEFT JOIN orders o5 ON o5.id = pb.order_id
  WHERE bpr.source = 'purchase_bill'
    AND pb.company_id = p_company_id
    AND pb.vendor_invoice_date >= p_from AND pb.vendor_invoice_date <= p_to
    AND (
      (p_store_id IS NULL AND p_buyer_country IS NULL)
      OR (o5.id IS NOT NULL
          AND (p_store_id IS NULL OR o5.store_id = p_store_id)
          AND (p_buyer_country IS NULL OR o5.buyer_country = p_buyer_country))
    )
  GROUP BY date_trunc('month', pb.vendor_invoice_date)
),
-- washing entries. Same no-filter/filter-active split, but the store filter
-- uses washing_entries' OWN store_id (set directly on the entry, more
-- reliable than the optional order_id link); the country filter still needs
-- the order_id link since washing_entries has no country of its own.
washing_agg AS (
  SELECT date_trunc('month', we.chalan_date)::date AS month,
    SUM(COALESCE(we.amount, 0) + COALESCE(we.debit_charges, 0)) AS washing_inr
  FROM washing_entries we
  LEFT JOIN orders o4 ON o4.id = we.order_id
  WHERE we.company_id = p_company_id
    AND we.chalan_date >= p_from AND we.chalan_date <= p_to
    AND (
      (p_store_id IS NULL AND p_buyer_country IS NULL)
      OR (
        (p_store_id IS NULL OR we.store_id = p_store_id)
        AND (p_buyer_country IS NULL OR (o4.id IS NOT NULL AND o4.buyer_country = p_buyer_country))
      )
    )
  GROUP BY date_trunc('month', we.chalan_date)
),
months AS (
  SELECT month FROM order_agg
  UNION SELECT month FROM ad_spend_agg
  UNION SELECT month FROM returns_agg
  UNION SELECT month FROM purchase_agg
  UNION SELECT month FROM purchase_adjustments
  UNION SELECT month FROM washing_agg
)
SELECT
  m.month,
  COALESCE(oa.order_count, 0)::bigint AS order_count,
  COALESCE(oa.sale_inr, 0)  AS total_sale_value_inr,
  COALESCE(oa.sale_usd, 0)  AS total_sale_value_usd,
  COALESCE(ca.courier_net_inr, 0) AS expense_courier_inr,
  COALESCE(ca.duty_net_inr, 0)    AS expense_duty_inr,
  COALESCE(mfa.fees_matched_inr, 0) AS portal_fees_matched_inr,
  CASE WHEN COALESCE(mfa.fees_matched_inr, 0) > 0 THEN mfa.fees_matched_inr
       ELSE COALESCE(oa.sale_inr, 0) * 0.25 END AS portal_expense_effective_inr,
  COALESCE(ad.ad_spend_usd, 0) AS ad_spend_usd,
  COALESCE(ra.returns_inr, 0)  AS returns_inr,
  COALESCE(pa.purchase_inr, 0) - COALESCE(padj.adjustment_total_inr, 0) AS expense_purchase_inr,
  COALESCE(wa.washing_inr, 0)  AS expense_washing_inr
FROM months m
LEFT JOIN order_agg oa          ON oa.month = m.month
LEFT JOIN courier_agg ca        ON ca.month = m.month
LEFT JOIN marketplace_fee_agg mfa ON mfa.month = m.month
LEFT JOIN ad_spend_agg ad       ON ad.month = m.month
LEFT JOIN returns_agg ra        ON ra.month = m.month
LEFT JOIN purchase_agg pa       ON pa.month = m.month
LEFT JOIN purchase_adjustments padj ON padj.month = m.month
LEFT JOIN washing_agg wa        ON wa.month = m.month
ORDER BY m.month;
$$;

COMMENT ON FUNCTION finance_dashboard_monthly IS
  '2026-09-19 (audit fix, item B3) — expense_purchase_inr is now NET of purchase-bill Credit/Debit '
  'Note adjustments (bill_pass_register_adjustments where source=purchase_bill), same filter-aware '
  'linked/unlinked split as the gross purchase sum. Brings this function back in line with '
  'pl_dashboard_by_company_view for the same period. History: 2026-09-18 (round 8) added '
  'expense_purchase_inr/expense_washing_inr, filter-aware.';

-- ============================================================================
-- Verification — run after applying.
-- ============================================================================
-- 1) Spot-check a company/period where a purchase-bill CN/DN exists — the
--    store view's summed expense_purchase_inr (across that company's
--    stores, orders with order_id set) plus finance_dashboard_monthly's
--    summed expense_purchase_inr (no store/country filter, same date range)
--    should now both be net-of-adjustment, matching each other and moving
--    in the same direction as pl_dashboard_by_company_view.total_expenses_inr
--    for that company:
-- SELECT bpr.company_id, pb.id AS purchase_bill_id, pb.order_id, o.store_id,
--        SUM(a.amount) AS adjustment_total
-- FROM bill_pass_register_adjustments a
-- JOIN bill_pass_register bpr ON bpr.id = a.bill_pass_register_id
-- JOIN purchase_bills pb ON pb.id = bpr.source_id
-- LEFT JOIN orders o ON o.id = pb.order_id
-- WHERE bpr.source = 'purchase_bill'
-- GROUP BY bpr.company_id, pb.id, pb.order_id, o.store_id
-- ORDER BY adjustment_total DESC
-- LIMIT 20;
-- 2) SELECT * FROM pl_dashboard_by_store_view ORDER BY total_sale_value_inr DESC LIMIT 10;
-- 3) SELECT * FROM finance_dashboard_monthly(
--      (SELECT id FROM companies ORDER BY name LIMIT 1),
--      (CURRENT_DATE - INTERVAL '365 days')::date, CURRENT_DATE, NULL, NULL);
