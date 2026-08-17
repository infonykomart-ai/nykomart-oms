-- 2026-08-17 — Purchase Bill GST (CGST+SGST / IGST) support.
--
-- "OR CGST & SGST KA OPTION IGST KA OPTION JO AUTO MATICLY RAHE ACCORDING
-- TO GST POLICY 2.5% 3% 4% 9%" — user confirmed via AskUserQuestion this
-- should be a MANUAL per-bill choice (not auto-detected): checked live,
-- most vendor parties (including Aaradhya Fabrics, the bill that started
-- this conversation) have no GST number on file at all, and auto-deciding
-- CGST+SGST-vs-IGST needs a reliable vendor-state vs company-state
-- comparison that isn't possible without that data. All 3 companies
-- (Nyko Mart / Rugara / CASA ARRA) are Rajasthan-registered (GSTIN prefix
-- "08"), confirmed via company_profiles.gstin.
--
-- gst_rate_pct is the CGST/SGST INDIVIDUAL rate (2.5 / 3 / 4 / 9) — total
-- GST is always double this, however it's itemized:
--   CGST_SGST: CGST = amount * rate%, SGST = amount * rate% (same rate,
--     two line items) — intra-state.
--   IGST: one line, IGST = amount * rate% * 2 — inter-state. Per Indian
--     GST law IGST rate = CGST rate + SGST rate, so the TOTAL tax is the
--     same either way; only how it's split/itemized differs.
-- Both nullable — a bill with no GST rate selected keeps total_amount
-- as the final amount (g_total_plus_gst falls back to total_amount, no
-- GST added), same as every bill entered before this feature existed.
--
-- g_total_plus_gst's old formula was a naive flat 5% (*1.05) applied to
-- EVERY bill. Not dead, unlike a first grep of src/ suggested — dropping
-- it fails with "net_revenue_view depends on column g_total_plus_gst"
-- (net_revenue_view AS SELECT ... SUM(g_total_plus_gst) FROM
-- purchase_bills — the CRM dashboard's all-time "Net Revenue" total
-- expenses figure). So this migration:
--   1. Keeps the flat-5% fallback for any bill where gst_rate_pct is NULL
--      (every bill entered before this feature, and any new bill where
--      nobody picks a rate) — Net Revenue's historical numbers don't
--      silently shift.
--   2. Uses the REAL selected rate once one is set on a bill, doubled
--      (CGST+SGST or IGST — see comment above, both total the same tax).
--   3. DROPs the view (required to drop/recreate the column it depends
--      on) then recreates it VERBATIM from db/schema.sql section 17 —
--      same query, unchanged, just re-pointed at the new column
--      definition.

BEGIN;

ALTER TABLE purchase_bills
  ADD COLUMN gst_rate_pct numeric(4,2) CHECK (gst_rate_pct IN (2.5, 3, 4, 9)),
  ADD COLUMN gst_type text CHECK (gst_type IN ('CGST_SGST', 'IGST'));

DROP VIEW net_revenue_view;

ALTER TABLE purchase_bills DROP COLUMN g_total_plus_gst;
ALTER TABLE purchase_bills
  ADD COLUMN g_total_plus_gst numeric(14,2) GENERATED ALWAYS AS (
    (qty * sq_feet * unit_rate)
    + (qty * sq_feet * unit_rate) * (CASE WHEN gst_rate_pct IS NOT NULL THEN gst_rate_pct * 2 ELSE 5 END / 100)
  ) STORED;

-- Recreated verbatim from db/schema.sql (section 17) — no changes besides
-- picking up the new g_total_plus_gst definition automatically.
CREATE VIEW net_revenue_view AS
SELECT
  (SELECT COALESCE(SUM(org_sale_amt_inr), 0) FROM dispatch_invoices)                                    AS total_value_inr,
  (
    (SELECT COALESCE(SUM(total_amt), 0) FROM freight_bills)
    + (SELECT COALESCE(SUM(gross_total_amt), 0) FROM duty_tax_bills)
    + (SELECT COALESCE(SUM(g_total_plus_gst), 0) FROM purchase_bills)
  )                                                                                                       AS total_expenses_inr,
  (
    (SELECT COALESCE(SUM(org_sale_amt_inr), 0) FROM dispatch_invoices)
    - (
        (SELECT COALESCE(SUM(total_amt), 0) FROM freight_bills)
        + (SELECT COALESCE(SUM(gross_total_amt), 0) FROM duty_tax_bills)
        + (SELECT COALESCE(SUM(g_total_plus_gst), 0) FROM purchase_bills)
      )
  )                                                                                                       AS net_total_value,
  ((SELECT COALESCE(SUM(org_sale_amt_inr), 0) FROM dispatch_invoices) * 0.25)                             AS portal_expenses_25pct,
  (
    (
      (SELECT COALESCE(SUM(org_sale_amt_inr), 0) FROM dispatch_invoices)
      - (
          (SELECT COALESCE(SUM(total_amt), 0) FROM freight_bills)
          + (SELECT COALESCE(SUM(gross_total_amt), 0) FROM duty_tax_bills)
          + (SELECT COALESCE(SUM(g_total_plus_gst), 0) FROM purchase_bills)
        )
    ) - ((SELECT COALESCE(SUM(org_sale_amt_inr), 0) FROM dispatch_invoices) * 0.25)
  )                                                                                                       AS net_earn;

COMMIT;

-- Verify:
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'purchase_bills' AND column_name IN ('gst_rate_pct', 'gst_type', 'g_total_plus_gst')
ORDER BY column_name;
SELECT * FROM net_revenue_view;
