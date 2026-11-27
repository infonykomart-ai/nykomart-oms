-- 2026-11-27 (audit fix #2 — RLS scope, HIGH) — every table that carries a
-- company_id gets a company-scoped policy instead of the blanket
-- `allow_authenticated_all ... USING (true)` that db/2026-08-08-enable-rls.sql
-- put on every table.
--
-- WHY THE BLANKET POLICY IS NOT ENOUGH: it only keeps ANON out. A signed-in
-- employee's session is the Postgres `authenticated` role, so anyone can open
-- the browser's Supabase client (the anon key ships in the bundle) and call
-- the REST API directly for EVERY company's rows — orders, invoices, payroll,
-- the WhatsApp log — regardless of the page's own
-- `.in("company_id", employee.companyIds)` filter. An app-level filter is not
-- a boundary once the client is tamperable.
--
-- WHAT THIS FILE DOES, IN ORDER
--   1. `auth_company_ids()` — a SECURITY DEFINER helper answering "which
--      company ids may this session act as", mirroring
--      src/lib/auth/require-capability.ts exactly: home company,
--      employee_company_access, and the company of any store they are
--      covering today (leave_coverage_assignments). Date is IST, matching
--      todayIST().
--   2. A guard: the helper must be owned by a role with BYPASSRLS. Otherwise
--      the policy on `employees` would call a function that reads `employees`
--      and recurse forever. Aborts loudly instead of hanging every query.
--   3. A loop over every public table with a NOT NULL company_id: drop the
--      blanket policy, create `company_scope_all` (FOR ALL, USING + WITH
--      CHECK `company_id = any (auth_company_ids())`). Writes stay allowed
--      inside the company, so no app flow changes; role/capability checks
--      remain the app's job exactly as before. This file only removes
--      cross-company access.
--   4. `order_whatsapp_messages` explicitly: its company_id is NULLABLE
--      (ON DELETE SET NULL), so it is not in the loop. Orphan rows with a
--      NULL company stay invisible to every company rather than becoming
--      readable to all.
--
-- DELIBERATELY NOT SCOPED HERE — company_id is nullable on these and a NULL
-- is a real shared/system row, not an orphan. Each needs a policy that
-- understands its own NULL meaning; until then they keep the blanket policy
-- (they are listed here so the regression test fails if a new nullable table
-- appears without a decision):
--   agreement_letterhead_settings, audit_log, automation_rules,
--   company_profiles, company_whatsapp_settings, courier_shipper_profiles,
--   entry_errors, expense_categories, fin_settings, holidays,
--   purchase_bills, shipglobal_seller_profiles
--
-- Idempotent — safe to re-run (DROP POLICY IF EXISTS + CREATE OR REPLACE).
-- Rollback is at the bottom in comments.

-- ---------------------------------------------------------------------------
-- 1. The company ids this session may act as.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_company_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  SELECT coalesce(array_agg(DISTINCT cid), '{}'::uuid[])
  FROM (
    -- Home company.
    SELECT e.company_id AS cid
      FROM public.employees e
     WHERE e.auth_user_id = (SELECT auth.uid())
       AND e.active
    UNION
    -- Companies this login may switch into.
    SELECT a.company_id
      FROM public.employee_company_access a
      JOIN public.employees e ON e.id = a.employee_id
     WHERE e.auth_user_id = (SELECT auth.uid())
       AND e.active
    UNION
    -- Companies of stores this login is covering today (leave coverage), the
    -- same union getAuthedEmployee() builds for companyIds.
    SELECT s.company_id
      FROM public.leave_coverage_assignments c
      JOIN public.employees e ON e.id = c.covering_employee_id
      JOIN public.stores s ON s.id = c.store_id
     WHERE e.auth_user_id = (SELECT auth.uid())
       AND e.active
       AND (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN c.from_date AND c.to_date
  ) scoped;
$fn$;

REVOKE ALL ON FUNCTION public.auth_company_ids() FROM public;
GRANT EXECUTE ON FUNCTION public.auth_company_ids() TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Refuse to install policies that would recurse.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  bypasses boolean;
BEGIN
  SELECT r.rolbypassrls INTO bypasses
    FROM pg_proc p
    JOIN pg_roles r ON r.oid = p.proowner
   WHERE p.oid = 'public.auth_company_ids()'::regprocedure;

  -- The SQL editor's `postgres` normally has BYPASSRLS already. If not, hand
  -- the function to service_role (also BYPASSRLS) before giving up.
  IF NOT coalesce(bypasses, false)
     AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'ALTER FUNCTION public.auth_company_ids() OWNER TO service_role';
    SELECT r.rolbypassrls INTO bypasses
      FROM pg_proc p
      JOIN pg_roles r ON r.oid = p.proowner
     WHERE p.oid = 'public.auth_company_ids()'::regprocedure;
  END IF;

  IF NOT coalesce(bypasses, false) THEN
    RAISE EXCEPTION
      'auth_company_ids() is owned by a role without BYPASSRLS. Its policy on employees would recurse; run this file as postgres (Supabase SQL editor) or service_role.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Every table with a NOT NULL company_id.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a
        ON a.attrelid = c.oid
       AND a.attname = 'company_id'
       AND a.attnotnull
       AND NOT a.attisdropped
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
     ORDER BY 1
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS allow_authenticated_all ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS company_scope_all ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY company_scope_all ON public.%I FOR ALL TO authenticated '
      'USING (company_id = any (public.auth_company_ids())) '
      'WITH CHECK (company_id = any (public.auth_company_ids()))',
      t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 4. The nullable-company_id table this fix is actually about.
-- ---------------------------------------------------------------------------
ALTER TABLE public.order_whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_whatsapp_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated_all ON public.order_whatsapp_messages;
DROP POLICY IF EXISTS company_scope_all ON public.order_whatsapp_messages;
CREATE POLICY company_scope_all ON public.order_whatsapp_messages
  FOR ALL TO authenticated
  USING (company_id = any (public.auth_company_ids()))
  WITH CHECK (company_id = any (public.auth_company_ids()));

-- ---------------------------------------------------------------------------
-- Verify after running (read-only):
--
--   -- Expect 102 (101 NOT NULL company_id tables + order_whatsapp_messages).
--   SELECT count(*) FROM pg_policies
--    WHERE schemaname = 'public' AND policyname = 'company_scope_all';
--
--   -- Expect 0 rows: no table with a NOT NULL company_id keeps the blanket
--   -- policy.
--   SELECT p.tablename
--     FROM pg_policies p
--     JOIN pg_class c ON c.relname = p.tablename
--     JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
--     JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'company_id'
--                        AND a.attnotnull AND NOT a.attisdropped
--    WHERE p.schemaname = 'public' AND p.policyname = 'allow_authenticated_all';
--
--   -- As two logins from different companies, the same query must return
--   -- different row counts:
--   --   SELECT company_id, count(*) FROM orders GROUP BY 1;
--
-- ROLLBACK (restores the previous, blanket behaviour):
--
--   DO $$
--   DECLARE t text;
--   BEGIN
--     FOR t IN
--       SELECT c.relname
--         FROM pg_class c
--         JOIN pg_namespace n ON n.oid = c.relnamespace
--         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attname = 'company_id'
--                            AND a.attnotnull AND NOT a.attisdropped
--        WHERE n.nspname = 'public' AND c.relkind = 'r'
--     LOOP
--       EXECUTE format('DROP POLICY IF EXISTS company_scope_all ON public.%I', t);
--       EXECUTE format('CREATE POLICY allow_authenticated_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true)', t);
--     END LOOP;
--   END $$;
--   DROP POLICY IF EXISTS company_scope_all ON public.order_whatsapp_messages;
--   CREATE POLICY allow_authenticated_all ON public.order_whatsapp_messages
--     FOR ALL TO authenticated USING (true) WITH CHECK (true);
--   DROP FUNCTION IF EXISTS public.auth_company_ids();
