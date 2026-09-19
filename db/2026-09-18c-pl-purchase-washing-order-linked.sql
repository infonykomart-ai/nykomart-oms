-- 2026-09-18 (evening, round 8) — owner correction on Rounds 6/7's "Other"
-- bucket:
--
--   "dusri baat aap kah rahe ho purchase cost, washing, office overhead
--   shamil nahi hai. lekin agar purchase ho raha hai to order ke against
--   me ho raha hai na or washing bhi ho raha hai to order ke against me ho
--   raha hai. abhi data pura manage nahi hai to kya hua new fy se pura
--   manage ho jayega."
--
-- Correct — checked db/schema.sql before this file: `purchase_bills` HAS
-- an `order_id` column (line ~988, "optional make-to-order reference") and
-- `washing_entries` HAS BOTH `order_id` (line ~1500, "optional PO/RF/RG
-- reference") AND ITS OWN `store_id` (line ~1508) already. Rounds 6/7's
-- claim that these "aren't tracked per order" was wrong for the rows that
-- DO have that link filled in — it's only unlinked rows (raw-material
-- stock purchases with no PO, or old entries from before this field was
-- used consistently) that genuinely can't be attributed to a
-- marketplace/country. And as the owner says: whatever fraction is linked
-- today, entering it consistently going forward (new FY) makes this
-- automatically more complete over time — no further code change needed
-- for that improvement, since both objects below already prefer the link
-- when present.
--
-- What changes here:
--   1. pl_dashboard_by_store_view (db/2026-09-18-pl-by-marketplace-store.sql)
--      gains expense_purchase_inr / expense_washing_inr — purchase bills
--      attributed via order_id -> orders.store_id; washing attributed via
--      washing_entries' OWN store_id column (more direct/reliable than
--      going through order_id). net_before_overhead_inr now subtracts
--      these too — renamed in spirit to "before OFFICE overhead" (internal_
--      expenses is the only thing left that's genuinely untrackable per
--      store: rent/salary/electricity aren't tied to any one order).
--      Unlinked purchase bills (no order_id at all) are company-wide and
--      CANNOT appear on this per-store view by definition — see the new
--      finance_dashboard_unlinked_purchase_washing() function below for
--      visibility into exactly how much that is right now.
--   2. finance_dashboard_monthly() (db/2026-09-18b-finance-dashboard-rpc.sql)
--      gains the same two figures, filter-aware: with no Marketplace/
--      Country filter, ALL purchase/washing in the date range counts
--      (linked or not) — same total as before. With a filter active, ONLY
--      entries linked to a matching order (or, for washing, matching via
--      its own store_id) count — unlinked rows are correctly excluded
--      from a specific marketplace's/country's figures, since they can't
--      be confirmed to belong there.
--   3. New function finance_dashboard_unlinked_purchase_washing(p_company_id,
--      p_from, p_to) — a simple count+total of purchase bills / washing
--      entries in range with NO order_id, so the Finance Dashboard can show
--      "₹X across N bills not yet linked to an order" instead of silently
--      folding them into "Other" with no visibility. This is the number
--      that should shrink toward zero as linking becomes consistent.
--
-- Run this AFTER db/2026-09-18-pl-by-marketplace-store.sql and
-- db/2026-09-18b-finance-dashboard-rpc.sql (both already delivered,
-- possibly not yet run — this file only extends what they created; if
-- neither has been run yet, run all 3 in order: -store.sql, -rpc.sql, this
-- one). Safe to re-run.

-- ============================================================================
-- 1. pl_dashboard_by_store_view — append expense_purchase_inr / expense_washing_inr
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
-- NEW — purchase bills attributed to a store via their order's store_id.
-- Only bills WITH order_id filled in can appear here at all (a raw-
-- material stock purchase with no order has no store to attribute to).
purchase_agg AS (
  SELECT o.store_id, SUM(pb.g_total_plus_gst) AS purchase_inr
  FROM purchase_bills pb
  JOIN orders o ON o.id = pb.order_id
  GROUP BY o.store_id
),
-- NEW — washing entries attributed via their OWN store_id column (set
-- directly on the entry — more reliable than going through order_id).
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
    COALESCE(pa.purchase_inr, 0)         AS expense_purchase_inr,
    COALESCE(wa.washing_inr, 0)          AS expense_washing_inr
  FROM stores s
  JOIN companies comp                 ON comp.id = s.company_id
  LEFT JOIN order_agg oa              ON oa.store_id = s.id
  LEFT JOIN courier_agg ca            ON ca.store_id = s.id
  LEFT JOIN marketplace_fee_totals mf ON mf.store_id = s.id
  LEFT JOIN ad_spend_agg ad           ON ad.store_id = s.id
  LEFT JOIN purchase_agg pa           ON pa.store_id = s.id
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
  '2026-09-18 (round 8) — now includes expense_purchase_inr/expense_washing_inr, attributed via '
  'purchase_bills.order_id and washing_entries.store_id (both already exist on those tables). Only '
  'internal_expenses (office rent/salary/electricity — genuinely not tied to any order) remains '
  'outside net_before_overhead_inr. Purchase bills with no order_id are company-wide and cannot '
  'appear here — see finance_dashboard_unlinked_purchase_washing() for how much that is.';

-- ============================================================================
-- 2. finance_dashboard_monthly — append expense_purchase_inr / expense_washing_inr,
--    filter-aware (see header comment). Function signature is unchanged
--    (same 5 args) but the RETURNS TABLE shape changed, so DROP + CREATE
--    rather than CREATE OR REPLACE (Postgres refuses to change a function's
--    return columns via REPLACE).
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
-- NEW — purchase bills. No filter active: every bill in range counts
-- (linked or not — matches the company-wide total this used to be). A
-- Marketplace/Country filter active: ONLY bills linked (order_id) to an
-- order that itself matches the filter count — an unlinked bill can't be
-- confirmed to belong to this marketplace/country, so it's correctly left
-- out of a filtered view (still counted once you clear the filter).
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
-- NEW — washing entries. Same no-filter/filter-active split, but the store
-- filter uses washing_entries' OWN store_id (set directly on the entry,
-- more reliable than the optional order_id link); the country filter still
-- needs the order_id link since washing_entries has no country of its own.
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
  COALESCE(pa.purchase_inr, 0) AS expense_purchase_inr,
  COALESCE(wa.washing_inr, 0)  AS expense_washing_inr
