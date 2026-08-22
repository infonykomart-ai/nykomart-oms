-- 2026-08-17 — Two new "chalan" (delivery challan) document types, per the
-- user's own framing:
--
-- "AB JESE KACHA MAAL BAHR KISI PARTY KO DIYA TO USKA CHALAN KESE KATENGE
--  JIS SE YE PATA CHAL JAYE KI KONSA MAAL AAYA KONSA GAYA" — when raw
--  material is given OUT to a party (e.g. a job-work vendor), a chalan
--  should be issued so it's traceable.
--
-- "SHIPMENT BHI AGAR JAYEGI KI AAJ FEDEX 5 SHIPMENT DI TO USKA BHI CHALAN
--  KATE KI IS CHALAN NO SE 5 SHIPMENT FDEX KO GAYA" — when shipments are
--  handed to a courier, one chalan should group all of that day's handover
--  (e.g. "chalan X = these 5 orders went to FedEx").
--
-- Confirmed via follow-up questions: both types are wanted; Material OUT
-- Chalan needs MULTIPLE line items under one chalan (like Purchase Bill
-- Multi's one-invoice-many-orders pattern); Shipment Handover Chalan is
-- built by picking existing orders (which already have an AWB/tracking)
-- and grouping them under one chalan per courier+day.
--
-- Both reuse the exact same auto-numbering machinery as washing_entries
-- (reserve_next_number/format_document_no, see db/schema.sql section 9) —
-- new scope codes DOC_MOC / DOC_SHC so they don't collide with Washing
-- Entry's existing DOC_CH sequence. Format: NM/MOC/26-27/0001 and
-- NM/SHC/26-27/0001, consistent with every other document type in the app.
--
-- purchase_bills' own company_id gap (see the sibling migration
-- 2026-08-17-purchase-bills-optional-order-company-id.sql) is why both new
-- header tables get an explicit company_id — Stock (stock_in/stock_out)
-- itself is deliberately shared/company-agnostic (like parties), but every
-- OTHER document type in this app is company-scoped and its number carries
-- the company's short_code, so these two follow that same convention. The
-- app resolves it from whichever company is selected in the top-nav
-- switcher at the moment the chalan is created (employee.currentCompanyId)
-- — same pattern used everywhere else this session (Bill Payment,
-- Statements, Approvals, etc).
--
-- Dry-run tested against a local scratch Postgres (schema.sql + seeded
-- companies/parties): both tables, both triggers, sequential auto-
-- numbering (0001, 0002, ...), and the stock_out.chalan_id FK all verified
-- working before delivery.

BEGIN;

-- =============================================================================
-- MATERIAL OUT CHALAN — header + (existing) stock_out as its line items.
-- One chalan can now cover several SKU/qty rows going to the same party at
-- once; stock_out itself is unchanged in shape, it just gets an optional
-- link back to the chalan that grouped it.
-- =============================================================================
CREATE TABLE material_out_chalans (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  party_id       uuid NOT NULL REFERENCES parties(id),   -- who the raw material was given to
  chalan_no       text UNIQUE,     -- auto-assigned, format NM/MOC/26-27/0001
  chalan_date       date NOT NULL,
  remark              text,
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION trg_material_out_chalans_doc_no() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_code text; v_num int;
BEGIN
  SELECT short_code INTO v_code FROM companies WHERE id = NEW.company_id;
  v_num := reserve_next_number(NEW.company_id, 'DOC_MOC', true, NEW.chalan_date);
  NEW.chalan_no := format_document_no(v_code, 'MOC', fy_label(NEW.chalan_date), v_num);
  RETURN NEW;
END; $$;
CREATE TRIGGER material_out_chalans_before_insert BEFORE INSERT ON material_out_chalans
  FOR EACH ROW WHEN (NEW.chalan_no IS NULL) EXECUTE FUNCTION trg_material_out_chalans_doc_no();
CREATE INDEX idx_material_out_chalans_company ON material_out_chalans(company_id);
CREATE INDEX idx_material_out_chalans_party ON material_out_chalans(party_id);

ALTER TABLE stock_out ADD COLUMN chalan_id uuid REFERENCES material_out_chalans(id);
CREATE INDEX idx_stock_out_chalan ON stock_out(chalan_id);
COMMENT ON COLUMN stock_out.chalan_id IS
  'Set when this row was created via the Material OUT Chalan multi-line form — several stock_out rows can '
  'share one chalan_id. NULL for rows entered the old single-row way (chalan_no free text still works as before).';

-- =============================================================================
-- SHIPMENT HANDOVER CHALAN — header + line-per-order. Groups however many
-- orders were physically handed to one courier on one day under a single
-- auto-numbered chalan.
-- =============================================================================
CREATE TABLE shipment_handover_chalans (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  courier_party_id uuid NOT NULL REFERENCES parties(id),
  chalan_no        text UNIQUE,     -- auto-assigned, format NM/SHC/26-27/0001
  chalan_date        date NOT NULL,
  remark                text,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE OR REPLACE FUNCTION trg_shipment_handover_chalans_doc_no() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_code text; v_num int;
BEGIN
  SELECT short_code INTO v_code FROM companies WHERE id = NEW.company_id;
  v_num := reserve_next_number(NEW.company_id, 'DOC_SHC', true, NEW.chalan_date);
  NEW.chalan_no := format_document_no(v_code, 'SHC', fy_label(NEW.chalan_date), v_num);
  RETURN NEW;
END; $$;
CREATE TRIGGER shipment_handover_chalans_before_insert BEFORE INSERT ON shipment_handover_chalans
  FOR EACH ROW WHEN (NEW.chalan_no IS NULL) EXECUTE FUNCTION trg_shipment_handover_chalans_doc_no();
CREATE INDEX idx_shipment_handover_chalans_company ON shipment_handover_chalans(company_id);

CREATE TABLE shipment_handover_chalan_lines (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chalan_id   uuid NOT NULL REFERENCES shipment_handover_chalans(id) ON DELETE CASCADE,
  order_id      uuid NOT NULL REFERENCES orders(id),
  remark          text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- One order's shipment can only be handed over once — same reasoning as
  -- freight_bill_awb_assignments' UNIQUE(order_id) ("one AWB billed under
  -- exactly one freight invoice"): a shipment physically leaves once.
  UNIQUE (order_id)
);
CREATE INDEX idx_shipment_handover_lines_chalan ON shipment_handover_chalan_lines(chalan_id);

COMMIT;

-- Verify (should show the new tables with 0 rows each):
SELECT 'material_out_chalans' AS table_name, count(*) FROM material_out_chalans
UNION ALL
SELECT 'shipment_handover_chalans', count(*) FROM shipment_handover_chalans
UNION ALL
SELECT 'shipment_handover_chalan_lines', count(*) FROM shipment_handover_chalan_lines;
