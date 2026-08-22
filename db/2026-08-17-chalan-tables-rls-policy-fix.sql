-- 2026-08-17 — RLS policy fix for the 2 new chalan migrations.
--
-- Bug found during live verification: material_out_chalans,
-- shipment_handover_chalans, and shipment_handover_chalan_lines were
-- created with Postgres's default RLS behavior (enabled, zero policies),
-- so every OTHER table in this project has a blanket
-- `allow_authenticated_all` policy — set up directly in the Supabase
-- dashboard at some point, not tracked in db/schema.sql, so it wasn't
-- visible when the 2026-08-17 chalan migration was written. Without it,
-- the app's normal (anon-key, RLS-bound) reads return 0 rows for these 3
-- tables — confirmed live: a Material OUT Chalan saved successfully
-- (via the service-role client, which bypasses RLS) but didn't show up in
-- its own "Recent" list (which reads via the RLS-bound client). All actual
-- authorization already happens at the app layer (requireCapability() +
-- company_id checks in actions.ts) — same as every other table here — so
-- this policy is intentionally permissive, matching the existing
-- convention exactly.
--
-- Verified via Supabase SQL Editor (read-only) before writing this: every
-- one of stock_in / stock_out / purchase_bills / washing_entries has
-- exactly one policy, name allow_authenticated_all, role authenticated,
-- cmd ALL, qual true, with_check true.

BEGIN;

CREATE POLICY allow_authenticated_all ON material_out_chalans
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY allow_authenticated_all ON shipment_handover_chalans
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY allow_authenticated_all ON shipment_handover_chalan_lines
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- Verify (should show 3 rows, all allow_authenticated_all / authenticated / ALL / true / true):
SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename IN ('material_out_chalans', 'shipment_handover_chalans', 'shipment_handover_chalan_lines');
