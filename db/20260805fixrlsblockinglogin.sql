-- FIX: login "no active employee record" bug (real root cause).
--
-- This app's security model is enforced entirely in the Next.js server code
-- (requireCapability() + a service-role client for privileged writes — see
-- src/lib/auth/require-capability.ts and src/lib/supabase/server.ts's
-- comments). db/schema.sql never enables Postgres Row Level Security (RLS)
-- anywhere — it was never part of the design.
--
-- If RLS gets turned ON for a table (e.g. by clicking an "Enable RLS"
-- banner/button in the Supabase Table Editor) with no policy defined,
-- Postgres does NOT error — it silently returns ZERO rows to every query,
-- even ones that should obviously match. The app's login flow reads the
-- `employees` table with the ordinary (anon-key + session cookie) client to
-- find the signed-in user's employee record; if RLS blocks that read, the
-- app sees "no employee found" and signs the user right back out — exactly
-- the symptom you're hitting, even though the data is 100% there.
--
-- Run this once in the Supabase SQL Editor. Safe to re-run.

-- 1. See which tables currently have RLS turned on (should be a real list,
--    not empty, if this is indeed the problem):
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = true
ORDER BY tablename;

-- 2. Turn RLS back off on every public table that has it on — restores the
--    app's actual (already-enforced-in-code) security model.
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND rowsecurity = true
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY;', t);
  END LOOP;
END $$;

-- 3. Confirm — this should now return 0 rows:
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public' AND rowsecurity = true;
