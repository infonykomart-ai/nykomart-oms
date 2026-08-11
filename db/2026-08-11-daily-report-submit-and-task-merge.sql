-- 2026-08-11 (round 3): "start & pause button ko remove karo or sirf start
-- time ka option ho kitne baje compleate hua ka option ho submit report ka
-- option ho" — simplifies the Daily Work Report's Time Watch from a
-- Start/Pause toggle into Start once + Submit once. Submitting is now the
-- explicit moment a row becomes a real, finalized report — before that,
-- it's just an in-progress draft (still auto-saved/refresh-safe as
-- before, just not yet "submitted"). "submit karte hi khud ke kaam me add
-- ho jaye or md admin ke page par show ho jaye" — My Recent Reports and
-- the Admin/MD Team Daily Work Log view now only show rows that have
-- actually been submitted, not half-typed drafts.
ALTER TABLE daily_work_logs ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_daily_work_logs_submitted ON daily_work_logs(company_id, submitted_at);

-- No schema change needed for the "Task option should be on the same
-- page, why was it made separate" ask — that's purely a UI move (the
-- Task Assignment section now renders directly on /dashboard/attendance
-- and /dashboard/attendance/admin instead of its own /dashboard/tasks
-- route), same `tasks` table and task_management/task_admin capabilities
-- as before.
