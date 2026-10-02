-- 2026-10-02d — B2B Export ERP ("B2B VALE SECTION KI KAMIYO KO PURA KARO"
-- + the full 44-section spec): the modules the existing /dashboard/b2b
-- register was missing, WITHOUT touching what already works.
--
-- WHAT SHIPS (all company-scoped, all RLS allow_authenticated_all like the
-- rest of the b2b family, all numbering app-reserved via the same
-- reserve_next_number() RPC the register uses):
--   1. b2b_buyers           — buyer/customer CRM profile (type, country,
--                             currency, payment/shipping terms, salesperson);
--                             CLV / outstanding / overdue are COMPUTED from
--                             orders + payments, never stored.
--   2. b2b_products         — product master with AUTO SKU (CD-1001 Cotton
--                             Dhurrie, CR-… Carpet, JR-… Jute Rug, CK-…
--                             Cotton Kurti, TC-… Table Cover — prefix per
--                             product type, number = 1000 + counter), common
--                             trade fields + `specs` jsonb for the
--                             type-specific rest, FOB/EXW/wholesale/cost
--                             prices, stock + min-stock for reorder alerts.
--   3. b2b_bom_items        — Bill of Material per SKU: consumption per unit
--                             + wastage %; requirement = qty × consumption ×
--                             (1 + wastage/100), computed in app code.
--   4. b2b_sales_orders     — SO-<FY>-#### with a real status pipeline
--                             (Confirmed → In Production → QC → Packing →
--                             Ready to Dispatch → Booked → In Transit →
--                             Delivered / Closed / Cancelled), FX snapshot,
--                             cost buckets for the order P&L ("why is profit
--                             low?"), and packing calculator outputs
--                             (cartons / net / gross / CBM).
--   5. b2b_sales_order_items— line items with unit_price AND unit_cost so
--                             product profitability is per line.
--   6. b2b_productions      — PRD-<FY>-####: planned vs produced with an
--                             auto completion %, configurable stage routing
--                             (default list = the spec's), priority, due
--                             date (feeds the deadline-near alert).
--   7. b2b_qc_inspections   — QC-<FY>-####: inspected / passed / rejected /
--                             rework; pass %, reject % and defect % are
--                             derived in app code from these four numbers.
--   8. b2b_shipments        — SHP-<FY>-####: Booking → Delivered statuses,
--                             ports, container/seal, BL/AWB, ETD/ETA
--                             (ETA in the past + not delivered = delayed,
--                             derived — no stored "Delayed" state).
--   9. b2b_order_payments   — the auto payment schedule (advance/balance/
--                             Net-30 instalments) with received amounts;
--                             receivable & overdue are computed.
--  10. b2b_followups        — polymorphic follow-up queue (buyer/inquiry/
--                             quotation/order/shipment) for the CRM
--                             reminder panel.
--  11. b2b_quotations +     — the costing engine columns: buyer link,
--      b2b_inquiries(+items)  incoterm, FX snapshot, discount, packing,
--                             freight, other costs, total cost. Gross
--                             profit = subtotal − cost_amount and margin %
--                             are computed in app code (never stored, so a
--                             later price edit can't leave a stale profit).
--
-- FREIGHT/INCOTERM are ALWAYS entered (or taken from a connected rate
-- source) — the app never guesses them, per the spec's own rule.
--
-- Run once on the live Supabase SQL Editor. Idempotent: every statement is
-- IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS, so
-- re-running (or running parts twice) is safe. The same DDL is folded into
-- db/schema.sql (final shape, CREATE TABLEs include these columns).

BEGIN;

-- ── 1. Buyer / customer CRM ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS b2b_buyers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  name              text NOT NULL,
  contact_person    text,
  email             text,
  phone             text,
  country           text,
  city              text,
  website           text,
  buyer_type        text NOT NULL DEFAULT 'Wholesaler' CHECK (buyer_type IN ('Retailer', 'Wholesaler', 'Importer', 'Distributor')),
  currency          varchar(3) NOT NULL DEFAULT 'USD' REFERENCES currencies(code),
  payment_terms     text,
  shipping_terms    text,
  salesperson       text,
  notes             text,
  active            boolean NOT NULL DEFAULT true,
  entered_by_employee_id uuid REFERENCES employees(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
CREATE INDEX IF NOT EXISTS idx_b2b_buyers_company ON b2b_buyers(company_id, name);

-- ── 2. Product master with auto SKU ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS b2b_products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  sku               text NOT NULL,           -- CD-1001 (app-reserved, scope B2B_SKU_<prefix>, number = 1000 + counter)
  name              text NOT NULL,
  product_type      text NOT NULL CHECK (product_type IN ('Cotton Dhurrie', 'Carpet', 'Jute Rug', 'Cotton Kurti', 'Table Cover')),
  category          text,
  collection        text,
  material          text,                     -- fabric / yarn base (common across the 5 types)
  design            text,
  color             text,
  size_label        text,                     -- e.g. "4 x 6 ft", "One Size"
  length_cm         numeric(10,2),
  width_cm          numeric(10,2),
  gsm               numeric(8,2),
  piece_weight_kg   numeric(10,3),
  specs             jsonb NOT NULL DEFAULT '{}'::jsonb,  -- type-specific fields (weave, pile height, sleeve, print, border…)
  unit              text NOT NULL DEFAULT 'pcs',
  moq               integer NOT NULL DEFAULT 0 CHECK (moq >= 0),
  production_days   integer NOT NULL DEFAULT 0 CHECK (production_days >= 0),
  packing_type      text,
  pieces_per_carton integer NOT NULL DEFAULT 0 CHECK (pieces_per_carton >= 0),
  carton_length_cm  numeric(10,2),
  carton_width_cm   numeric(10,2),
  carton_height_cm  numeric(10,2),
  fob_price         numeric(14,2) NOT NULL DEFAULT 0 CHECK (fob_price >= 0),
  exw_price         numeric(14,2) NOT NULL DEFAULT 0 CHECK (exw_price >= 0),
  wholesale_price   numeric(14,2) NOT NULL DEFAULT 0 CHECK (wholesale_price >= 0),
  cost_price        numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost_price >= 0),
  stock_qty         integer NOT NULL DEFAULT 0,
  min_stock_qty     integer NOT NULL DEFAULT 0 CHECK (min_stock_qty >= 0),
  active            boolean NOT NULL DEFAULT true,
  entered_by_employee_id uuid REFERENCES employees(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_b2b_products_company ON b2b_products(company_id, name);
CREATE INDEX IF NOT EXISTS idx_b2b_products_type    ON b2b_products(company_id, product_type);

-- ── 3. BOM (Bill of Material) per SKU ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS b2b_bom_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  product_id      uuid NOT NULL REFERENCES b2b_products(id) ON DELETE CASCADE,
  material        text NOT NULL,
  consumption     numeric(12,3) NOT NULL CHECK (consumption > 0),  -- per 1 finished unit
  unit            text NOT NULL DEFAULT 'pcs',                     -- m / yd / kg / g / pcs / ltr
  wastage_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (wastage_percent >= 0),
  display_order   integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_b2b_bom_items_product ON b2b_bom_items(product_id, display_order);

-- ── 4. Sales orders ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS b2b_sales_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  order_no          text NOT NULL,           -- SO-26-27-0001 (app-reserved, scope 'B2B_SO')
  buyer_id          uuid REFERENCES b2b_buyers(id) ON DELETE SET NULL,
  inquiry_id        uuid REFERENCES b2b_inquiries(id) ON DELETE SET NULL,
  quotation_id      uuid REFERENCES b2b_quotations(id) ON DELETE SET NULL,
  order_date        date NOT NULL,
  delivery_date     date,
  destination_country text,
  incoterm          text,
  payment_terms     text,
  currency          varchar(3) NOT NULL DEFAULT 'INR' REFERENCES currencies(code),
  exchange_rate     numeric(16,6) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0),  -- snapshot: 1 order-currency unit = X INR
  status            text NOT NULL DEFAULT 'Confirmed' CHECK (status IN ('Confirmed', 'In Production', 'QC', 'Packing', 'Ready to Dispatch', 'Booked', 'In Transit', 'Delivered', 'Closed', 'Cancelled')),
  -- cost buckets (app-maintained, all order-currency) for the order P&L
  sales_value       numeric(14,2) NOT NULL DEFAULT 0,   -- SUM(items), kept in sync by the app
  product_cost      numeric(14,2) NOT NULL DEFAULT 0,
  labour_cost       numeric(14,2) NOT NULL DEFAULT 0,
  packing_cost      numeric(14,2) NOT NULL DEFAULT 0,
  freight_cost      numeric(14,2) NOT NULL DEFAULT 0,
  documentation_cost numeric(14,2) NOT NULL DEFAULT 0,
  bank_charges      numeric(14,2) NOT NULL DEFAULT 0,
  other_costs       numeric(14,2) NOT NULL DEFAULT 0,
  -- packing calculator output (spec §20): cartons / weights / CBM
  pack_pcs_per_carton integer,
  pack_cartons      integer,
  pack_net_weight_kg  numeric(12,3),
  pack_gross_weight_kg numeric(12,3),
  pack_cbm          numeric(12,4),
  notes             text,
  entered_by_employee_id uuid REFERENCES employees(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, order_no)
);
CREATE INDEX IF NOT EXISTS idx_b2b_sales_orders_company ON b2b_sales_orders(company_id, order_date DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_sales_orders_status  ON b2b_sales_orders(company_id, status);
CREATE INDEX IF NOT EXISTS idx_b2b_sales_orders_buyer   ON b2b_sales_orders(buyer_id);

CREATE TABLE IF NOT EXISTS b2b_sales_order_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id      uuid NOT NULL REFERENCES b2b_sales_orders(id) ON DELETE CASCADE,
  product_id    uuid REFERENCES b2b_products(id) ON DELETE SET NULL,
  description   text NOT NULL,
  qty           numeric(12,2) NOT NULL CHECK (qty > 0),
  unit          text NOT NULL DEFAULT 'pcs',
  unit_price    numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_price >= 0),
  unit_cost     numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  line_total    numeric(14,2) GENERATED ALWAYS AS (round(qty * unit_price, 2)) STORED,
  line_cost     numeric(14,2) GENERATED ALWAYS AS (round(qty * unit_cost, 2)) STORED,
  display_order integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_b2b_sales_order_items_order ON b2b_sales_order_items(order_id, display_order);

-- ── 5. Production ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS b2b_productions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  production_no   text NOT NULL,             -- PRD-26-27-0001 (app-reserved, scope 'B2B_PRD')
  order_id        uuid REFERENCES b2b_sales_orders(id) ON DELETE SET NULL,
  product_id      uuid REFERENCES b2b_products(id) ON DELETE SET NULL,
  description     text NOT NULL,             -- product name snapshot (order may be deleted)
  planned_qty     numeric(12,2) NOT NULL CHECK (planned_qty > 0),
  produced_qty    numeric(12,2) NOT NULL DEFAULT 0 CHECK (produced_qty >= 0),
  start_date      date,
  due_date        date,
  status          text NOT NULL DEFAULT 'Planned' CHECK (status IN ('Planned', 'In Progress', 'Completed', 'Delayed')),
  current_stage   text NOT NULL DEFAULT 'Material Issue',
  stages          jsonb NOT NULL DEFAULT '["Material Issue","Cutting","Weaving","Stitching","Finishing","Washing","Ironing","Labeling","Packing","QC"]'::jsonb,
  priority        text NOT NULL DEFAULT 'Normal' CHECK (priority IN ('High', 'Normal', 'Low')),
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, production_no)
);
CREATE INDEX IF NOT EXISTS idx_b2b_productions_company ON b2b_productions(company_id, status);
CREATE INDEX IF NOT EXISTS idx_b2b_productions_order   ON b2b_productions(order_id);
CREATE INDEX IF NOT EXISTS idx_b2b_productions_due     ON b2b_productions(company_id, due_date) WHERE due_date IS NOT NULL AND status <> 'Completed';

