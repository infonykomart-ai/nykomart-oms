-- 2026-09-18 — "P&L by Marketplace" (new CRM tab), in response to the
-- uploaded pL.md blueprint document + "apne hisab me is parkar ke P&L
-- desbord data ki need hai to isko banao" (build this kind of P&L
-- dashboard data if you judge it's needed).
--
-- WHAT THE UPLOADED DOCUMENT ASKED FOR, AND WHY THIS FILE ISN'T THAT:
-- pL.md is a full blueprint for a SEPARATE system: a brand-new Node.js/
-- Express backend (its own package.json named "ecommerce-export-erp-
-- backend", JWT auth, its own server.js/app.js), talking to a BRAND-NEW
-- PostgreSQL schema (marketplaces, customers, products, skus, orders,
-- order_items, shipments, payments, expenses, advertising, returns,
-- inventory, suppliers, purchases, production_orders, and a
-- `pnl_transactions` ledger table that recomputes P&L from scratch as
-- accounting entries instead of live SQL views).
--
-- That would stand up a second, competing system next to the live one
-- this app already is — duplicating (not reusing) data this app already
-- has: `stores` already IS the document's "marketplaces" concept (its own
-- schema.sql comment literally says "old PORTAL/PORTALS" — Amazon US,
-- Amazon UK, Etsy, Website, Wholesale etc. are already rows in `stores`,
-- one row each, with orders.store_id already NOT NULL on every order);
-- `orders.buyer_country`/`source_country_id`-style country data, per-order
-- courier/duty (freight_awb_net_view/duty_awb_net_view), and matched
-- marketplace fees (etsy_ledger_lines/ebay_tax_invoice_lines/
-- amazon_transactions, already joined into marketplace_fee_totals in the
-- existing P&L views) all already exist and already feed the live P&L.
-- Building the document's parallel ledger table/backend on top of that
-- would mean double-entering the same facts in two places and running two
-- P&L engines that could disagree — the riskier, not the safer, design for
-- a one-person-run business.
--
-- WHAT THIS FILE DOES INSTEAD: takes the one genuinely new, valuable idea
-- from the document — a P&L broken out BY MARKETPLACE/CHANNEL (its
-- "Marketplace Profitability" panel: Sales / Fees / Ad Spend / ROAS /
-- Shipping / Profit per marketplace) — and builds it the same way every
-- other P&L view in this app is built: a SQL view over the EXISTING
-- schema, grouped by `stores` instead of `companies`/month. No new tables,
-- no new backend, nothing to keep in sync.
--
-- SCOPE LIMIT, STATED PLAINLY: purchase/production cost, washing chalans,
-- office/internal expenses, and the pre-orders CSV history are tracked
-- PER COMPANY in this schema, not per store — so this view cannot split
-- those across marketplaces the way "P&L by Company"/"P&L by Month" do.
-- What it CAN show per marketplace, because these ARE already tracked per
-- order/store: Sale Value (INR+USD), Courier, Duty, matched Marketplace/
-- Portal Fees (real-if-known else 25% estimate, same rule as the other
-- views), Ad Spend (from store_ad_spend, already store-level), and ROAS.
-- The result is "profit before company-wide overhead", clearly labelled as
-- such — not the full net profit the Company/Month tabs show. Cross-check:
-- summing this view's total_sale_value_inr across a company's stores
-- should equal that company's row in pl_dashboard_by_company_view.
--
-- Safe to re-run (DROP VIEW IF EXISTS before CREATE VIEW).

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
-- Same 3 marketplace-fee CTEs as pl_dashboard_by_company_view /
-- pl_dashboard_by_company_month_view, just carrying o.store_id through
-- instead of (or in addition to) o.company_id — identical join logic,
-- nothing new about how a fee gets matched to an order.
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
-- store_ad_spend is ALREADY per-store (see schema.sql comment: "one row
-- per (store, date) that has data" — Budget/Spend are the only stored
-- numbers, order count/value are always joined live from `orders`, exactly
-- the same principle this view follows for everything else).
ad_spend_agg AS (
  SELECT store_id,
    SUM(spend_usd)   AS ad_spend_usd,
    SUM(budget_usd)  AS ad_budget_usd
  FROM store_ad_spend
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
    COALESCE(ad.ad_budget_usd, 0)        AS ad_budget_usd
  FROM stores s
  JOIN companies comp                 ON comp.id = s.company_id
  LEFT JOIN order_agg oa              ON oa.store_id = s.id
  LEFT JOIN courier_agg ca            ON ca.store_id = s.id
  LEFT JOIN marketplace_fee_totals mf ON mf.store_id = s.id
  LEFT JOIN ad_spend_agg ad           ON ad.store_id = s.id
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
  (total_sale_value_inr - expense_courier_inr - expense_duty_inr
    - CASE WHEN portal_fees_matched_inr > 0 THEN portal_fees_matched_inr
           ELSE (total_sale_value_inr * 0.25) END)           AS net_before_overhead_inr,
  ((total_sale_value_inr - expense_courier_inr - expense_duty_inr
    - CASE WHEN portal_fees_matched_inr > 0 THEN portal_fees_matched_inr
           ELSE (total_sale_value_inr * 0.25) END)
    / NULLIF(total_sale_value_inr, 0))                        AS profit_pct_before_overhead,
  (total_sale_value_usd / NULLIF(ad_spend_usd, 0))            AS roas
FROM combined
ORDER BY total_sale_value_inr DESC NULLS LAST;

COMMENT ON VIEW pl_dashboard_by_store_view IS
  '2026-09-18 — "P&L by Marketplace" CRM tab. One row per store (= marketplace/channel: '
  'Amazon US, Etsy, Website, Wholesale, etc. — see stores.name). Shows Sale Value (INR+USD), '
  'Courier, Duty, matched Portal/Marketplace Fees (real-if-known else 25%% estimate, same rule '
  'as pl_dashboard_by_company_view), Ad Spend + ROAS (from store_ad_spend). Deliberately EXCLUDES '
  'purchase/production cost, washing, internal/office overhead, and pre-orders CSV history — those '
  'are tracked per COMPANY, not per store, in this schema. net_before_overhead_inr is therefore '
  'profit before that company-wide overhead, not the full net profit — use P&L by Company/Month '
  'for the complete picture. Sanity check: SUM(total_sale_value_inr) for one company''s stores '
  'should equal that company''s row in pl_dashboard_by_company_view.';

-- ============================================================================
-- Verification — run after applying.
-- ============================================================================
-- 1) Per-company store totals vs. the existing company view:
-- SELECT sv.company_id, sv.company_name,
--        SUM(sv.total_sale_value_inr) AS summed_from_stores,
--        cv.total_sale_value_inr      AS company_view_total,
--        SUM(sv.total_sale_value_inr) - cv.total_sale_value_inr AS diff
-- FROM pl_dashboard_by_store_view sv
-- JOIN pl_dashboard_by_company_view cv ON cv.company_id = sv.company_id
-- GROUP BY sv.company_id, sv.company_name, cv.total_sale_value_inr
-- ORDER BY ABS(SUM(sv.total_sale_value_inr) - cv.total_sale_value_inr) DESC;
--
-- 2) Eyeball a few real rows:
-- SELECT store_name, company_name, order_count, total_sale_value_inr,
--        total_sale_value_usd, portal_expense_effective_inr, ad_spend_usd, roas,
--        net_before_overhead_inr
-- FROM pl_dashboard_by_store_view
-- ORDER BY total_sale_value_inr DESC NULLS LAST
-- LIMIT 20;
