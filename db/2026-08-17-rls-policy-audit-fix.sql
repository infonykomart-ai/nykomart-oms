-- 2026-08-17 — RLS policy audit follow-up.
--
-- "EK CHIZ CONFERM KARNA KI SABHI COMPANY ME SARE KAAM JESA APN DECIDE
-- KIYA VESE HI HORAHA" — while confirming this, an audit of the codebase
-- turned up the same class of bug already found once this session (the
-- chalan tables — see db/2026-08-17-chalan-tables-rls-policy-fix.sql):
-- every table in this project is supposed to carry a single blanket
-- policy, `allow_authenticated_all` (RLS enabled, but permissive — real
-- authorization happens at the app layer via requireCapability() +
-- company_id checks, same as every other table). This convention is
-- dashboard-only, never tracked in db/schema.sql, so it's easy for a new
-- table's migration file to omit it — which doesn't break inserts
-- (service-role client bypasses RLS) but silently breaks every normal
-- app-level READ (anon-key, RLS-bound client), the exact bug already hit
-- once with material_out_chalans/shipment_handover_chalans.
--
-- Candidate tables below were found by grepping every db/2026-08-1x*.sql
-- migration for CREATE TABLE with no matching CREATE POLICY anywhere in
-- db/*.sql. Since the policy convention itself is dashboard-only, grep
-- alone can't prove which of these are ACTUALLY missing it live — so
-- this uses DROP POLICY IF EXISTS + CREATE POLICY for each one, which is
-- safe to run regardless of whether a given table already has it (no
-- "policy already exists" error, no risk from running this against a
-- table that turns out to already be fine).
--
-- shipglobal_seller_profiles / shipglobal_shipments are called out
-- specifically in the audit as HIGH CONFIDENCE gaps — their own migration
-- (db/2026-08-10-shipglobal-integration.sql) explicitly enables RLS with
-- no policy in the same file, the identical failure shape as the chalan
-- bug. The rest are lower-confidence (RLS might already be set from the
-- dashboard) but safe to include given the DROP-then-CREATE pattern.

BEGIN;

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'shipglobal_seller_profiles',
    'shipglobal_shipments',
    'holidays',
    'employee_salary',
    'daily_work_logs',
    'tasks',
    'employee_advances',
    'salary_payments',
    'leave_requests',
    'leave_coverage_assignments',
    'bill_pass_register_payments',
    'ebay_monthly_financial_statement',
    'amazon_transactions',
    'csb_filings'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS allow_authenticated_all ON public.%I', t);
      EXECUTE format(
        'CREATE POLICY allow_authenticated_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
        t
      );
    END IF;
  END LOOP;
END $$;

COMMIT;

-- Verify — should show one allow_authenticated_all / authenticated / ALL /
-- true / true row for every table above that actually exists in this DB.
SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE tablename IN (
  'shipglobal_seller_profiles', 'shipglobal_shipments', 'holidays', 'employee_salary',
  'daily_work_logs', 'tasks', 'employee_advances', 'salary_payments', 'leave_requests',
  'leave_coverage_assignments', 'bill_pass_register_payments',
  'ebay_monthly_financial_statement', 'amazon_transactions', 'csb_filings'
)
ORDER BY tablename;

-- Cross-check: any OTHER public table that still has RLS enabled but ZERO
-- policies at all (should return no rows once the above + the earlier
-- chalan-tables fix have both been run).
SELECT c.relname AS table_with_rls_but_no_policy
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relrowsecurity = true
  AND NOT EXISTS (
    SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname
  )
ORDER BY 1;
