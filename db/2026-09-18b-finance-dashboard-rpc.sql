-- 2026-09-18 (later) — "Finance Dashboard" page (/dashboard/reports/finance-
-- dashboard), requested via a screenshot of a reference KPI-cards + bar/
-- donut/line-chart + transaction-lists dashboard: "esa desboard banega P&L
-- ka" (a dashboard like this will be made for P&L).
--
-- This page needs P&L numbers for an ARBITRARY date range the owner picks
-- (a date-range filter, plus optional Marketplace/Store and Country
-- filters) — none of the existing pl_dashboard_by_* views support that;
-- they're either all-time (by_company) or fixed to calendar months
-- (by_month/by_company_month). Rather than re-implement the real-fee-
-- matching logic (Etsy/eBay/Amazon statement matching) in application code
-- for every page that wants a custom date range, this adds ONE SQL
-- function that takes the filters as parameters and returns monthly
-- buckets within that range — the exact same CTEs/matching logic as
-- pl_dashboard_by_company_month_view, just parameterized instead of fixed,
-- and with optional store_id/buyer_country filters added.
--
-- The Finance Dashboard page calls this function TWICE per load (current
-- period, and the immediately preceding period of equal length, for the
-- "vs previous period" %s on the KPI cards) and also uses its monthly rows
-- directly as the Profit & Loss Overview / P&L Trend chart data — one
-- function serves both the totals and the chart, no separate query.
--
-- Scope note (same honesty rule as db/2026-09-18-pl-by-marketplace-store.sql):
-- purchase/production cost, washing, and office overhead are NOT included
-- here — they're tracked per COMPANY with no per-order date granularity
-- that would cleanly bucket into "this date range, this marketplace, this
-- country". The Finance Dashboard page adds those SEPARATELY as a
-- company-wide "Other" figure (queried directly from purchase_bills/
-- washing_entries/internal_expenses by date, in the page itself — no SQL
-- change needed for that part) and labels it as such whenever a
-- marketplace/country filter is active.
--
-- Safe to re-run (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION finance_dashboard_monthly(
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
  returns_inr                  numeric
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
-- Same 3 marketplace-fee CTEs as every other pl_dashboard_by_* view —
-- identical matching logic (order_number vs. statement lines), just scoped
-- to filtered_orders instead of all of a company's orders.
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
-- store_ad_spend has no buyer_country — a country filter narrows Sales/
-- Courier/Duty/Returns above but NOT Ad Spend, which stays company (or
-- company+store) scoped. Documented in the page's own UI copy.
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
-- Bucketed by refund_date (when the return/refund happened), not the
-- original order date — matches how a "Returns this period" figure should
-- read. Joins through orders (not filtered_orders, which is order_date-
-- scoped) so a refund dated in this period against an order placed earlier
-- still counts, while still honoring the store/country filters.
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
months AS (
  SELECT month FROM order_agg
  UNION SELECT month FROM ad_spend_agg
  UNION SELECT month FROM returns_agg
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
  COALESCE(ra.returns_inr, 0)  AS returns_inr
FROM months m
LEFT JOIN order_agg oa          ON oa.month = m.month
LEFT JOIN courier_agg ca        ON ca.month = m.month
LEFT JOIN marketplace_fee_agg mfa ON mfa.month = m.month
LEFT JOIN ad_spend_agg ad       ON ad.month = m.month
LEFT JOIN returns_agg ra        ON ra.month = m.month
ORDER BY m.month;
$$;

COMMENT ON FUNCTION finance_dashboard_monthly IS
  '2026-09-18 (later) — Finance Dashboard page. Monthly-bucketed P&L rows for an arbitrary '
  '[p_from, p_to] date range, optionally scoped to one store (marketplace) and/or one '
  'buyer_country. Same real-fee-matched-else-25%%-estimate rule as every other pl_dashboard_by_* '
  'view. Does NOT include purchase/production cost, washing, or office overhead — see this '
  'file''s own header comment for why, and how the page adds that separately.';

-- ============================================================================
-- Verification — run after applying.
-- ============================================================================
-- SELECT * FROM finance_dashboard_monthly(
--   (SELECT id FROM companies ORDER BY name LIMIT 1),
--   (CURRENT_DATE - INTERVAL '90 days')::date,
--   CURRENT_DATE,
--   NULL, NULL
-- );
