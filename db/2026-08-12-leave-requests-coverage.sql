-- 2026-08-12 (round 8): "LEAVE REQUESST BHEJ DU APPLIATION KE SATH TO VO MD
-- KE PASS APPROVAL KE LIYE CHLI JAYE. MERI LEAVE JESE APPROVE HO JAYE TO MD
-- ADMIN KO YE POWER HO KI MERI ABSENCE ME WORK KON KAREGA USKO ASSING KARNE
-- PAR AUTO MATIC ROLE ME ACTIN HO JAYE ... JITNE DIN KE LIYE APPROVE
-- KARENGE TO [US] STORE KE LIYE MUJHE JO ACCES MILNE CHAHIYE MD ADMIN KE
-- APPROVE KARTE HI HO JAYE."
--
-- Two new tables:
--   1. leave_requests — an employee applies (with an application/reason
--      text) for a date range; MD/Admin approves or rejects.
--   2. leave_coverage_assignments — once approved, MD/Admin assigns
--      ANOTHER employee to cover the absent employee's store work for
--      some/all of the approved range. That row IS the access grant
--      itself: the covering employee's access to that store is computed
--      LIVE at every login (see getAuthedEmployee() in
--      src/lib/auth/require-capability.ts) as "any store with an active
--      (today between from_date/to_date) coverage assignment" — starting
--      the instant MD/Admin saves the assignment and ending automatically
--      after to_date, with no separate on/off toggle and no cleanup job
--      needed.
--
-- Deliberately a SEPARATE table from the existing employee_store_access
-- (permanent store scoping for Ad Spend) rather than inserting rows into
-- it directly: that table's own admin panel (Employees -> Store Access)
-- does a delete-then-insert of the FULL set every time it's edited (see
-- src/app/dashboard/admin/employees/actions.ts), so a temporary grant
-- mixed into it would either get silently wiped out the next time someone
-- edits that panel, or a real permanent grant would get wiped out by a
-- leave-coverage assignment overwriting the set. Keeping the two
-- completely separate — and merging them only at read time in
-- getAuthedEmployee() — avoids both failure modes entirely.

-- IMPORTANT — RLS: db/2026-08-08-enable-rls.sql loops over every table in
-- `public` AT THE TIME IT RUNS and attaches the blanket
-- allow_authenticated_all policy. `leave_requests` and
-- `leave_coverage_assignments` below are brand-new tables, so they have NO
-- RLS/policy at all until that file is re-run — meaning the public anon
-- key alone (no login) could read/write every leave request or coverage
-- grant via the Supabase REST API in the meantime (same lesson as `tasks`,
-- `employee_advances`, `salary_payments` before it). Apply this migration
-- FIRST, then re-run db/2026-08-08-enable-rls.sql (idempotent, safe to
-- re-run) so both new tables get the same authenticated-only policy every
-- other table has.

CREATE TYPE leave_request_status AS ENUM ('Pending', 'Approved', 'Rejected');

CREATE TABLE IF NOT EXISTS leave_requests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             uuid NOT NULL REFERENCES employees(id),
  company_id              uuid NOT NULL REFERENCES companies(id),
  from_date               date NOT NULL,
  to_date                 date NOT NULL,
  reason                  text NOT NULL,   -- the "application" text the employee writes
  status                  leave_request_status NOT NULL DEFAULT 'Pending',
  requested_at            timestamptz NOT NULL DEFAULT now(),
  decided_by_employee_id  uuid REFERENCES employees(id),
  decided_at              timestamptz,
  decision_remark         text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (to_date >= from_date)
);
CREATE INDEX IF NOT EXISTS idx_leave_requests_employee ON leave_requests(employee_id, from_date DESC);
CREATE INDEX IF NOT EXISTS idx_leave_requests_company_status ON leave_requests(company_id, status);
COMMENT ON TABLE leave_requests IS
  '2026-08-12: real leave application + MD/Admin approval workflow. status starts Pending; once decided '
  '(Approved/Rejected) it is never re-decided — decided_by/decided_at/decision_remark are all set together.';

CREATE TABLE IF NOT EXISTS leave_coverage_assignments (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_request_id          uuid NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  covering_employee_id      uuid NOT NULL REFERENCES employees(id),
  store_id                  uuid NOT NULL REFERENCES stores(id),
  from_date                 date NOT NULL,
  to_date                   date NOT NULL,
  assigned_by_employee_id   uuid NOT NULL REFERENCES employees(id),
  assigned_at               timestamptz NOT NULL DEFAULT now(),
  remark                    text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  CHECK (to_date >= from_date)
);
CREATE INDEX IF NOT EXISTS idx_leave_coverage_leave_request ON leave_coverage_assignments(leave_request_id);
-- The exact lookup getAuthedEmployee() does on every request: "which
-- stores does THIS employee currently (today) have an active coverage
-- assignment for" — covering_employee_id first, then the date range.
CREATE INDEX IF NOT EXISTS idx_leave_coverage_covering_employee ON leave_coverage_assignments(covering_employee_id, from_date, to_date);
COMMENT ON TABLE leave_coverage_assignments IS
  '2026-08-12: who covers an absent (on-approved-leave) employee''s store work, and for exactly which dates. '
  'This row IS the access grant — getAuthedEmployee() unions any store with an active (today BETWEEN '
  'from_date AND to_date) row here into that employee''s storeIds/companyIds for the duration, automatically, '
  'no separate toggle. Not unique per leave_request — MD/Admin can split coverage across multiple people/stores.';

INSERT INTO capabilities (code, description) VALUES
  ('leave_management', 'Submit your own leave requests with an application, and see their approval status'),
  ('leave_admin',      'Approve/reject leave requests and assign who covers the absent employee''s store work, auto-granting that store access for the approved days')
ON CONFLICT (code) DO NOTHING;

-- leave_management -> every role (same set as attendance_punch/task_management — everyone can request leave).
INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'leave_management' FROM roles r
JOIN role_capabilities existing ON existing.role_id = r.id AND existing.capability_code = 'attendance_punch'
ON CONFLICT DO NOTHING;

-- leave_admin -> MD + Admin only, exactly as asked ("MD ADMIN KO YE POWER HO").
INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'leave_admin' FROM roles r WHERE r.name IN ('MD', 'Admin')
ON CONFLICT DO NOTHING;
