-- =====================================================================
-- 2026-10-19 — Leave approvers: "jaruri nahi hai ki leave MD approve kare
-- ... jisko leave approval ke liye assign kiya jaye uska naam aaye
-- selection option aaye".
--
-- Adds leave_approver_assignments: an admin designates ANY active employee
-- as a leave approver. That person is then offered by name on the employee's
-- Apply-for-Leve dropdown, the request records who it went to, and they can
-- approve/reject it without holding the leave_admin capability.
--
-- Idempotent (safe to re-run); folded into db/schema.sql. After running this
-- AND db/2026-08-08-enable-rls.sql, re-run the RLS file so the new table
-- picks up its blanket authenticated policy.
-- =====================================================================

CREATE TABLE IF NOT EXISTS leave_approver_assignments (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  employee_id       uuid NOT NULL REFERENCES employees(id),
  assigned_by_employee_id uuid REFERENCES employees(id),
  assigned_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_leave_approver_assignments_company ON leave_approver_assignments(company_id);

ALTER TABLE leave_approver_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated_all ON leave_approver_assignments;
CREATE POLICY allow_authenticated_all ON leave_approver_assignments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- The Apply form records WHICH designated approver the employee picked, so
-- the approvals queue can be routed to a named person (and MD still sees it
-- too). NULL = unassigned / MD.
ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS approver_employee_id uuid REFERENCES employees(id);

-- 2026-10-20 — Supabase's PostgREST keeps a cache of the schema it exposes.
-- A brand-new table is normally picked up within moments, but when it isn't,
-- the API answers PGRST205 ("Could not find the table
-- 'public.leave_approver_assignments' in the schema cache") even though the
-- table plainly exists in the SQL Editor — which is exactly what a screen
-- like Leave reads as "the migration hasn't been run", no matter how many
-- times it is re-run. This forces the reload. It is a no-op on a plain
-- Postgres (the notification just goes nowhere), so it is safe in this file.
NOTIFY pgrst, 'reload schema';
