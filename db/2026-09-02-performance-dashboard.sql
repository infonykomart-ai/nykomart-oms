-- 2026-09-02: Performance & Awards ranking dashboard.
--
-- No new tables or columns — every metric (attendance, leave, work
-- efficiency, order value/growth) is computed on the fly from data that
-- already exists (attendance, daily_work_logs, orders, role_capabilities).
-- This migration only adds the new `performance_admin` capability and
-- grants it to the MD and Admin roles (same grant set as
-- data_export_admin / audit_log_view / automation_admin — see
-- db/schema.sql's role_capabilities seed). Idempotent: safe to run even if
-- partially applied already.

INSERT INTO capabilities (code, description) VALUES
  ('performance_admin', 'Team-wide Performance & Awards ranking dashboard (order value/growth, attendance, work efficiency) — Admin/MD only')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'performance_admin'
FROM roles r
WHERE r.name IN ('MD', 'Admin')
ON CONFLICT (role_id, capability_code) DO NOTHING;
