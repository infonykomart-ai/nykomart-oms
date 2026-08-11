-- 2026-08-11 (round 2): Task Assignment ("Task koi bhi kisi ko assign kar
-- de, report puri RD Lohra ko aur Admin ko dikhe, sabhi logo ki report MD
-- ke paas dikhe") + a real Start/Pause watch replacing the free-text
-- "Estimated Time" field on the Daily Work Report's Submit Report section
-- + next-day auto-carry-over of "Next Day Carry On" items into "Pending".
-- Direct rebuild of the legacy "NYKO MART — Work & Performance System"
-- Apps Script tool's Tasks sheet (id/from/to/website/category/priority/
-- deadline/status/description/timeSpentSec/timerStartedAt) against
-- Postgres, matching the screenshots given this round.

-- ---------------------------------------------------------------------------
-- Task Assignment — any employee can assign a task to any other employee
-- they share company access with (see task_management capability below,
-- granted to every role, same as attendance_punch). company_id is the
-- ASSIGNEE's company (whose team/report this task counts under), not the
-- assigner's — so a cross-company assignment still shows up correctly on
-- that person's own company's Task Admin view.
-- ---------------------------------------------------------------------------
CREATE TABLE tasks (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL REFERENCES companies(id),
  assigned_by_employee_id   uuid NOT NULL REFERENCES employees(id),
  assigned_to_employee_id   uuid NOT NULL REFERENCES employees(id),
  website                   text,             -- free text, e.g. store/marketplace name (mirrors legacy "Website" column)
  category                  text,
  priority                  text NOT NULL DEFAULT 'Medium',   -- Low / Medium / High / Urgent
  deadline                  date,
  status                    text NOT NULL DEFAULT 'Pending',  -- Pending / In Progress / Done
  description                text NOT NULL DEFAULT '',
  created_at                 timestamptz NOT NULL DEFAULT now(),
  completed_at                timestamptz,
  -- Live per-task timer — Start/Pause, same shape as the legacy sheet's
  -- timeSpentSec + timerStartedAt. timer_started_at non-null = currently
  -- running; time_spent_seconds is the accumulated total from all past
  -- Start->Pause intervals. first_started_at / last_paused_at are the
  -- "kitne baje start kiya / kitne baje khatm kiya" display fields.
  timer_started_at          timestamptz,
  time_spent_seconds        int NOT NULL DEFAULT 0,
  first_started_at          timestamptz,
  last_paused_at            timestamptz
);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to_employee_id, status);
CREATE INDEX idx_tasks_assigned_by ON tasks(assigned_by_employee_id);
CREATE INDEX idx_tasks_company ON tasks(company_id, status);

-- IMPORTANT — RLS: db/2026-08-08-enable-rls.sql loops over every table in
-- `public` AT THE TIME IT RUNS and attaches the blanket
-- allow_authenticated_all policy. `tasks` is a brand-new table, so it has
-- NO RLS/policy at all until that file is re-run — meaning the public
-- anon key alone (no login) could read/write every task row via the
-- Supabase REST API in the meantime. Apply this migration FIRST, then
-- re-run db/2026-08-08-enable-rls.sql (idempotent, safe to re-run) so
-- `tasks` gets the same authenticated-only policy every other table has.

-- ---------------------------------------------------------------------------
-- Daily Work Report ("Submit Report" section) — replace the free-text
-- Estimated Time field with the same real Start/Pause watch mechanism, so
-- "kisi kaam ko karne me kitna time lag raha hai" is measured, not typed.
-- The old estimated_time/time_taken text columns are left in place
-- (harmless, unused going forward) rather than dropped, since a handful of
-- rows from the first round may already have text in them.
-- ---------------------------------------------------------------------------
ALTER TABLE daily_work_logs ADD COLUMN IF NOT EXISTS timer_started_at   timestamptz;
ALTER TABLE daily_work_logs ADD COLUMN IF NOT EXISTS time_spent_seconds int NOT NULL DEFAULT 0;
ALTER TABLE daily_work_logs ADD COLUMN IF NOT EXISTS first_started_at   timestamptz;
ALTER TABLE daily_work_logs ADD COLUMN IF NOT EXISTS last_paused_at     timestamptz;

-- Next-day auto-carry-over: "agar koi kaam next day ke liye mark kiya hai
-- to vo agle din automatic Pending me dikh jaye". carried_from_log_id
-- marks a row as the auto-created copy of a prior day's "Next Day Carry
-- On" row; carried_forward marks the ORIGINAL row as already copied
-- forward, so carryOverPendingDailyLogs() (src/lib/attendance/carry-over.ts)
-- never double-creates it on a later page load.
ALTER TABLE daily_work_logs ADD COLUMN IF NOT EXISTS carried_from_log_id uuid REFERENCES daily_work_logs(id);
ALTER TABLE daily_work_logs ADD COLUMN IF NOT EXISTS carried_forward     boolean NOT NULL DEFAULT false;

-- Race safety: carryOverPendingDailyLogs() does a select-then-insert (not
-- atomic), so two concurrent page loads (two tabs, or a retried request)
-- could both read carried_forward=false before either write lands. This
-- unique index turns that race into a harmless no-op — the second INSERT
-- for the same source row fails with a unique violation instead of
-- creating a duplicate "Pending" row, and the app code catches that.
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_work_logs_carried_from_unique
  ON daily_work_logs(carried_from_log_id) WHERE carried_from_log_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Capabilities — task_management (assign/view/work your own tasks) goes to
-- every role, same set as attendance_punch, since "task koi bhi kisi ko
-- assign kar de" is explicitly for everyone. task_admin (see every
-- employee's tasks + daily reports company-wide — the RD Lohra/Admin/MD
-- view) goes to the same 3 roles as attendance_admin.
-- ---------------------------------------------------------------------------
INSERT INTO capabilities (code, description) VALUES
  ('task_management', 'Assign tasks to any teammate, work your own assigned tasks with a Start/Pause timer'),
  ('task_admin',      'View every employee''s tasks and daily reports company-wide (the RD Lohra / Admin / MD view)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'task_management' FROM roles r
JOIN role_capabilities existing ON existing.role_id = r.id AND existing.capability_code = 'attendance_punch'
ON CONFLICT DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'task_admin' FROM roles r
JOIN role_capabilities existing ON existing.role_id = r.id AND existing.capability_code = 'attendance_admin'
ON CONFLICT DO NOTHING;
