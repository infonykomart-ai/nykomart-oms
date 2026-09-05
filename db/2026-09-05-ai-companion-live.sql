-- 2026-09-05 — AI Desktop Companion: LIVE. Follows the 2026-09-05
-- companion-preview mockup (src/app/dashboard/companion-preview/) —
-- "AI MOOKUP KO AB FINAL KARO ... JISKO IS OMS KE HAR PART KA PATA HOGA JO
-- MOMENT KE HISAB SE REACT KAREGI": the character now floats on every
-- dashboard page and reacts to real events (order placed, task assigned,
-- return processed, shipment booked, attendance marked) instead of only
-- simulate-buttons — plus a chatbot. Per-employee, NOT per-role: "YE ADMIN
-- KE PASS POWER HO KIS KIS EMPLOYEE KO YE FEATURE APPROVE KARNA HAI" — this
-- is a deliberate, one-off deviation from this codebase's usual all-role-
-- based permission convention (role_capabilities only) — see
-- employees.companion_enabled below, a plain per-row boolean, same shape as
-- the existing theme_id/custom_accent_color per-employee preference columns
-- (db/2026-08-22-employee-theme-prefs.sql) rather than a new capability.
--
-- Idempotent — safe to run even if partially applied already (ADD COLUMN
-- IF NOT EXISTS, CREATE TABLE IF NOT EXISTS, DROP POLICY IF EXISTS before
-- each CREATE, exception-guarded ALTER PUBLICATION — matches
-- db/2026-09-02-group-messaging.sql's own pattern exactly).

-- Per-employee ON/OFF switch, set only from the new
-- /dashboard/admin/companion-access screen (companion_admin capability,
-- granted below to MD/Admin only — same 2 roles as permissions_admin).
-- Defaults to false: nobody sees the live companion until an Admin/MD
-- explicitly turns it on for them.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS companion_enabled boolean NOT NULL DEFAULT false;

-- One row per reaction the companion should show. Written server-side only
-- (via the service-role client, from notifyCompanion() — see
-- src/lib/companion/notify.ts) — there is deliberately NO insert policy for
-- authenticated users below, only SELECT-own, matching how direct_messages
-- rows are written (server actions, not client inserts).
CREATE TABLE IF NOT EXISTS companion_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  event_type    text NOT NULL, -- 'order_placed' | 'task_assigned' | 'return_processed' | 'shipment_booked' | 'attendance_marked'
  message       text NOT NULL, -- fully-formed display text, e.g. 'Congratulations! Order PO-0042 saved in OMS 🎉'
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_companion_events_employee_created ON companion_events(employee_id, created_at);

ALTER TABLE companion_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS companion_events_select_own ON companion_events;
CREATE POLICY companion_events_select_own ON companion_events FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM employees e WHERE e.id = companion_events.employee_id AND e.auth_user_id = auth.uid()
  ));

-- IMPORTANT — Realtime: the live companion widget subscribes to
-- companion_events INSERTs filtered to `employee_id=eq.<me>` client-side,
-- but RLS above is what actually restricts which rows can reach a given
-- employee (same belt-and-suspenders reasoning as conversation_messages).
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE companion_events;
EXCEPTION WHEN duplicate_object THEN
  NULL; -- already added, nothing to do
END $$;

-- Admin capability for the new /dashboard/admin/companion-access screen
-- (toggle companion_enabled per employee) — granted to MD + Admin only,
-- same 2 roles as permissions_admin.
INSERT INTO capabilities (code, description) VALUES
  ('companion_admin', 'Turn the live AI companion on/off for specific employees (Admin/MD only)')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'companion_admin' FROM roles r WHERE r.name IN ('MD', 'Admin')
ON CONFLICT (role_id, capability_code) DO NOTHING;
