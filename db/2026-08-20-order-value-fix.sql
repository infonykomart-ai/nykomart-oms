-- 2026-08-20 — "Order Value (INR)" fix, confirmed by user this round.
--
-- The bug: `dispatch_invoices.org_sale_amt_inr` looked like the live
-- "order sale value" field and was read by freight_reconciliation_view,
-- duty_reconciliation_view, the Courier Bill Report / Duty & Tax Bill
-- Report printable pages, and the freight/duty AWB-assignment lookup box
-- — but NOTHING in the application ever writes it (confirmed by grep — it
-- only appears in report SELECTs, never an INSERT/UPDATE). It only ever
-- got a value from the one-time historical CSV import, so every order
-- dispatched since then shows Sale Amt (INR) = 0.00 in those reports and
-- every %-of-sale figure derived from it (shipping_pct, duty_pct,
-- shipping_and_duty_pct) came out wrong/blank. Confirmed live with the
-- user-supplied Courier Bill Report screenshot this round (SALE AMT (INR)
-- = 0.00 on every row of a 2026-05-28 invoice).
--
-- `orders.order_value_inr` is the correct field: APPLICATION-COMPUTED on
-- every order insert/edit (official exchange rate as of order_date, see
-- schema.sql's comment on the orders table), always populated ("NULL only
-- if truly unavailable"), and already used correctly elsewhere (Credit
-- Note form, Order Lookup box, Orders Report). This file repoints the two
-- affected views to it. The two affected report PAGES
-- (freight-bills/[id]/report, duty-bills/[id]/report) and the
-- lookupOrderForReconciliation action + duty-bill-section lookup display
-- are fixed in the same commit as this migration (application code, no
-- SQL needed for those).
--
-- Explicitly NOT touched by this fix, per the user's own framing
-- ("jo invoice value hai usd or inr vo sirf invoice ke liye hai" — invoice
-- value in USD/INR is only for the invoice itself): sales_invoices.
-- invoice_value_usd/invoice_value_inr stay exactly as they are — that's
-- the invoice DOCUMENT's own figure, a different concept from the order's
-- sale value, and nothing in this file changes it.
--
-- Also explicitly NOT touched here: the P&L Dashboard (crm/page.tsx, fed
-- by pl_dashboard_by_company_view / pl_dashboard_by_month_view, which both
-- read from sale_profit_ledger). sale_profit_ledger is a SEPARATE,
-- deliberately-standalone table ("historical, CSV-imported, bypasses the
-- live order form ON PURPOSE" — see its own comment in schema.sql) with
-- its own total_value_inr column, not derived from orders or
-- dispatch_invoices at all. Repointing P&L to orders.order_value_inr would
-- be a much bigger, separate change (it would stop being fed by whatever
-- CSV process currently maintains it) — flagged back to the user rather
-- than guessed at in this file.
--
-- Dry-run tested against the local scratch Postgres (omstate) before
-- delivery — CREATE OR REPLACE VIEW with the exact same output column
-- list/types as before (org_sale_amt_inr stays the column name, aliased
-- from o.order_value_inr now instead of di.org_sale_amt_inr) so no
-- consuming code needs to change column references.

BEGIN;

CREATE OR REPLACE VIEW freight_reconciliation_view AS
SELECT
  a.id                    AS assignment_id,
  a.freight_bill_id,
  fb.invoice_no            AS freight_invoice_no,
  a.order_id,
  o.ref_no                  AS po_no,
  di.invoice_no,
  ic.name                    AS item_type,
  COALESCE(o.size_label, s.label) AS sizes,
  COALESCE(os.awb_no, di.awb_no) AS awb_no,
  di.buyer_country,
  o.order_value_inr          AS org_sale_amt_inr,
  di.our_freight_amt         AS our_shipping_amt,
  di.demand_surcharge_other_charge AS other_charges,
  di.total_amt                AS total_shipping_amt,
  di.gst_18pct_amt             AS gst_18pct,
  (COALESCE(di.total_amt,0) + COALESCE(di.gst_18pct_amt,0)) AS gross_shipping_amt,
  COALESCE((SELECT SUM(op.weight_kg) FROM order_packages op WHERE op.order_shipment_id = os.id), di.shipping_weight_kg)::numeric(10,3) AS our_weight,
  a.bill_weight_kg,
  COALESCE((SELECT SUM(op.volumetric_weight) FROM order_packages op WHERE op.order_shipment_id = os.id), di.volumetric_weight)::numeric(10,3) AS dimensional_weight,
  a.difference_amt,
  CASE WHEN COALESCE(o.order_value_inr, 0) = 0 THEN NULL
       ELSE (COALESCE(di.total_amt,0) + COALESCE(di.gst_18pct_amt,0)) / o.order_value_inr END AS shipping_pct,
  a.remark
FROM freight_bill_awb_assignments a
JOIN freight_bills fb        ON fb.id = a.freight_bill_id
JOIN orders o                 ON o.id = a.order_id
LEFT JOIN order_shipments os   ON os.id = a.order_shipment_id
LEFT JOIN dispatch_invoices di ON di.order_id = a.order_id
LEFT JOIN item_categories ic    ON ic.id = o.item_category_id
LEFT JOIN sizes s                ON s.id = o.size_id;

CREATE OR REPLACE VIEW duty_reconciliation_view AS
SELECT
  a.id                    AS assignment_id,
  a.duty_tax_bill_id,
  dtb.invoice_no            AS duty_invoice_no,
  a.order_id,
  o.ref_no                    AS po_no,
  di.invoice_no,
  ic.name                      AS item_type,
  COALESCE(o.size_label, s.label) AS sizes,
  COALESCE(os.awb_no, di.awb_no) AS awb_no,
  di.buyer_country,
  o.order_value_inr AS org_sale_amt_inr,
  frv.gross_shipping_amt         AS shipping_amt,
  a.duty_tax_amt_usd,
  a.duty_tax_amt_inr,
  a.other_charge,
  a.gst_18pct,
  (COALESCE(a.duty_tax_amt_inr,0) + COALESCE(a.other_charge,0) + COALESCE(a.gst_18pct,0)) AS duty_gross_amt,
  (COALESCE(frv.gross_shipping_amt,0) + COALESCE(a.duty_tax_amt_inr,0) + COALESCE(a.other_charge,0) + COALESCE(a.gst_18pct,0)) AS shipping_and_duty,
  CASE WHEN COALESCE(o.order_value_inr,0) = 0 THEN NULL
       ELSE (COALESCE(frv.gross_shipping_amt,0) + COALESCE(a.duty_tax_amt_inr,0) + COALESCE(a.other_charge,0) + COALESCE(a.gst_18pct,0)) / o.order_value_inr
  END AS shipping_and_duty_pct,
  CASE WHEN COALESCE(o.order_value_inr,0) = 0 THEN NULL ELSE frv.gross_shipping_amt / o.order_value_inr END AS shipping_pct,
  CASE WHEN COALESCE(o.order_value_inr,0) = 0 THEN NULL
       ELSE (COALESCE(a.duty_tax_amt_inr,0) + COALESCE(a.other_charge,0) + COALESCE(a.gst_18pct,0)) / o.order_value_inr
  END AS duty_pct,
  a.remark
FROM duty_bill_awb_assignments a
JOIN duty_tax_bills dtb        ON dtb.id = a.duty_tax_bill_id
JOIN orders o                   ON o.id = a.order_id
LEFT JOIN order_shipments os     ON os.id = a.order_shipment_id
LEFT JOIN dispatch_invoices di   ON di.order_id = a.order_id
LEFT JOIN item_categories ic      ON ic.id = o.item_category_id
LEFT JOIN sizes s                  ON s.id = o.size_id
LEFT JOIN freight_reconciliation_view frv ON frv.order_id = a.order_id;

COMMIT;

-- Verification (run after commit):
-- select po_no, org_sale_amt_inr, shipping_pct from freight_reconciliation_view order by po_no limit 20;
-- select po_no, org_sale_amt_inr, duty_pct from duty_reconciliation_view order by po_no limit 20;
