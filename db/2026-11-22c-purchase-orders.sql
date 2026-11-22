-- 2026-11-22c — Phase 3: the Purchase Order module (option (c) from the
-- approved plan).
--
-- WHAT THIS IS: a real, separate Purchase Order document that LINKS to one
-- order (`orders.id`) and reads that order's Close-Up photos through the
-- shared helper (src/lib/orders/closeup-photos.ts). It is not a second Order
-- page and it never stores its own copy of a photo.
--
-- NUMBERING: application-reserved, exactly like every other document in this
-- database — `reserve_next_number(company_id, 'PURCHASE_ORDER', false)` plus
-- `fy_label(po_date)`, formatted `NPO-<FY>-####` (see
-- src/app/dashboard/purchase-orders/actions.ts). The `NPO-` prefix keeps a
-- Purchase Order visibly distinct from an order's own `PO-####` reference.
--
-- RELATIONSHIPS:
--   purchase_orders.company_id        -> companies(id)   (required, scoped)
--   purchase_orders.order_id          -> orders(id)       (the linked order)
--   purchase_orders.supplier_party_id -> parties(id)      (vendor/supplier)
--   purchase_order_items.purchase_order_id -> purchase_orders(id) ON DELETE CASCADE
--
-- Deleting the linked order does NOT delete the PO (`ON DELETE SET NULL`);
-- the PO keeps its own header and lines, it simply has no order to read
-- close-up photos from any more. No order data is copied into this table.
--
-- Safe to re-run: both tables are IF NOT EXISTS and every index is IF NOT
-- EXISTS; no existing table, column, row or policy is modified.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS purchase_order_items;
--   DROP TABLE IF EXISTS purchase_orders;

BEGIN;

CREATE TABLE IF NOT EXISTS purchase_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  -- The single link to the order whose close-up photos this PO shows.
  order_id          uuid REFERENCES orders(id) ON DELETE SET NULL,
  po_no             text NOT NULL,
  supplier_party_id uuid REFERENCES parties(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'Draft'
                      CHECK (status IN ('Draft', 'Sent', 'Received', 'Cancelled')),
  po_date           date NOT NULL DEFAULT CURRENT_DATE,
  expected_date     date,
  currency          text,
  -- Sum of the lines, stored so the list/print never has to re-add numbers
  -- that were already frozen when the PO was saved.
  total_amount      numeric(14, 2) NOT NULL DEFAULT 0,
  created_by        uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, po_no)
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  sku_label         text,
  qty               integer NOT NULL DEFAULT 1 CHECK (qty > 0),
  unit_cost         numeric(14, 2) NOT NULL DEFAULT 0,
  sort_order        integer NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE purchase_orders IS
  '2026-11-22c: Purchase Order document. Links one order (order_id) and reads '
  'that order''s Close-Up photos (order_attachments / orders.photo_urls) at view '
  'and print time — no photo is copied into this table, so deleting a photo on '
  'the Order page also removes it from every PO. po_no is app-reserved '
  '(reserve_next_number scope PURCHASE_ORDER) as NPO-<FY>-####.';

COMMENT ON COLUMN purchase_orders.total_amount IS
  'Sum of purchase_order_items.qty * unit_cost at save time. Recalculated on '
  'every save/line change; never derived from the linked order.';

COMMENT ON TABLE purchase_order_items IS
  '2026-11-22c: one line per ordered item. sku_label is free text (the same '
  'label the order uses); there is no notes/description column by design.';

CREATE INDEX IF NOT EXISTS purchase_orders_company_date_idx
  ON purchase_orders (company_id, po_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS purchase_orders_order_idx
  ON purchase_orders (order_id);
CREATE INDEX IF NOT EXISTS purchase_orders_supplier_idx
  ON purchase_orders (supplier_party_id);
CREATE INDEX IF NOT EXISTS purchase_order_items_po_idx
  ON purchase_order_items (purchase_order_id, sort_order);

-- Same RLS convention as every other operational table in this project.
ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated_all ON purchase_orders;
CREATE POLICY allow_authenticated_all ON purchase_orders
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated_all ON purchase_order_items;
CREATE POLICY allow_authenticated_all ON purchase_order_items
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- ============================================================================
-- Verification (read-only; run after the migration)
-- ============================================================================
-- 1) Tables + columns exist:
--    SELECT column_name, data_type, is_nullable
--      FROM information_schema.columns
--     WHERE table_name IN ('purchase_orders', 'purchase_order_items')
--     ORDER BY table_name, ordinal_position;
-- 2) No existing data moved (orders total must not change):
--    SELECT count(*) AS orders FROM orders;
-- 3) Indexes exist:
--    SELECT indexname, indexdef FROM pg_indexes
--     WHERE tablename IN ('purchase_orders', 'purchase_order_items');
-- 4) First PO number reserves cleanly (safe to check; it consumes a counter):
--    SELECT fy_label(CURRENT_DATE) AS fy,
--           format_document_no('NYKO', 'PURCHASE_ORDER', fy_label(CURRENT_DATE),
--                              reserve_next_number('<company uuid>', 'PURCHASE_ORDER', false, CURRENT_DATE));