-- ── 6. QC inspections ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS b2b_qc_inspections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  qc_no           text NOT NULL,             -- QC-26-27-0001 (app-reserved, scope 'B2B_QC')
  order_id        uuid REFERENCES b2b_sales_orders(id) ON DELETE SET NULL,
  production_id   uuid REFERENCES b2b_productions(id) ON DELETE SET NULL,
  product_id      uuid REFERENCES b2b_products(id) ON DELETE SET NULL,
  inspected_qty   numeric(12,2) NOT NULL CHECK (inspected_qty > 0),
  passed_qty      numeric(12,2) NOT NULL DEFAULT 0 CHECK (passed_qty >= 0),
  rejected_qty    numeric(12,2) NOT NULL DEFAULT 0 CHECK (rejected_qty >= 0),
  rework_qty      numeric(12,2) NOT NULL DEFAULT 0 CHECK (rework_qty >= 0),
  inspection_date date NOT NULL,
  inspector       text,
  remarks         text,
  entered_by_employee_id uuid REFERENCES employees(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, qc_no),
  CHECK (passed_qty + rejected_qty + rework_qty <= inspected_qty)
);
CREATE INDEX IF NOT EXISTS idx_b2b_qc_company ON b2b_qc_inspections(company_id, inspection_date DESC);
CREATE INDEX IF NOT EXISTS idx_b2b_qc_order   ON b2b_qc_inspections(order_id);

