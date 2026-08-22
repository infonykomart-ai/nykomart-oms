-- 2026-08-20 — Gap 1 of the "5 real gaps" plan (see
-- claude/five-gaps-implementation-plan-2026-08-20.md and the full design
-- writeup at claude/gap1-multipackage-design-2026-08-20.md — read that
-- first if you're trying to understand WHY this is shaped the way it is).
--
-- Today, dispatch_invoices is "1 order = 1 AWB = 1 weight/dimension row"
-- (order_id uuid NOT NULL UNIQUE) — a real order that ships as N physical
-- packages, sometimes under N separate AWBs and sometimes all under one
-- shared AWB (courier/case-dependent, per the user's explicit answer),
-- cannot be represented at all today.
--
-- Two new tables, in a parent/child shape:
--   order_shipments — one row per REAL AWB used for an order. An order
--     with 3 packages all under one master AWB gets ONE order_shipments
--     row; an order whose courier splits it into 3 separate AWBs gets
--     THREE order_shipments rows. This is deliberately the unit that
--     freight/duty billing keys off (a courier bills PER AWB — "TRACKING
--     NUMBER KE AGAINST ME AAYEGA" per the original freight_bill_awb_
--     assignments comment), and the unit courier webhooks match against
--     (a webhook event always names exactly one AWB).
--   order_packages — one row per physical box/parcel, FK'd to the
--     order_shipments row (AWB) it travels under. Carries the per-packet
--     weight/dimension the original ask was about.
--
-- dispatch_invoices is NOT dropped or restructured — too many existing
-- read paths depend on its current shape (order list display, invoice
-- auto-pull fallback, the order-delete guard, courier-bill-PDF matching
-- for backward compat). It becomes an order-level SUMMARY, kept in sync
-- by application code (src/lib/order-packages/resync-dispatch-summary.ts)
-- every time order_shipments/order_packages change for that order — same
-- "business rules live in app code, not triggers" convention this schema
-- already uses for order ref-no assignment etc. Sync rule: awb_no/
-- courier_name become the single shared value when every shipment agrees,
-- else a comma-joined display list; shipping_weight_kg/volumetric_weight
-- become the SUM across every package; delivered_status becomes
-- 'Delivered' only once EVERY shipment for that order is Delivered
-- (weakest-link — an order isn't done if 1 of 3 boxes hasn't arrived).
-- That weakest-link assumption was flagged to and confirmed by the user
-- (2026-08-20) rather than silently assumed.
--
-- Retroactive backfill (also confirmed required, not just new-orders-only):
-- every existing order that has a dispatch_invoices row gets exactly one
-- order_shipments row (shipment_no=1, copying courier_name/awb_no/
-- delivered_status/delivered_date) and one order_packages row under it
-- (package_no=1, copying weight/dims) — so nothing regresses and every
-- already-dispatched order has a valid package-1 record to build on.
--
-- freight_bill_awb_assignments / duty_bill_awb_assignments move from
-- keying UNIQUE(order_id) to UNIQUE(order_shipment_id) — this is the
-- actual point of "full rearchitecture": one order with 3 AWBs can now
-- get 3 separate bill-assignment rows (one per real AWB actually billed),
-- instead of being artificially capped at exactly one assignment per
-- order. order_id is KEPT on both tables (now populated FROM the shipment
-- row, not independently) purely so every existing query/view/display
-- that filters or joins by order_id keeps working unchanged.
--
-- No new capability — package entry reuses 'doc_entry' (Finance/MD/Admin),
-- the same capability that already gates every other Documents-module
-- entry screen (Courier Bill, Duty & Tax Bill, Washing Data, etc.) this
-- naturally belongs alongside.

BEGIN;

CREATE TABLE order_shipments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id                uuid NOT NULL REFERENCES orders(id),
  shipment_no             integer NOT NULL,   -- 1-based; "shipment i of N" when an order has >1 AWB
  courier_name            text,
  awb_no                  text,
  delivered_status        delivered_status,
  delivered_date          date,
  last_update_date        date,
  remark                  text,
  created_by_employee_id  uuid REFERENCES employees(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (shipment_no > 0),
  UNIQUE (order_id, shipment_no)
);
CREATE INDEX idx_order_shipments_order ON order_shipments(order_id);
CREATE INDEX idx_order_shipments_awb   ON order_shipments(awb_no);

ALTER TABLE order_shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_shipments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated_all ON order_shipments;
CREATE POLICY allow_authenticated_all ON order_shipments FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE TABLE order_packages (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_shipment_id  uuid NOT NULL REFERENCES order_shipments(id),
  package_no         integer NOT NULL,   -- 1-based within the shipment — "i of N" on the physical label
  weight_kg          numeric(10,3),
  length_cm          numeric(10,2),
  width_cm           numeric(10,2),
  height_cm          numeric(10,2),
  volumetric_weight  numeric(10,3),
  remark             text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (package_no > 0),
  UNIQUE (order_shipment_id, package_no)
);
CREATE INDEX idx_order_packages_shipment ON order_packages(order_shipment_id);

ALTER TABLE order_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_packages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated_all ON order_packages;
CREATE POLICY allow_authenticated_all ON order_packages FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Retroactive backfill — one shipment (1) + one package (1) per existing
-- dispatch_invoices row, so every already-dispatched order keeps working.
-- ---------------------------------------------------------------------------
INSERT INTO order_shipments (order_id, shipment_no, courier_name, awb_no, delivered_status, delivered_date, last_update_date, remark, created_at)
SELECT di.order_id, 1, di.courier_name, di.awb_no, di.delivered_status, di.delivered_date, di.last_update_date, di.remark, di.created_at
FROM dispatch_invoices di;

INSERT INTO order_packages (order_shipment_id, package_no, weight_kg, length_cm, width_cm, height_cm, volumetric_weight, created_at)
SELECT os.id, 1, di.shipping_weight_kg, di.length_cm, di.width_cm, di.height_cm, di.volumetric_weight, di.created_at
FROM order_shipments os
JOIN dispatch_invoices di ON di.order_id = os.order_id AND os.shipment_no = 1;

-- ---------------------------------------------------------------------------
-- freight_bill_awb_assignments / duty_bill_awb_assignments: retarget from
-- order-level to shipment(=AWB)-level uniqueness.
-- ---------------------------------------------------------------------------
ALTER TABLE freight_bill_awb_assignments ADD COLUMN order_shipment_id uuid REFERENCES order_shipments(id);
UPDATE freight_bill_awb_assignments a
SET order_shipment_id = os.id
FROM order_shipments os
WHERE os.order_id = a.order_id AND os.shipment_no = 1;
ALTER TABLE freight_bill_awb_assignments ALTER COLUMN order_shipment_id SET NOT NULL;
ALTER TABLE freight_bill_awb_assignments DROP CONSTRAINT freight_bill_awb_assignments_order_id_key;
ALTER TABLE freight_bill_awb_assignments ADD CONSTRAINT freight_bill_awb_assignments_order_shipment_id_key UNIQUE (order_shipment_id);
CREATE INDEX idx_freight_awb_assign_shipment ON freight_bill_awb_assignments(order_shipment_id);

ALTER TABLE duty_bill_awb_assignments ADD COLUMN order_shipment_id uuid REFERENCES order_shipments(id);
UPDATE duty_bill_awb_assignments a
SET order_shipment_id = os.id
FROM order_shipments os
WHERE os.order_id = a.order_id AND os.shipment_no = 1;
ALTER TABLE duty_bill_awb_assignments ALTER COLUMN order_shipment_id SET NOT NULL;
ALTER TABLE duty_bill_awb_assignments DROP CONSTRAINT duty_bill_awb_assignments_order_id_key;
ALTER TABLE duty_bill_awb_assignments ADD CONSTRAINT duty_bill_awb_assignments_order_shipment_id_key UNIQUE (order_shipment_id);
CREATE INDEX idx_duty_awb_assign_shipment ON duty_bill_awb_assignments(order_shipment_id);

-- ---------------------------------------------------------------------------
-- Reconciliation views: pull the per-AWB awb_no/courier_name/weight from
-- the specific order_shipments/order_packages row the assignment actually
-- points at (accurate per-AWB now), instead of dispatch_invoices' order-
-- level summary (which can be a multi-value join once an order has >1 AWB).
-- di.* (org_sale_amt_inr, our_freight_amt, charges, gst, invoice_no) stays
-- from dispatch_invoices — those are order-level billing figures, not
-- per-package/per-AWB, and are out of scope for this round (see design doc).
-- ---------------------------------------------------------------------------
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
  di.org_sale_amt_inr,
  di.our_freight_amt         AS our_shipping_amt,
  di.demand_surcharge_other_charge AS other_charges,
  di.total_amt                AS total_shipping_amt,
  di.gst_18pct_amt             AS gst_18pct,
  (COALESCE(di.total_amt,0) + COALESCE(di.gst_18pct_amt,0)) AS gross_shipping_amt,
  COALESCE((SELECT SUM(op.weight_kg) FROM order_packages op WHERE op.order_shipment_id = os.id), di.shipping_weight_kg)::numeric(10,3) AS our_weight,
  a.bill_weight_kg,
  COALESCE((SELECT SUM(op.volumetric_weight) FROM order_packages op WHERE op.order_shipment_id = os.id), di.volumetric_weight)::numeric(10,3) AS dimensional_weight,
  a.difference_amt,
  CASE WHEN COALESCE(di.org_sale_amt_inr, 0) = 0 THEN NULL
       ELSE (COALESCE(di.total_amt,0) + COALESCE(di.gst_18pct_amt,0)) / di.org_sale_amt_inr END AS shipping_pct,
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
  di.org_sale_amt_inr,
  frv.gross_shipping_amt         AS shipping_amt,
  a.duty_tax_amt_usd,
  a.duty_tax_amt_inr,
  a.other_charge,
  a.gst_18pct,
  (COALESCE(a.duty_tax_amt_inr,0) + COALESCE(a.other_charge,0) + COALESCE(a.gst_18pct,0)) AS duty_gross_amt,
  (COALESCE(frv.gross_shipping_amt,0) + COALESCE(a.duty_tax_amt_inr,0) + COALESCE(a.other_charge,0) + COALESCE(a.gst_18pct,0)) AS shipping_and_duty,
  CASE WHEN COALESCE(di.org_sale_amt_inr,0) = 0 THEN NULL
       ELSE (COALESCE(frv.gross_shipping_amt,0) + COALESCE(a.duty_tax_amt_inr,0) + COALESCE(a.other_charge,0) + COALESCE(a.gst_18pct,0)) / di.org_sale_amt_inr
  END AS shipping_and_duty_pct,
  CASE WHEN COALESCE(di.org_sale_amt_inr,0) = 0 THEN NULL ELSE frv.gross_shipping_amt / di.org_sale_amt_inr END AS shipping_pct,
  CASE WHEN COALESCE(di.org_sale_amt_inr,0) = 0 THEN NULL
       ELSE (COALESCE(a.duty_tax_amt_inr,0) + COALESCE(a.other_charge,0) + COALESCE(a.gst_18pct,0)) / di.org_sale_amt_inr
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

-- Verification (commented out):
-- SELECT count(*) FROM order_shipments;                                    -- should equal count(*) FROM dispatch_invoices
-- SELECT count(*) FROM order_packages;                                     -- should equal count(*) FROM order_shipments (1:1 at backfill time)
-- SELECT count(*) FROM freight_bill_awb_assignments WHERE order_shipment_id IS NULL;  -- should be 0
-- SELECT count(*) FROM duty_bill_awb_assignments WHERE order_shipment_id IS NULL;     -- should be 0
-- SELECT * FROM freight_reconciliation_view LIMIT 5;
