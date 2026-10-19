-- 2026-10-17 — LEAVE AUDIT + LIFECYCLE. User request (Hinglish):
--   1. "leave ke liye agar koi employe apply karta hai to usme date & time
--      nahi aata with location" — every application must record WHEN it was
--      applied (requested_at already existed but was never shown) and FROM
--      WHERE (browser geolocation, best-effort like the punch buttons).
--   2. "approve hone ke baad ye bhi aana chahiye ki leave approve kisne
--      ki hai kis time par ki hai" — decided_by/decided_at already existed
--      in the table; this round makes both UIs DISPLAY them.
--   3. "daily bases par bhi record hona chahiye ki kitne logo ki leave
--      application aayi hai or kitno ki approve hui hai" — daily record
--      panel on the admin page, aggregated live from leave_requests.
--   4. "admin ko notification dikhta rahna chahiye ki ye bande itni itni
--      date ko leave par hai" — On Leave board (today + next 7 days) on
--      the admin page + two new header-bell items for leave_admins.
--   5. "agar koi leave lekr bhi office aajata hai to vo apni leave approve
--      ko cancel karvayega ya phir modify karvayega ki full day ki jagah
--      halfday ya jitne din ki application hai usme kitne din pahle aaya
--      hai" — cancel / half-day-convert / shorten actions on an APPROVED
--      leave, usable by the employee themselves or by the admin.
--
-- Three additions, all additive:
--   A. leave_requests gains applied_lat/applied_lng/applied_accuracy_m
--      (application-time location) and cancelled_by_employee_id/
--      cancelled_at/cancelled_remark (who pulled the leave back and why).
--   B. leave_request_status gains a 4th value 'Cancelled' — a cancelled
--      leave is NOT a rejection; it is a withdrawn application and its
--      auto-marked attendance rows are cleaned up (see actions.ts).
--   C. leave_request_events — a durable per-request audit trail
--      (Applied/Approved/Rejected/Cancelled/Half Day/Shortened), so
--      "kisne kab kya kiya" survives any number of later modifications,
--      same append-first philosophy as every other ledger in this app.
--
-- IMPORTANT — ALTER TYPE ... ADD VALUE cannot run inside a transaction
-- block (run it as its own statement in the Supabase SQL editor; it is
-- fine there since each statement is auto-committed).

ALTER TYPE leave_request_status ADD VALUE IF NOT EXISTS 'Cancelled';

ALTER TABLE leave_requests
  ADD COLUMN IF NOT EXISTS applied_lat            double precision,
  ADD COLUMN IF NOT EXISTS applied_lng            double precision,
  ADD COLUMN IF NOT EXISTS applied_accuracy_m     numeric(8, 2),
  ADD COLUMN IF NOT EXISTS cancelled_by_employee_id uuid REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS cancelled_at           timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_remark       text;

COMMENT ON COLUMN leave_requests.applied_lat IS
  'Application-time browser geolocation (best-effort — NULL when permission was denied/unsupported, exactly like punch GPS).';
COMMENT ON COLUMN leave_requests.cancelled_at IS
  'Set when a Pending or Approved request is withdrawn (employee) or pulled back (admin). decided_at stays as the original approval time — both events remain visible.';

CREATE TABLE IF NOT EXISTS leave_request_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leave_request_id   uuid NOT NULL REFERENCES leave_requests(id) ON DELETE CASCADE,
  -- 'Applied' | 'Approved' | 'Rejected' | 'Cancelled' | 'Half Day' | 'Shortened'
  -- (plain text on purpose — the set is expected to grow with future
  -- lifecycle steps, and an enum add would need another migration)
  event_type         text NOT NULL,
  actor_employee_id  uuid REFERENCES employees(id),
  event_at           timestamptz NOT NULL DEFAULT now(),
  details            text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_leave_request_events_request ON leave_request_events(leave_request_id, event_at);
COMMENT ON TABLE leave_request_events IS
  'Append-only audit trail of every lifecycle event on a leave request (who did what, when, with what remark). Never updated or deleted except by request deletion (CASCADE).';

-- RLS: db/2026-08-08-enable-rls.sql attaches the blanket
-- allow_authenticated_all policy to every public table AT THE TIME IT RUNS —
-- re-run it after applying this migration so leave_request_events gets the
-- same authenticated-only policy (same note as the original leave migration).
