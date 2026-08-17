-- 2026-08-17 — Purchase Bill Round Off field.
--
-- "ADD ROUNDOFF FILD" — follow-up to the AF/145 report: 524.20 MTR @
-- ₹69.00/MTR = ₹36,169.80, + CGST ₹904.25 + SGST ₹904.25 = ₹37,978.30,
-- but the vendor's own invoice rounds that down by ₹0.30 to an even
-- ₹37,978.00. There was no field to capture that manual adjustment line,
-- so the system total could never match the vendor's exact invoice value
-- to the paisa.
--
-- round_off_amt is a plain manual numeric field (NOT generated) — signed,
-- usually a small value like -0.30 or +0.15. CHECK keeps it sane (a real
-- round-off is always small; anything past ±1000 is almost certainly a
-- typo, e.g. someone fat-fingering a full amount into this field instead
-- of Unit Rate).
--
-- g_total_plus_gst (base + GST, see db/2026-08-17-purchase-bills-gst.sql)
-- now adds round_off_amt on top, so the invoice-value total shown
-- everywhere (Recent Purchase Bills list, net_revenue_view) already lands
-- on the vendor's exact figure once this is filled in — no separate
-- "final total" field needed. Same drop/recreate dance as the GST
-- migration: g_total_plus_gst is a GENERATED STORED column so it must be
-- dropped and re-added to change its formula, which drops
-- net_revenue_view (depends on it) too — recreated verbatim after.

BEGIN;

ALTER TABLE purchase_bills
  ADD COLUMN round_off_amt numeric(8,2) NOT NULL DEFAULT 0
    CHECK (round_off_amt >= -1000 AND round_off_amt <= 1000);

DROP VIEW net_revenue_view;

ALTER TABLE purchase_bills DROP COLUMN g_total_plus_gst;
ALTER TABLE purchase_bills
  ADD COLUMN g_total_plus_gst numeric(14,2) GENERATED ALWAYS AS (
    (qty * sq_feet * unit_rate)
    + (qty * sq_feet * unit_rate) * (CASE WHEN gst_rate_pct IS NOT NULL THEN gst_rate_pct * 2 ELSE 5 END / 100)
    + round_off_amt
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
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'purchase_bills' AND column_name IN ('round_off_amt', 'g_total_plus_gst')
ORDER BY column_name;
SELECT * FROM net_revenue_view;
