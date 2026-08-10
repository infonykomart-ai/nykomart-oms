-- =====================================================================
-- Enable Row Level Security on every table in `public`, deny ANON,
-- allow AUTHENTICATED (logged-in) sessions everything.
--
-- CORRECTED 2026-08-10 — a first draft of this migration (from an
-- uploaded patch) enabled RLS with ZERO policies for both anon AND
-- authenticated. That draft's own safety-check only looked at the
-- BROWSER Supabase client (src/lib/supabase/client.ts, used by
-- logout-button.tsx and celebration-context.tsx — correctly found
-- neither calls .from()). It missed that almost every dashboard page
-- (src/app/dashboard/**/page.tsx, src/app/dashboard/layout.tsx, etc.)
-- calls the SERVER `createClient()` in src/lib/supabase/server.ts —
-- which is ALSO the anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY), just used
-- server-side with the cookie session via @supabase/ssr's
-- createServerClient(). A logged-in user's session maps to Postgres
-- role `authenticated`, not `service_role` — so "zero policies for
-- authenticated" would have silently emptied every real page in the
-- app the moment this ran (companies list, orders, invoices, everything
-- dashboard/layout.tsx fetches on every request) — effectively an
-- outage, not a security fix. Caught before running against production;
-- see claude/portal-payment-reconciliation-notes.md or the relevant
-- project doc for the full note.
--
-- WHY THIS SHAPE:
-- This app's real authorization model lives in
-- src/lib/auth/require-capability.ts, re-checked server-side on every
-- privileged action/page, using either the anon-key client (reads,
-- scoped by application code — e.g. `.in("id", employee.companyIds)`)
-- or the SERVICE ROLE client for actions that have already passed a
-- capability check (createServiceRoleClient() in
-- src/lib/supabase/server.ts — BYPASSRLS in Postgres regardless of
-- anything in this file, so completely unaffected either way).
--
-- What this file actually protects against is the ANON key used with NO
-- session at all — it ships in the browser bundle, so anyone can open
-- devtools and call the Supabase REST API directly with it, no login
-- required. Today (2026-08-08) nothing in src/components queries a
-- table directly with the anon browser client outside of a logged-in
-- session context (checked: only logout-button.tsx and
-- celebration-context.tsx use it, neither calls .from()) — but an
-- unauthenticated `anon` role request (no cookie, no session) hitting
-- Supabase's PostgREST endpoint directly is a real, always-present risk
-- independent of what the app's own UI code does, since anon grants
-- exist automatically in a fresh Supabase project.
--
-- Enabling RLS with a blanket ALLOW policy for `authenticated` and NO
-- policy for `anon` means: any actual logged-in session (which is what
-- every real page load in this app already is, once someone's logged
-- in) keeps working exactly as before, while an anonymous request with
-- only the public anon key and no session gets nothing, full stop. This
-- matches the app's actual security boundary today (the login screen +
-- Supabase Auth session), without requiring a rewrite of every page's
-- data-fetching to go through the service-role client.
--
-- Apply this AFTER db/schema.sql, same way (SQL Editor or psql -f).
-- Safe to re-run (ALTER TABLE ... ENABLE ROW LEVEL SECURITY and
-- CREATE POLICY ... are made idempotent below via DROP POLICY IF EXISTS
-- first).
-- =====================================================================

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

    -- One blanket policy per table: any AUTHENTICATED (logged-in via
    -- Supabase Auth) session can read/write, matching current behavior.
    -- `anon` gets no policy at all, so gets nothing — that's the actual
    -- fix. service_role bypasses RLS entirely regardless (BYPASSRLS),
    -- so is unaffected either way and needs no policy.
    EXECUTE format('DROP POLICY IF EXISTS allow_authenticated_all ON public.%I;', tbl);
    EXECUTE format(
      'CREATE POLICY allow_authenticated_all ON public.%I FOR ALL TO authenticated USING (true) WITH CHECK (true);',
      tbl
    );
  END LOOP;
END $$;

-- Sanity check you can run after applying: every table should show
-- exactly one policy, "allow_authenticated_all", roles = {authenticated}.
--
-- SELECT tablename, policyname, roles
-- FROM pg_policies
-- WHERE schemaname = 'public'
-- ORDER BY tablename;
--
-- And this should return 0 rows (no table has an anon-accessible policy):
--
-- SELECT tablename, policyname, roles
-- FROM pg_policies
-- WHERE schemaname = 'public' AND 'anon' = ANY(roles);
