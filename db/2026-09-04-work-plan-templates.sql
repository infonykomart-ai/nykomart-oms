-- 2026-09-04 — "Daily Work Planner" fixed/recurring template feature.
--
-- Owner's scoping (already approved before this migration was written):
-- an employee shouldn't have to re-type the same recurring work every
-- single day. "Fixed" work comes from TWO layers, both applying at once:
--   1. Admin/HR builds a per-ROLE template (a baseline recurring list of
--      work items for everyone in that role — e.g. "Order Entry" always
--      has 3 fixed daily items).
--   2. Each individual employee can ALSO add their own personal recurring
--      items on top of the role template.
-- Every day, any active template item (role match OR employee match) that
-- doesn't already have a daily_work_logs row for that employee+day gets
-- auto-inserted as a normal Today's Work row (work_status 'Pending'),
-- tagged so it can carry a "🗂️ Template" badge — see
-- src/lib/attendance/work-plan-templates.ts (materializeWorkPlanTemplatesForToday,
-- called from attendance/page.tsx the same way carryOverPendingDailyLogs()
-- already is). From there it's a completely normal daily_work_logs row —
-- editable, completable, carry-forward-able — no special-casing anywhere
-- else in the Daily Work Report flow.
--
-- SCHEMA DESIGN NOTES:
--
-- role_name (not role_id): getAuthedEmployee() (src/lib/auth/
-- require-capability.ts) already resolves and returns roleName on every
-- request (one extra join it already pays for) but does NOT carry role_id
-- as a separate lookup key anywhere convenient for this feature — using
-- role_name lets materialization match on `employee.roleName` directly
-- with no extra query, and roles.name is UNIQUE NOT NULL so `REFERENCES
-- roles(name)` is exactly as safe as an id FK while matching how the rest
-- of this codebase already keys off the resolved role name (e.g. this
-- table's own role dropdown in the admin UI is populated straight from
-- roles.name).
--
-- scope + a CHECK constraint (not two separate tables, and not a nullable
-- role_id/employee_id pair with app-layer-only enforcement) — exactly one
-- of role_name (scope='role') / employee_id (scope='employee') must be
-- set, enforced at the DB level so a bug in the admin/employee CRUD
-- actions can never write a row that's ambiguous about which list it
-- belongs to.
--
-- source_template_id on daily_work_logs (not a join table) — the
-- lightest-weight way to (a) tag a materialized row as template-derived
-- for the "🗂️ Template" badge (mirrors the existing "📋 From Task" badge
-- convention, admin/page.tsx, though that one keys off a description
-- prefix rather than a real column — this is the more robust version of
-- the same idea now that a real FK is warranted) and (b) prevent
-- double-materializing the same template for the same employee+day, via
-- the partial unique index below — same "reuse the existing idempotency
-- shape" precedent as idx_daily_work_logs_carried_from_unique (see
-- db/2026-09-01-daily-work-carry-forward.sql's header comment).
--
-- No RLS policy changes needed beyond mirroring the existing blanket
-- convention: daily_work_logs itself carries RLS-enabled +
-- `allow_authenticated_all` (permissive; real authorization is the
-- app-layer requireCapability()/getAuthedEmployee() scoping — see
-- db/2026-08-17-rls-policy-audit-fix.sql) rather than any real
-- row-level policy, so work_plan_templates gets the exact same shape for
-- consistency. Every real read/write in this feature goes through
-- createServiceRoleClient() behind requireCapability("attendance_admin")
-- (admin/role templates) or getAuthedEmployee() scoped to
-- employee_id = self (personal recurring items) — same posture as the
-- rest of this module.
--
-- Idempotent — every statement is safe to run more than once.

CREATE TABLE IF NOT EXISTS work_plan_templates (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  scope         text NOT NULL CHECK (scope IN ('role', 'employee')),
  role_name     text REFERENCES roles(name),   -- set only when scope = 'role'
  employee_id   uuid REFERENCES employees(id), -- set only when scope = 'employee'
  category      text,
  description   text NOT NULL,
  target_qty    text,
  sort_order    int NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_by    uuid NOT NULL REFERENCES employees(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT work_plan_templates_scope_target_chk CHECK (
    (scope = 'role'     AND role_name IS NOT NULL AND employee_id IS NULL) OR
    (scope = 'employee' AND employee_id IS NOT NULL AND role_name IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_work_plan_templates_role_scope ON work_plan_templates(company_id, role_name) WHERE scope = 'role';
CREATE INDEX IF NOT EXISTS idx_work_plan_templates_employee_scope ON work_plan_templates(employee_id) WHERE scope = 'employee';

COMMENT ON TABLE work_plan_templates IS
  'Recurring "fixed work" items materialized into daily_work_logs each day (see materializeWorkPlanTemplatesForToday). scope=''role'' rows are Admin/HR-managed and apply to every employee whose roleName matches role_name within company_id; scope=''employee'' rows are self-managed by one employee (employee_id) on top of whatever role template(s) also apply to them.';

ALTER TABLE daily_work_logs
  ADD COLUMN IF NOT EXISTS source_template_id uuid REFERENCES work_plan_templates(id);

COMMENT ON COLUMN daily_work_logs.source_template_id IS
  'Set only on a row auto-materialized from a work_plan_templates item (role template or the employee''s own recurring item) — drives the "🗂️ Template" badge, same spirit as the existing "📋 From Task" badge (markTaskDone(), tasks/actions.ts) but a real FK instead of a description-prefix convention. NULL for every ad-hoc/manually-typed row.';

-- Idempotency: at most one materialized row per (employee, day, template)
-- — a page load that races itself (double render, two tabs) or reloads
-- after the row already exists must never create a duplicate. Same
-- partial-unique-index shape as idx_daily_work_logs_carried_from_unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_work_logs_source_template_unique
  ON daily_work_logs(employee_id, log_date, source_template_id) WHERE source_template_id IS NOT NULL;

-- Mirrors the existing blanket RLS convention every other table in this
-- module already carries (RLS enabled, but permissive — real
-- authorization happens at the app layer). See
-- db/2026-08-17-rls-policy-audit-fix.sql for the identical shape applied
-- to daily_work_logs and friends.
ALTER TABLE work_plan_templates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated_all ON work_plan_templates;
CREATE POLICY allow_authenticated_all ON work_plan_templates FOR ALL TO authenticated USING (true) WITH CHECK (true);
