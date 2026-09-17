-- 2026-09-17 — RLS policy catch-all follow-up.
--
-- REAL BUG this fixes: "Shipper Profile — Not set up yet (save karne ke
-- baad bhi yahi aara)". courier_shipper_profiles (db/2026-09-01-multi-
-- courier-booking-and-freight-recon.sql) enables RLS but its migration
-- never added this project's blanket policy — same class of gap the
-- 2026-08-17 audit file (db/2026-08-17-rls-policy-audit-fix.sql) already
-- fixed once for older tables. Saves work (service-role client bypasses
-- RLS) but every page read through the anon-key browser client silently
-- returns NOTHING — so the saved profile looked like it was never saved.
-- The bank-recon tables from db/2026-09-17-bank-recon.sql have the same
-- gap (caught before it bit: that page currently reads via the
-- service-role client, but one refactor away from the same bug).
--
-- CONVENTION (db/2026-08-08-enable-rls.sql): EVERY table in public gets
-- RLS enabled + exactly one policy, allow_authenticated_all, for the
-- authenticated role only. Real authorization stays at the app layer
-- (requireCapability + company_id scoping). Rather than another
-- hand-listed audit, this loops EVERY public table — new tables created
-- after this file runs are still the migration author's responsibility,
-- but nothing existing can be missed.
--
-- Safe to re-run (DROP POLICY IF EXISTS + CREATE POLICY per table).
--
-- Sanity check after running — should return ZERO rows:
--   SELECT c.relname AS table_name
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--   WHERE c.relkind = 'r' AND n.nspname = 'public'
--   AND NOT EXISTS (
--     SELECT 1 FROM pg_policies p
--     WHERE p.schemaname = 'public' AND p.tablename = c.relname
--       AND 'authenticated' = ANY(p.roles));

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);
    EXECUTE format('DROP POLICY IF EXISTS allow_authenticated_all ON public.%I;', tbl);
    EXECUTE format(
      'CREATE POLICY allow_authenticated_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true);',
      tbl
    );
  END LOOP;
END $$;
