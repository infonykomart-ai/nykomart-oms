-- 2026-10-02 — TeamOffice parity round: GPS capture for the Web Punch
-- buttons + the Location/GPS report pages.
--
-- The manual Punch In/Out buttons on /dashboard/attendance now ask the
-- browser for a one-shot geolocation fix (best-effort: permission denied
-- or timeout just punches WITHOUT coordinates — never blocks the punch)
-- and store it here. Server-side paths (login-hook auto punch-in,
-- logout-hook punch-out, TeamOffice import) have no browser to ask, so
-- they leave these NULL — a report row without coords renders "—".
--
-- numeric(9,6) ≈ 0.11 m precision — plenty; keeps lat/lng as real numbers
-- (not one parsed "lat,lng" string) so reports can sort/validate them.
--
-- Idempotent — safe to run more than once.
-- Folded into db/schema.sql (single source of truth) — do NOT replay this
-- file on top of a fresh schema.sql (see that file's header note).
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS punch_in_lat numeric(9,6);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS punch_in_lng numeric(9,6);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS punch_out_lat numeric(9,6);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS punch_out_lng numeric(9,6);
COMMENT ON COLUMN attendance.punch_in_lat IS
  'Browser geolocation at Punch In (best-effort, NULL when unavailable/denied). Pairs with punch_in_lng — rendered as a maps link by the GPS report.';
COMMENT ON COLUMN attendance.punch_out_lat IS
  'Browser geolocation at Punch Out (best-effort, NULL when unavailable/denied). Pairs with punch_out_lng.';