-- ── 7. Export shipments ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS b2b_shipments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  shipment_no       text NOT NULL,           -- SHP-26-27-0001 (app-reserved, scope 'B2B_SHP')
  order_id          uuid REFERENCES b2b_sales_orders(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'Booking' CHECK (status IN ('Booking', 'Ready', 'Stuffed', 'Departed', 'In Transit', 'Arrived', 'Delivered')),
  destination_country text,
  port_of_loading   text,
  port_of_discharge text,
  forwarder         text,
  shipping_line     text,
  container_no      text,
  seal_no           text,
  bl_awb            text,
  etd               date,
  eta               date,
  actual_departure  date,
  actual_arrival    date,
  freight_cost      numeric(14,2) NOT NULL DEFAULT 0,
  insurance_cost    numeric(14,2) NOT NULL DEFAULT 0,
  notes             text,
  entered_by_employee_id uuid REFERENCES employees(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, shipment_no)
);
CREATE INDEX IF NOT EXISTS idx_b2b_shipments_company ON b2b_shipments(company_id, status);
CREATE INDEX IF NOT EXISTS idx_b2b_shipments_order   ON b2b_shipments(order_id);
CREATE INDEX IF NOT EXISTS idx_b2b_shipments_eta     ON b2b_shipments(company_id, eta) WHERE eta IS NOT NULL;

