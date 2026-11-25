-- 2026-11-25 — Store Ad Spend Daily Entry: edit, audit and safe delete.
--
-- WHY
--   The Daily Entry form upserts on (store_id, spend_date, country_code), so a
--   saved day could only be corrected by re-typing the same store+date and
--   silently overwriting what was there: no "before" value, no record of who
--   changed it, and the Delete button was a hard DELETE with no way back.
--   Editing, updating and recovering an entry need three things the table did
--   not have: when the row was created, who owns the delete, and a soft-delete
--   marker so history survives.
--
-- WHAT THIS ADDS
--   created_at / created_by_employee_id  — real creation facts, backfilled
--                                          from updated_at / entry_by_employee_id
--                                          for rows that predate this file.
--   deleted_at / deleted_by_employee_id  — soft delete. Every read filters
--                                          `deleted_at is null`; an admin can
--                                          restore. Nothing is physically
--                                          removed by the Delete button any more.
--
-- CHANGE HISTORY
--   Per-row before/after edits are written to the EXISTING audit_log table via
--   logAudit() — no second audit table.
--
-- ROLLBACK
--   DROP INDEX IF EXISTS idx_store_ad_spend_active;
--   ALTER TABLE store_ad_spend
--     DROP COLUMN IF EXISTS created_at,
--     DROP COLUMN IF EXISTS created_by_employee_id,
--     DROP COLUMN IF EXISTS deleted_at,
--     DROP COLUMN IF EXISTS deleted_by_employee_id;
--   (deleted rows stay deleted-after-restore; restore them all first with
--    UPDATE store_ad_spend SET deleted_at = NULL; if you roll back after use)
--
-- Safe to run more than once.

BEGIN;

ALTER TABLE store_ad_spend
  ADD COLUMN IF NOT EXISTS created_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL;

-- Backfill creation facts for rows saved before this file existed.
UPDATE store_ad_spend
   SET created_at = COALESCE(created_at, updated_at, now())
 WHERE created_at IS NULL;

UPDATE store_ad_spend
   SET created_by_employee_id = entry_by_employee_id
 WHERE created_by_employee_id IS NULL
   AND entry_by_employee_id IS NOT NULL;

ALTER TABLE store_ad_spend
  ALTER COLUMN created_at SET DEFAULT now();

COMMENT ON COLUMN store_ad_spend.created_at IS
  'When this store/date/country row was first created. Survives edits (updated_at is the last change).';
COMMENT ON COLUMN store_ad_spend.created_by_employee_id IS
  'Who first entered this row. entry_by_employee_id remains the last editor.';
COMMENT ON COLUMN store_ad_spend.deleted_at IS
  'Soft delete: non-NULL means removed from every report, entry list and export. Restorable by an admin.';

-- The reads that matter (report, recent entries, export) all filter on
-- deleted_at IS NULL, so the partial index keeps them on the same lookup path.
CREATE INDEX IF NOT EXISTS idx_store_ad_spend_active
  ON store_ad_spend (store_id, spend_date)
  WHERE deleted_at IS NULL;

-- Verification (read-only, run after COMMIT):
--   SELECT count(*) FILTER (WHERE created_at IS NULL) AS missing_created_at,
--          count(*) FILTER (WHERE deleted_at IS NOT NULL) AS deleted
--     FROM store_ad_spend;

COMMIT;
