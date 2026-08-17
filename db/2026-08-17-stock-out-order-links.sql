-- 2026-08-17 — "MAAAL BAHR SE KACHA MAAL BINA PO KE AA SKATA HAI LEKIN JA
-- NAHI SAKTA" — raw material can come IN as general stock (no PO, already
-- built earlier today), but going OUT should optionally link back to
-- whichever order(s) it's for. Follow-up answer: OPTIONAL, and MULTIPLE
-- orders per movement (one Stock Out / Material OUT Chalan line might
-- cover more than one order at once) — so this is a many-to-many join
-- table, not a single order_id column.
--
-- Applies uniformly to BOTH the plain Stock Out form and every Material
-- OUT Chalan line, since a Material OUT Chalan line IS a stock_out row
-- under the hood (see 2026-08-17-material-out-and-shipment-handover-
-- chalans.sql) — one join table covers both.
--
-- Includes the allow_authenticated_all RLS policy from the start this
-- time — its absence on the last 2 new tables (material_out_chalans,
-- shipment_handover_chalans/_lines) caused a real live bug: rows saved
-- fine via the service-role client but didn't show up in the app's own
-- "Recent" list (which reads via the RLS-bound anon-key client). Verified
-- via Supabase SQL Editor that every existing table (stock_in, stock_out,
-- purchase_bills, washing_entries, ...) has exactly this same policy.
--
-- Dry-run tested against a local scratch Postgres before delivery.

BEGIN;

CREATE TABLE stock_out_order_links (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_out_id   uuid NOT NULL REFERENCES stock_out(id) ON DELETE CASCADE,
  order_id          uuid NOT NULL REFERENCES orders(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stock_out_id, order_id)
);
CREATE INDEX idx_stock_out_order_links_stock_out ON stock_out_order_links(stock_out_id);
CREATE INDEX idx_stock_out_order_links_order ON stock_out_order_links(order_id);

ALTER TABLE stock_out_order_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated_all ON stock_out_order_links
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- Verify (should show 1 row: allow_authenticated_all / authenticated / ALL / true / true):
SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies WHERE tablename = 'stock_out_order_links';