-- ── 8. Order payment schedule ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS b2b_order_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  order_id        uuid NOT NULL REFERENCES b2b_sales_orders(id) ON DELETE CASCADE,
  label           text NOT NULL DEFAULT 'Instalment',   -- Advance / Balance / Instalment N
  due_date        date NOT NULL,
  amount          numeric(14,2) NOT NULL CHECK (amount > 0),
  received_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (received_amount >= 0),
  received_date   date,
  payment_mode    text,
  reference_no    text,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (received_amount <= amount)
);
CREATE INDEX IF NOT EXISTS idx_b2b_order_payments_order ON b2b_order_payments(order_id, due_date);
CREATE INDEX IF NOT EXISTS idx_b2b_order_payments_due   ON b2b_order_payments(company_id, due_date) WHERE received_amount < amount;

-- ── 9. Follow-up queue ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS b2b_followups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  entity_type     text NOT NULL CHECK (entity_type IN ('Buyer', 'Inquiry', 'Quotation', 'Order', 'Shipment')),
  entity_id       uuid NOT NULL,             -- polymorphic on purpose — no FK so any of the five can reference without cycles
  entity_label    text,                      -- denormalised name for the list (no join needed)
  due_date        date NOT NULL,
  note            text,
  done            boolean NOT NULL DEFAULT false,
  done_at         timestamptz,
  entered_by_employee_id uuid REFERENCES employees(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_b2b_followups_due  ON b2b_followups(company_id, due_date) WHERE NOT done;
CREATE INDEX IF NOT EXISTS idx_b2b_followups_ent  ON b2b_followups(entity_type, entity_id);

-- ── 10. Costing-engine columns on the existing register tables ─────────────
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS buyer_id        uuid REFERENCES b2b_buyers(id) ON DELETE SET NULL;
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS incoterm        text;
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS exchange_rate   numeric(16,6) NOT NULL DEFAULT 1 CHECK (exchange_rate > 0);  -- snapshot: 1 quote-currency unit = X INR
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS discount_amount numeric(14,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0);
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS packing_costs   numeric(14,2) NOT NULL DEFAULT 0 CHECK (packing_costs >= 0);
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS freight_amount  numeric(14,2) NOT NULL DEFAULT 0 CHECK (freight_amount >= 0);
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS other_costs     numeric(14,2) NOT NULL DEFAULT 0 CHECK (other_costs >= 0);
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS cost_amount     numeric(14,2) NOT NULL DEFAULT 0 CHECK (cost_amount >= 0);  -- product + packing + freight + other
ALTER TABLE b2b_quotations ADD COLUMN IF NOT EXISTS valid_from      date;

ALTER TABLE b2b_inquiries     ADD COLUMN IF NOT EXISTS buyer_id   uuid REFERENCES b2b_buyers(id) ON DELETE SET NULL;
ALTER TABLE b2b_inquiry_items ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES b2b_products(id) ON DELETE SET NULL;

-- ── RLS (same allow_authenticated_all posture as the rest of the b2b family
--      — server actions gate on b2b_inquiry + company scope) ────────────────
ALTER TABLE b2b_buyers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_products          ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_bom_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_sales_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_sales_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_productions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_qc_inspections    ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_shipments         ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_order_payments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_followups         ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_authenticated_all ON b2b_buyers;
CREATE POLICY allow_authenticated_all ON b2b_buyers FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_authenticated_all ON b2b_products;
CREATE POLICY allow_authenticated_all ON b2b_products FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_authenticated_all ON b2b_bom_items;
CREATE POLICY allow_authenticated_all ON b2b_bom_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_authenticated_all ON b2b_sales_orders;
CREATE POLICY allow_authenticated_all ON b2b_sales_orders FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_authenticated_all ON b2b_sales_order_items;
CREATE POLICY allow_authenticated_all ON b2b_sales_order_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_authenticated_all ON b2b_productions;
CREATE POLICY allow_authenticated_all ON b2b_productions FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_authenticated_all ON b2b_qc_inspections;
CREATE POLICY allow_authenticated_all ON b2b_qc_inspections FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_authenticated_all ON b2b_shipments;
CREATE POLICY allow_authenticated_all ON b2b_shipments FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_authenticated_all ON b2b_order_payments;
CREATE POLICY allow_authenticated_all ON b2b_order_payments FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_authenticated_all ON b2b_followups;
CREATE POLICY allow_authenticated_all ON b2b_followups FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;
