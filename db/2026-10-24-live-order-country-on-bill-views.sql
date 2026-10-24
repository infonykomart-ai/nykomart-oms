-- 2026-10-24 — "FREIGHT ME ORDER COUNTRY AUTO NAHI AATI JESE KISI ORDER ME
-- COUNTRY MISTAKE THI OR SHEET GENRATE HONE KE BAAD THIK KARTE HAI TO VO
-- UPDATE NAHI HOTI SHEET ME. TO YE AUTO FATCH HONI CHAHIYE."
--
-- Both reconciliation views used to publish `di.buyer_country` — the copy of
-- the country that dispatch_invoices captured when the dispatch row was
-- created. Correcting the order afterwards (orders.destination_country /
-- orders.buyer_country) never reached that copy, so every regenerated sheet
-- kept printing the old country.
--
-- The views now publish the ORDER's own current value first, falling back to
-- the dispatch copy only for legacy rows that have neither. Column list,
-- order and types are unchanged, so this is a straight CREATE OR REPLACE —
-- nothing that reads these views needs to change.
--
-- Safe to run more than once.

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
  COALESCE(NULLIF(o.destination_country, ''), NULLIF(o.buyer_country, ''), di.buyer_country) AS buyer_country,
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
  COALESCE(NULLIF(o.destination_country, ''), NULLIF(o.buyer_country, ''), di.buyer_country) AS buyer_country,
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
