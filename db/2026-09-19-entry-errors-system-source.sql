-- 2026-09-19 (audit fix, item C5) — widen entry_errors.source to also
-- accept 'system': a background/automatic process failing with nothing to
-- attribute it to an employee's own action.
--
-- Two spots in src/app/dashboard/tasks/actions.ts silently swallowed a
-- failure and still reported success to the caller:
--   - recordDailySegmentsAndGetToday (~line 65) — a failed add_task_daily_
--     time RPC call was only console.error'd.
--   - markTaskDone (~line 289) — a task could show "Done" in the UI while
--     its backing daily_work_logs row silently never got created, a
--     payroll/attendance data gap invisible to the employee.
-- Both are intentionally still best-effort/non-blocking (a logging failure
-- must never undo or block the timer/task action that already committed —
-- see recordDailySegmentsAndGetToday's own header comment) — this migration
-- doesn't change that. It just gives both spots somewhere visible to land
-- instead of only a server console nobody reads: src/lib/error-log/log-
-- entry-error.ts's existing entry_errors table / /dashboard/error-log tab
-- (Admin/MD, error_log_view capability) already built for exactly this
-- "something went wrong, don't block, but don't lose it either" case.
--
-- Confirmed live (2026-09-19): the constraint's auto-generated name is
-- entry_errors_source_check (verified via pg_constraint before writing
-- this). Idempotent — safe to re-run.

ALTER TABLE entry_errors DROP CONSTRAINT IF EXISTS entry_errors_source_check;
ALTER TABLE entry_errors ADD CONSTRAINT entry_errors_source_check
  CHECK (source IN ('validation', 'courier_api', 'manual', 'system'));
