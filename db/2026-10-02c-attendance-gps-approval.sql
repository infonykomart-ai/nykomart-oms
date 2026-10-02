-- 2026-10-02c — GPS Approve/Pending/Rejected workflow (TeamOffice parity):
-- every Web-Punch GPS fix starts life as 'Pending' and waits for an
-- admin decision on /dashboard/attendance/admin/gps-approvals.
--
--   None     — nothing to decide (punch has no coords: server-side login/
--              logout punches, TeamOffice imports, denied geolocation)
--   Pending  — coords captured at punch time, awaiting review
--   Approved — admin verified the location (maps link on the GPS report)
--   Rejected — admin flagged the location as wrong
--
-- Decided-by/at/remark mirror leave_requests' own decision columns.
-- Idempotent — safe to run more than once.
-- Folded into db/schema.sql (single source of truth) — do NOT replay this
-- file on top of a fresh schema.sql (see that file's header note).
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS gps_status text NOT NULL DEFAULT 'None'
  CHECK (gps_status IN ('None', 'Pending', 'Approved', 'Rejected'));
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS gps_decided_by_employee_id uuid REFERENCES employees(id);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS gps_decided_at timestamptz;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS gps_decision_remark text;
COMMENT ON COLUMN attendance.gps_status IS
  'Web-Punch GPS review workflow: None (no coords to review) / Pending / Approved / Rejected. Set to Pending when punch_in/out_lat,lng is captured; decided from /dashboard/attendance/admin/gps-approvals.';
COMMENT ON COLUMN attendance.gps_decision_remark IS
  'Admin remark recorded with the Approve/Rejected decision (optional).';
