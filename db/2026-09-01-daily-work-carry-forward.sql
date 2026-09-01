-- 2026-09-01 — "Today's Work -> Carry Forward" additive feature on the
-- existing Daily Work Report (daily_work_logs). Owner's spec: a Today's
-- Work entry needs a Priority field (didn't exist on this table before —
-- tasks.priority already has this exact shape, matched here for
-- consistency); an "Incomplete Work" review section for Pending/In
-- Progress rows; and an explicit "Carry Forward to Tomorrow" action that
-- freezes the ORIGINAL row (status -> 'Carried Forward') and creates a
-- fresh tomorrow-dated row reset to Pending with 0 time spent.
--
-- Idempotency for Carry Forward reuses the EXISTING partial unique index
-- `idx_daily_work_logs_carried_from_unique` (added earlier for the
-- automatic next-day carry-over, carry-over.ts) — it already enforces "at
-- most one child row per original row" for ANY row that sets
-- carried_from_log_id, so no new index is needed here; a double-submit of
-- the Carry Forward button hits the same unique-violation guard the
-- existing automatic mechanism already relies on.
--
-- carried_to_date is a purely-informational snapshot on the ORIGINAL row
-- (mirrors the child row's own log_date, which is the real field driving
-- the date-based view) so the original day's history can show "Carried to:
-- 2 Sep" without an extra join.
--
-- Idempotent (IF NOT EXISTS) — safe to run more than once.

ALTER TABLE daily_work_logs
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'Medium';  -- Low / Medium / High / Urgent — same shape as tasks.priority

ALTER TABLE daily_work_logs
  ADD COLUMN IF NOT EXISTS carried_to_date date;  -- set on the ORIGINAL row when explicitly Carried Forward; NULL otherwise

COMMENT ON COLUMN daily_work_logs.priority IS
  'Low / Medium / High / Urgent — matches tasks.priority''s existing shape. Defaults to Medium so every pre-existing row (and every new one) always has a value.';
COMMENT ON COLUMN daily_work_logs.carried_to_date IS
  'Set only on an ORIGINAL row once explicitly Carried Forward (work_status -> ''Carried Forward'', carried_forward -> true) — the date of the auto-created tomorrow row. NULL for every other row. Purely informational (the real driver of the date-based view is the child row''s own log_date); lets the original day''s history show "Carried to: <date>" without a join.';
