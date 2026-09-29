-- 2026-09-29 — "team directory bhi kar do + agar sabhi employee ka data
-- download karna ho to vo bhi option rakhna" (user, paraphrased):
--
--   TEAM_DIRECTORY — a view-only company contact book every signed-in
--   employee can open: teammates' names, photos, designation, role, email,
--   WhatsApp, joining date. Deliberately its OWN capability, not folded
--   into employee_admin (that capability manages the whole roster —
--   creating logins, changing roles, deactivating — and must stay
--   Admin/MD-only), and deliberately a NARROWER field set: the directory
--   page/API never selects bank/statutory columns, never touches salary
--   or advances. Grant it to any role from the Roles & Permissions
--   matrix (no code change needed — the capabilities table is
--   auto-synced from the app registry on that page's every load).
--
-- Seeded with grants for MD + Admin to start (the same two roles that
-- hold employee_admin today), so nothing changes for them except the new
-- sidebar tile; other roles are one tick in the matrix away.
--
-- No schema changes to `employees` itself, and NO RLS changes: the
-- directory page reads through the same capability-gated server pattern
-- as every other list page here (requireAnyCapability at the top of
-- page.tsx/actions), so the capability grant above IS the access
-- control. The second INSERT below is the live-DB safety net for
-- databases restored before sync_capabilities existed; live databases
-- that already have the row via sync_capabilities just no-op on conflict.

INSERT INTO capabilities (code, description) VALUES
  ('team_directory', 'View-only company contact book — teammates'' names, photos, designations, roles and contact details. No bank/statutory data.')
ON CONFLICT (code) DO UPDATE
  SET description = EXCLUDED.description;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'team_directory'
FROM roles r
WHERE r.name IN ('MD', 'Admin')
ON CONFLICT (role_id, capability_code) DO NOTHING;
