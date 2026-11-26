-- 2026-11-26 — schema_migrations: the migration LEDGER (P0 audit fix #2).
--
-- WHY THIS TABLE EXISTS
-- Every dated db/*.sql file is run ONCE by hand in the Supabase SQL editor, and
-- until now "is it applied?" was answered only by probes ("does the object
-- exist?"). A probe can tell you the column is there; it cannot tell you WHICH
-- VERSION of a file put it there. That is the drift the 26 Nov audit flagged:
-- 179 files, no record of what was run, and an edited-but-already-run file
-- looks exactly like an applied one.
--
-- So one row per file, plus the file's SHA-256 at the moment it was recorded as
-- applied. If the committed file changes later, the recorded hash no longer
-- matches and /dashboard/admin/migrations lists it as DRIFTED — "the file you
-- ran is not the file in the repo".
--
-- THE BOOTSTRAP (the reason db/MIGRATIONS.md used to say "no ledger")
-- A ledger table would itself need a migration. True, and harmless: running
-- THIS file is the precondition for the first row. Every later file is recorded
-- from the admin page AFTER its probe confirms the object is present in the
-- database, so a row always means "verified present", never "someone ticked a
-- box".
--
-- SAFETY
-- service_role only: RLS is enabled with NO policy, so anon/authenticated can
-- neither read nor write it. The page uses the service-role client behind the
-- employee_admin capability check.
--
-- Idempotent: safe to run twice.
begin;

create table if not exists schema_migrations (
  file        text primary key,
  sha256      text not null,
  applied_at  timestamptz not null default now(),
  applied_by  text,
  note        text
);

alter table schema_migrations enable row level security;

comment on table schema_migrations is
  'Which db/*.sql files are applied and the SHA-256 of the file when it was recorded. Maintained by /dashboard/admin/migrations.';

commit;
