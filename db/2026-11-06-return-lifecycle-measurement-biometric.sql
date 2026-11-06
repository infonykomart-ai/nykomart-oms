-- =============================================================================
-- 2026-11-06 — RETURN REQUEST LIFECYCLE, MEASUREMENT EXTENSIONS, BIOMETRIC
-- =============================================================================
-- Run ONCE in the Supabase SQL editor. Every statement is idempotent.
--
-- 1) RETURN / REFUND REQUESTS
--    A pending return can be corrected or cancelled by its creator; approved
--    rows are immutable through this path. Cancelled is a soft delete so the
--    row and its audit trail survive. `updated_at` is maintained by a trigger,
--    and the app's edit/cancel update is conditional on status='Pending' and
--    the row version the editor loaded (race-safe against an approval).
--
-- 2) MEASUREMENT
--    Washing entries can store the dimensions the user actually typed and the
--    area/billing unit used, while sq_mtr_ft keeps its old meaning (the
--    billable quantity). Office expense lines can store an optional quantity,
--    unit and rate. Company settings gain enabled-unit lists, weight/count
--    defaults and a rounding mode. Historical rows are untouched.
--
-- 3) BIOMETRIC ATTENDANCE
--    A device-agnostic PUSH ingestion API (webhook) with hashed per-device
--    tokens, unique employee mapping, shifts, deduplicated punch events and
--    attendance provenance. OMS web punches remain OMS Only until a biometric
--    punch is matched; biometric timestamps are authoritative once ingested.
--    Hardware that cannot push HTTP can keep using the existing TeamOffice
--    Excel import. No device credentials are stored in plaintext.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. RETURN REQUEST LIFECYCLE
-- -----------------------------------------------------------------------------
-- Self-contained: on a database where 2026-11-03b was never run, create the
-- base table first so this file alone is enough. Existing rows are untouched.
CREATE TABLE IF NOT EXISTS return_requests (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id           uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL REFERENCES companies(id),
  requested_by       uuid REFERENCES employees(id),
  requested_at       timestamptz NOT NULL DEFAULT now(),
  reason             text NOT NULL,
  note               text,
  refund_amount      numeric(14, 2),
  refund_currency    text,
  refund_date        date,
  status             text NOT NULL DEFAULT 'Pending'
                       CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  decided_by         uuid REFERENCES employees(id),
  decided_at         timestamptz,
  decision_note      text,
  applied_refund_id  uuid REFERENCES order_refunds(id),
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_return_requests_company_status ON return_requests(company_id, status, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_return_requests_order ON return_requests(order_id);
CREATE INDEX IF NOT EXISTS idx_return_requests_requested_by ON return_requests(requested_by, status);
-- Only one pending return per order — two simultaneous submissions cannot
-- create two approval rows (and later two refunds) for the same order.
CREATE UNIQUE INDEX IF NOT EXISTS idx_return_requests_one_pending
  ON return_requests(order_id) WHERE status = 'Pending';
ALTER TABLE return_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_requests FORCE ROW LEVEL SECURITY;
REVOKE ALL ON return_requests FROM anon, authenticated;

INSERT INTO capabilities (code, description)
VALUES ('return_approval', 'Approve or reject customer return requests (release the refund and mark the order Returned)')
ON CONFLICT (code) DO NOTHING;
INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'return_approval' FROM roles r WHERE r.name IN ('MD', 'Admin')
ON CONFLICT (role_id, capability_code) DO NOTHING;

ALTER TABLE return_requests
  ADD COLUMN IF NOT EXISTS request_type text NOT NULL DEFAULT 'Return',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by uuid REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES employees(id);

ALTER TABLE return_requests DROP CONSTRAINT IF EXISTS return_requests_status_check;
ALTER TABLE return_requests
  ADD CONSTRAINT return_requests_status_check
  CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Cancelled'));

ALTER TABLE return_requests DROP CONSTRAINT IF EXISTS return_requests_request_type_check;
ALTER TABLE return_requests
  ADD CONSTRAINT return_requests_request_type_check
  CHECK (request_type IN ('Return', 'Refund'));

CREATE OR REPLACE FUNCTION set_return_requests_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS return_requests_set_updated_at ON return_requests;
CREATE TRIGGER return_requests_set_updated_at
  BEFORE UPDATE ON return_requests
  FOR EACH ROW EXECUTE FUNCTION set_return_requests_updated_at();

CREATE INDEX IF NOT EXISTS idx_return_requests_mine
  ON return_requests(requested_by, requested_at DESC);

COMMENT ON COLUMN return_requests.status IS
  'Pending → Approved/Rejected by MD/Admin. Cancelled = creator removed a still-pending request (soft delete; row + audit remain).';

-- -----------------------------------------------------------------------------
-- 2. MEASUREMENT SETTINGS / WASHING / EXPENSES
-- -----------------------------------------------------------------------------
ALTER TABLE company_measurement_settings
  ADD COLUMN IF NOT EXISTS enabled_length_units text[] NOT NULL DEFAULT ARRAY['MM','CM','MTR','INCH','FT'],
  ADD COLUMN IF NOT EXISTS enabled_area_units text[] NOT NULL DEFAULT ARRAY['SQ_MM','SQ_CM','SQ_MTR','SQ_INCH','SQ_FT'],
  ADD COLUMN IF NOT EXISTS enabled_weight_units text[] NOT NULL DEFAULT ARRAY['G','KG','TON'],
  ADD COLUMN IF NOT EXISTS enabled_quantity_units text[] NOT NULL DEFAULT ARRAY['PCS','SET','BOX','UNIT'],
  ADD COLUMN IF NOT EXISTS default_weight_unit text NOT NULL DEFAULT 'KG',
  ADD COLUMN IF NOT EXISTS default_quantity_unit text NOT NULL DEFAULT 'PCS',
  ADD COLUMN IF NOT EXISTS rounding_mode text NOT NULL DEFAULT 'HALF_UP'
    CHECK (rounding_mode IN ('HALF_UP', 'UP', 'DOWN')),
  ADD COLUMN IF NOT EXISTS module_defaults jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE purchase_bills
  ADD COLUMN IF NOT EXISTS measurement_rounding text
    CHECK (measurement_rounding IS NULL OR measurement_rounding IN ('HALF_UP', 'UP', 'DOWN'));

ALTER TABLE washing_entries
  ADD COLUMN IF NOT EXISTS length_value numeric(14,4),
  ADD COLUMN IF NOT EXISTS length_unit text,
  ADD COLUMN IF NOT EXISTS width_value numeric(14,4),
  ADD COLUMN IF NOT EXISTS width_unit text,
  ADD COLUMN IF NOT EXISTS area_value numeric(18,6),
  ADD COLUMN IF NOT EXISTS area_display_unit text,
  ADD COLUMN IF NOT EXISTS rate_input_value numeric(14,2),
  ADD COLUMN IF NOT EXISTS rate_unit text,
  ADD COLUMN IF NOT EXISTS measurement_precision integer,
  ADD COLUMN IF NOT EXISTS measurement_rounding text;

ALTER TABLE internal_expenses
  ADD COLUMN IF NOT EXISTS qty numeric(14,3),
  ADD COLUMN IF NOT EXISTS qty_unit text,
  ADD COLUMN IF NOT EXISTS unit_rate numeric(14,2),
  ADD COLUMN IF NOT EXISTS measurement_mode text
    CHECK (measurement_mode IS NULL OR measurement_mode IN ('COUNT', 'WEIGHT', 'AREA', 'LENGTH'));

-- Re-assert the mode constraint so an earlier run of this file (which only
-- allowed COUNT/WEIGHT/AREA) is upgraded instead of silently rejecting LENGTH.
ALTER TABLE internal_expenses DROP CONSTRAINT IF EXISTS internal_expenses_measurement_mode_check;
ALTER TABLE internal_expenses
  ADD CONSTRAINT internal_expenses_measurement_mode_check
  CHECK (measurement_mode IS NULL OR measurement_mode IN ('COUNT', 'WEIGHT', 'AREA', 'LENGTH'));

COMMENT ON COLUMN washing_entries.area_value IS
  'Per-piece area in area_display_unit (same convention as purchase_bills.area_value). sq_mtr_ft remains the billable total quantity the generated amount uses.';

-- -----------------------------------------------------------------------------
-- 3. BIOMETRIC ATTENDANCE
-- -----------------------------------------------------------------------------
DO $$ BEGIN
  ALTER TYPE attendance_source ADD VALUE IF NOT EXISTS 'Biometric';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS attendance_verification text,
  ADD COLUMN IF NOT EXISTS biometric_device_id uuid,
  ADD COLUMN IF NOT EXISTS biometric_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS biometric_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS oms_punch_in timestamptz,
  ADD COLUMN IF NOT EXISTS oms_punch_out timestamptz,
  ADD COLUMN IF NOT EXISTS late_minutes integer,
  ADD COLUMN IF NOT EXISTS early_departure_minutes integer,
  ADD COLUMN IF NOT EXISTS overtime_minutes integer,
  ADD COLUMN IF NOT EXISTS missing_punch text
    CHECK (missing_punch IS NULL OR missing_punch IN ('IN', 'OUT')),
  ADD COLUMN IF NOT EXISTS biometric_synced_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_attendance_verification
  ON attendance(attendance_date, attendance_verification);

-- Label existing provenance without touching any punch time. These rows were
-- never biometric-verified, so they must not read as blank/ambiguous now that
-- the dashboard distinguishes OMS Only / Manual Override / Pending.
UPDATE attendance SET attendance_verification = 'OMS Only'
  WHERE attendance_verification IS NULL AND source = 'Web Punch';
UPDATE attendance SET attendance_verification = 'Manual Override'
  WHERE attendance_verification IS NULL AND source = 'Manual Entry';
UPDATE attendance SET attendance_verification = 'Pending Verification'
  WHERE attendance_verification IS NULL AND source = 'TeamOffice Import';

CREATE TABLE IF NOT EXISTS biometric_devices (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  device_key        text NOT NULL UNIQUE,
  name              text NOT NULL,
  vendor            text,
  model             text,
  mode              text NOT NULL DEFAULT 'PUSH' CHECK (mode IN ('PUSH', 'PULL')),
  endpoint_url      text,
  api_key_hash      text NOT NULL,
  api_key_last4     text NOT NULL,
  active            boolean NOT NULL DEFAULT true,
  last_event_at     timestamptz,
  last_sync_at      timestamptz,
  created_by        uuid REFERENCES employees(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS attendance_shifts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                   text NOT NULL,
  start_time             time NOT NULL DEFAULT '09:30',
  end_time               time NOT NULL DEFAULT '18:30',
  grace_minutes          integer NOT NULL DEFAULT 15 CHECK (grace_minutes >= 0 AND grace_minutes <= 240),
  half_day_minutes       integer NOT NULL DEFAULT 240 CHECK (half_day_minutes > 0),
  overtime_after_minutes integer NOT NULL DEFAULT 0 CHECK (overtime_after_minutes >= 0),
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

CREATE TABLE IF NOT EXISTS biometric_employee_map (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  device_id         uuid NOT NULL REFERENCES biometric_devices(id) ON DELETE CASCADE,
  employee_id       uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  device_employee_id text NOT NULL,
  shift_id          uuid REFERENCES attendance_shifts(id) ON DELETE SET NULL,
  active            boolean NOT NULL DEFAULT true,
  created_by        uuid REFERENCES employees(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (device_id, device_employee_id),
  UNIQUE (device_id, employee_id)
);

CREATE TABLE IF NOT EXISTS biometric_punch_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  device_id          uuid NOT NULL REFERENCES biometric_devices(id) ON DELETE CASCADE,
  device_employee_id text NOT NULL,
  employee_id        uuid REFERENCES employees(id) ON DELETE SET NULL,
  mapping_id         uuid REFERENCES biometric_employee_map(id) ON DELETE SET NULL,
  punch_at           timestamptz NOT NULL,
  direction          text NOT NULL DEFAULT 'AUTO' CHECK (direction IN ('IN', 'OUT', 'AUTO')),
  source_event_id    text,
  raw_payload        jsonb,
  status             text NOT NULL DEFAULT 'Processed'
                       CHECK (status IN ('Processed', 'Duplicate', 'Failed', 'Unmapped')),
  error              text,
  attendance_id      uuid REFERENCES attendance(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Upgrade an earlier run that used (…, direction) as the unique key.
ALTER TABLE biometric_punch_events
  DROP CONSTRAINT IF EXISTS biometric_punch_events_device_id_device_employee_id_punch_at_direction_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_biometric_events_punch_unique
  ON biometric_punch_events(device_id, device_employee_id, punch_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_biometric_events_source_unique
  ON biometric_punch_events(device_id, source_event_id)
  WHERE source_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_biometric_events_date
  ON biometric_punch_events(company_id, punch_at DESC);
CREATE INDEX IF NOT EXISTS idx_biometric_events_status
  ON biometric_punch_events(status, created_at DESC);

-- Device credentials, mappings and raw punches are server-only. Supabase's
-- default grants would otherwise make these readable through the anon client
-- on a project where RLS was never enabled by hand. Service role bypasses RLS.
ALTER TABLE biometric_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE biometric_devices FORCE ROW LEVEL SECURITY;
ALTER TABLE attendance_shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance_shifts FORCE ROW LEVEL SECURITY;
ALTER TABLE biometric_employee_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE biometric_employee_map FORCE ROW LEVEL SECURITY;
ALTER TABLE biometric_punch_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE biometric_punch_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON biometric_devices FROM anon, authenticated;
REVOKE ALL ON attendance_shifts FROM anon, authenticated;
REVOKE ALL ON biometric_employee_map FROM anon, authenticated;
REVOKE ALL ON biometric_punch_events FROM anon, authenticated;

COMMENT ON TABLE biometric_devices IS
  'One row per biometric device/middleware. Only a SHA-256 hash + last 4 characters of the ingestion API key are stored; the full key is shown once when created/rotated.';
COMMENT ON TABLE biometric_punch_events IS
  'Immutable raw punch log. UNIQUE(device, employee, punch_at) prevents duplicate processing; all events are retained for investigation.';
COMMENT ON COLUMN attendance.attendance_verification IS
  'Biometric Verified / Missing OUT / Missing IN / OMS Only / Pending Verification / Manual Override. OMS logout never marks physical attendance verified.';
