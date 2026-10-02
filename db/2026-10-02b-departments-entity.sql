-- 2026-10-02b — "Department as structured org entity" (was free-text
-- employees.department shipped earlier the same day):
--
--   departments: one row per company per department (Sales, Accounts, ...)
--   employees.department_id -> departments(id)
--
-- The free-text column is migrated into real rows (one department per
-- distinct value per company) and then DROPPED, so there is exactly one
-- source of truth. The backfill block guards on the column actually
-- existing — it's a no-op on databases that never ran
-- db/2026-10-02-employee-department.sql, so BOTH migration orders work:
--   1) this file only            -> table + FK, no backfill needed
--   2) 2026-10-02-*.sql then this -> backfill + drop
-- Deleting departments is deliberately not offered anywhere in the UI
-- (rename/deactivate instead); the FK still uses ON DELETE SET NULL as
-- defense in depth. Folded into db/schema.sql (see that file's header).
CREATE TABLE IF NOT EXISTS departments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  name        text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
CREATE INDEX IF NOT EXISTS idx_departments_company ON departments(company_id);
COMMENT ON TABLE departments IS
  'Structured org departments per company (TeamOffice parity). employees.department_id points here; reports join for the Department column/filter. Manage from /dashboard/admin/departments.';

ALTER TABLE employees ADD COLUMN IF NOT EXISTS department_id uuid REFERENCES departments(id);
COMMENT ON COLUMN employees.department_id IS
  'Department this employee belongs to (NULL = unassigned, renders as "—"). Formerly free-text employees.department.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'department'
  ) THEN
    -- One department row per distinct (company, value) — exact text kept.
    INSERT INTO departments (company_id, name)
    SELECT DISTINCT e.company_id, trim(e.department)
    FROM employees e
    WHERE e.department IS NOT NULL AND trim(e.department) <> ''
    ON CONFLICT (company_id, name) DO NOTHING;

    UPDATE employees e
    SET department_id = d.id
    FROM departments d
    WHERE d.company_id = e.company_id
      AND lower(d.name) = lower(trim(e.department))
      AND e.department_id IS NULL;

    ALTER TABLE employees DROP COLUMN department;
  END IF;
END $$;
