-- 2026-09-30b — Part 2 of the B2B module, from the user's follow-up:
-- "PI / commercial invoice / or commercial document — jo jo chahiye ye
-- section bhi to chahiye na" + "jab koi inquiry daal raha hu to logout ho
-- raha baar baar".
--
-- 1. b2b_quotation_items — real line items per quotation (the quotation is
--    no longer one free-text subtotal; PI/CI documents print itemized
--    tables, so the money needs item rows). subtotal on the header stays
--    but is now maintained by the app as the SUM of item rows.
-- 2. b2b_documents — one row per issued COMMERCIAL DOCUMENT per quotation:
--    'PI' (Proforma Invoice), 'CI' (Commercial Invoice), 'PL' (Packing
--    List). doc_no is app-reserved per kind (PI/Q-26-27-0001/01 etc.), and
--    the issued date/print count make the "documents" section a real
--    register, not just a print button. Copies (the same document printed
--    again for the same buyer with a mark) are tracked via copy_no.
--
-- Run once on the live Supabase DB (same as the part-1 migration).

BEGIN;

-- ── Line items per quotation ────────────────────────────────────────────────
CREATE TABLE b2b_quotation_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id  uuid NOT NULL REFERENCES b2b_quotations(id) ON DELETE CASCADE,
  description   text NOT NULL,
  hsn_code      text,
  qty           numeric(12,3) NOT NULL CHECK (qty > 0),
  unit          text DEFAULT 'pcs',
  unit_price    numeric(14,2) NOT NULL CHECK (unit_price >= 0),
  line_total    numeric(14,2) GENERATED ALWAYS AS (round(qty * unit_price, 2)) STORED,
  display_order integer NOT NULL DEFAULT 0
);
CREATE INDEX idx_b2b_quotation_items_quotation ON b2b_quotation_items(quotation_id, display_order);

-- ── Commercial documents issued from a quotation ────────────────────────────
CREATE TABLE b2b_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id  uuid NOT NULL REFERENCES b2b_quotations(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES companies(id),
  doc_kind      text NOT NULL CHECK (doc_kind IN ('PI', 'CI', 'PL')),
  doc_no        text NOT NULL,          -- PI/Q-26-27-0001/01 (app-reserved)
  doc_date      date NOT NULL,
  copy_no       integer NOT NULL DEFAULT 1,   -- duplicate/triplicate marks on print
  printed_count integer NOT NULL DEFAULT 1,
  issued_by_employee_id uuid REFERENCES employees(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quotation_id, doc_kind, copy_no)
);
CREATE INDEX idx_b2b_documents_quotation ON b2b_documents(quotation_id);
CREATE INDEX idx_b2b_documents_company   ON b2b_documents(company_id, doc_date DESC);

ALTER TABLE b2b_quotation_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE b2b_documents       ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_authenticated_all ON b2b_quotation_items;
CREATE POLICY allow_authenticated_all ON b2b_quotation_items FOR ALL TO authenticated USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS allow_authenticated_all ON b2b_documents;
CREATE POLICY allow_authenticated_all ON b2b_documents FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;