FROM months m
LEFT JOIN order_agg oa          ON oa.month = m.month
LEFT JOIN courier_agg ca        ON ca.month = m.month
LEFT JOIN marketplace_fee_agg mfa ON mfa.month = m.month
LEFT JOIN ad_spend_agg ad       ON ad.month = m.month
LEFT JOIN returns_agg ra        ON ra.month = m.month
LEFT JOIN purchase_agg pa       ON pa.month = m.month
LEFT JOIN washing_agg wa        ON wa.month = m.month
ORDER BY m.month;
$$;

COMMENT ON FUNCTION finance_dashboard_monthly IS
  '2026-09-18 (round 8) — now includes expense_purchase_inr/expense_washing_inr, filter-aware: '
  'with no Marketplace/Country filter every bill/entry in range counts; with a filter active, only '
  'ones linked to a matching order count (washing via its own store_id; purchase via order_id). '
  'Internal/office overhead (rent, salary — genuinely not order-linked) is still added by the page '
  'itself from internal_expenses, unchanged.';

-- ============================================================================
-- 3. NEW — visibility into how much purchase/washing is NOT yet linked to
--    an order (the number that should shrink toward zero as data entry
--    gets more consistent, per the owner's "new FY se pura manage ho
--    jayega"). Company-wide only (an unlinked row has no store/country to
--    scope it to).
-- ============================================================================
CREATE OR REPLACE FUNCTION finance_dashboard_unlinked_purchase_washing(
  p_company_id uuid,
  p_from date,
  p_to date
)
RETURNS TABLE (
  unlinked_purchase_bill_count integer,
  unlinked_purchase_inr        numeric,
  unlinked_washing_entry_count integer,
  unlinked_washing_inr         numeric
)
LANGUAGE sql STABLE AS $$
  SELECT
    (SELECT COUNT(*)::int FROM purchase_bills
      WHERE company_id = p_company_id AND order_id IS NULL
        AND vendor_invoice_date >= p_from AND vendor_invoice_date <= p_to),
    (SELECT COALESCE(SUM(g_total_plus_gst), 0) FROM purchase_bills
      WHERE company_id = p_company_id AND order_id IS NULL
        AND vendor_invoice_date >= p_from AND vendor_invoice_date <= p_to),
    (SELECT COUNT(*)::int FROM washing_entries
      WHERE company_id = p_company_id AND order_id IS NULL
        AND chalan_date >= p_from AND chalan_date <= p_to),
    (SELECT COALESCE(SUM(COALESCE(amount,0) + COALESCE(debit_charges,0)), 0) FROM washing_entries
      WHERE company_id = p_company_id AND order_id IS NULL
        AND chalan_date >= p_from AND chalan_date <= p_to);
$$;

COMMENT ON FUNCTION finance_dashboard_unlinked_purchase_washing IS
  '2026-09-18 (round 8) — count + total of purchase bills / washing entries in a date range that '
  'have NO order_id, i.e. cannot be attributed to any marketplace/country. Shown on the Finance '
  'Dashboard as an explicit "not yet linked" figure — should trend toward zero as entry gets more '
  'consistent, per the owner''s own point that this is a data-entry-completeness issue, not a '
  'schema limitation.';

-- ============================================================================
-- Verification — run after applying.
-- ============================================================================
-- SELECT * FROM pl_dashboard_by_store_view ORDER BY total_sale_value_inr DESC LIMIT 10;
-- SELECT * FROM finance_dashboard_monthly(
--   (SELECT id FROM companies ORDER BY name LIMIT 1),
--   (CURRENT_DATE - INTERVAL '90 days')::date, CURRENT_DATE, NULL, NULL);
-- SELECT * FROM finance_dashboard_unlinked_purchase_washing(
--   (SELECT id FROM companies ORDER BY name LIMIT 1),
--   (CURRENT_DATE - INTERVAL '90 days')::date, CURRENT_DATE);
