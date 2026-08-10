-- Inventory / Stock for finished goods (pending item 4 — see
-- claude/order-lifecycle-inventory-tracking-adspend-requests-2026-08-08.md).
-- Scope confirmed with the user: auto-restock + an informational stock-
-- check popup at order entry ONLY — no manual Stock In/Out for finished
-- goods (that's out of scope for now; this is a DIFFERENT code space from
-- the existing raw-material `stock_items`/`stock_in`/`stock_out` module,
-- same separation that module's own schema comment already calls out).
--
-- Keyed the same loose way orders themselves store SKU/Size — free text
-- (item_category_id, sku_label, size_label) — matching the "hybrid
-- nullable-FK-plus-text-fallback" pattern used on `orders` itself, since
-- most real order rows don't have a `skus`/`sizes` FK set.
CREATE TABLE finished_stock (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_category_id  uuid NOT NULL REFERENCES item_categories(id),
  sku_label         text NOT NULL DEFAULT '',
  size_label        text NOT NULL DEFAULT '',
  qty               integer NOT NULL DEFAULT 0 CHECK (qty >= 0),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_category_id, sku_label, size_label)
);

-- Audit trail for every change to finished_stock — right now the only
-- writer is the auto-restock path (order cancelled + refunded + already
-- had a Purchase Bill against it — see saveOrderRefund in
-- src/app/dashboard/orders/actions.ts), so `reason` will only ever read
-- 'auto_restock_cancelled_order' today, but this is a plain append-only
-- ledger so a manual-adjustment reason can be added later without a
-- schema change.
CREATE TABLE finished_stock_movements (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_category_id      uuid NOT NULL REFERENCES item_categories(id),
  sku_label             text NOT NULL DEFAULT '',
  size_label            text NOT NULL DEFAULT '',
  qty_change            integer NOT NULL,
  reason                text NOT NULL,
  order_id              uuid REFERENCES orders(id),
  entry_by_employee_id  uuid REFERENCES employees(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_finished_stock_movements_order ON finished_stock_movements(order_id);

-- New capability for the read-only Inventory view (/dashboard/inventory).
-- No manual Stock In/Out capability needed — out of scope per the
-- confirmed design (auto-restock + order-entry popup only).
INSERT INTO capabilities (code, description) VALUES
  ('finished_stock_view', 'View finished-goods Inventory/Stock — auto-restocked from cancelled+refunded+already-purchased orders')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'finished_stock_view' FROM roles r
WHERE r.name IN ('Order Entry', 'Logistics', 'Finance', 'MD', 'Admin', 'Inventory')
ON CONFLICT DO NOTHING;

-- Confirm:
SELECT table_name FROM information_schema.tables WHERE table_name IN ('finished_stock', 'finished_stock_movements');
SELECT code, description FROM capabilities WHERE code = 'finished_stock_view';
