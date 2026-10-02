-- 2026-10-02 — TeamOffice parity round: "Department column" in the
-- attendance report family (Daily/Monthly/Periodic/Yearly/Location/
-- Leave/Salary) + a Department filter on the report pages.
--
-- The schema previously had only role/designation on employees — no
-- department concept at all (flagged as "not built" in monthly-report.ts).
-- This adds a FREE-TEXT department per employee (e.g. "Sales", "Accounts",
-- "Warehouse"): free text on purpose, no departments table — teams here are
-- small and admin-typed, same convention as `designation`.
--
-- Idempotent — safe to run more than once.
-- Folded into db/schema.sql (single source of truth) — do NOT replay this
-- file on top of a fresh schema.sql (see that file's header note).
ALTER TABLE employees ADD COLUMN IF NOT EXISTS department text;
COMMENT ON COLUMN employees.department IS
  'Free-text department/team label (Sales, Accounts, ...). Shown as the Department column and filter on the attendance report suite (/dashboard/attendance/admin/*). NULL = not filled in yet (renders as "—".';
