-- 2026-10-21 — Purchase Bill: "kisne entry ki" + a real edit history.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
-- purchase_bills already carries created_at / updated_at (added 2026-10-20,
-- db/2026-10-20-purchase-bill-no-gst-and-audit.sql), so the Admin could see
-- WHEN an item was entered and when it was last changed — but never WHO did
-- either. audit_log (db/2026-08-24-audit-log.sql) records the employee name
-- for deletes and now also for edits (see updatePurchaseBill in
-- src/app/dashboard/documents/actions.ts), but it only starts having rows
-- from the day that code ships; bills already in the table have no record of
-- who typed them.
--
-- So the creator is denormalised onto the row itself, the same way
-- audit_log.employee_name is:
--   entered_by_employee_id  who entered it (FK, for reporting / "my entries")
--   entered_by_name         their name at entry time (survives a later rename
--                           or deactivation — this is what the list shows)
--
-- Legacy rows keep both NULL, which the UI renders as "entered before this
-- was tracked" instead of guessing. That is deliberate: attributing an old
-- bill to whoever happens to match today would be a lie.
--
-- Idempotent — safe to re-run (this project's established migration style).

ALTER TABLE purchase_bills
  ADD COLUMN IF NOT EXISTS entered_by_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL;

ALTER TABLE purchase_bills
  ADD COLUMN IF NOT EXISTS entered_by_name text;

COMMENT ON COLUMN purchase_bills.entered_by_employee_id IS
  'Employee who entered this purchase bill row. NULL = entered before 2026-10-21, so unknown (never back-filled by guesswork).';

COMMENT ON COLUMN purchase_bills.entered_by_name IS
  'Denormalised name of the entering employee at entry time — shown in Document Entry so the credit stays readable even after a rename/deactivation. NULL on legacy rows.';

-- "How many / which bills did X enter" is an Admin/HR question, same class as
-- the other per-employee entry counts in src/app/dashboard/admin/employees/
-- actions.ts. Partial: 99% of the table is NULL right now, so there is no
-- point indexing those.
CREATE INDEX IF NOT EXISTS idx_purchase_bills_entered_by
  ON purchase_bills(entered_by_employee_id)
  WHERE entered_by_employee_id IS NOT NULL;
