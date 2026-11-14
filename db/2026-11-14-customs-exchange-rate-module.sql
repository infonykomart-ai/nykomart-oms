-- =============================================================================
-- 2026-11-14 — INDIAN CUSTOMS EXCHANGE RATE MODULE (history + audit + sync)
-- =============================================================================
-- Run ONCE in the Supabase SQL editor. Every statement is idempotent.
--
-- WHAT THIS REPLACES
--   db/2026-10-17-customs-exchange-rates.sql created `customs_exchange_rates`
--   as a ONE-ROW-PER-CURRENCY snapshot (currency_code was the whole primary
--   key) that src/lib/fx/customs.ts overwrote every 12 hours. That is a cache,
--   not a rate register: it cannot answer "what was the USD import rate on
--   2026-09-15", and every refresh destroyed the previous value.
--
--   The rate module needs a permanent, effective-dated register under that
--   exact name, so this patch:
--     1. renames the old snapshot table to `customs_rate_snapshot`
--        (its rows are preserved — nothing is dropped),
--     2. creates the real `customs_exchange_rates` history table,
--     3. adds `customs_exchange_rate_audit` and `customs_rate_sync_log`,
--     4. adds `get_customs_exchange_rate_as_of()`,
--     5. grants the two new capabilities to Admin/MD (+ Finance for viewing).
--
--   src/lib/fx/customs.ts is updated in the same change to read/write
--   `customs_rate_snapshot`. Until this patch is applied that reader keeps
--   working against the OLD table name (it falls back), so the Exchange Rate
--   Master page does not break in the window before the SQL is run.
--
-- DEPENDS ON: currencies(code), employees(id), roles(name), capabilities.
--
-- WHY TWO TABLES
--   * customs_rate_snapshot  — disposable, machine-refreshed "as of now" view
--                              used by the existing Exchange Rate Master page.
--   * customs_exchange_rates — the permanent, verified, effective-dated
--                              register the API, dashboard and calculator read.
--   A verified row here is IMMUTABLE (trigger below). Corrections are new
--   rows that supersede the old one; the old row is archived as 'superseded'
--   and keeps its full history.
--
-- ON "VERIFIED": a verified flag is never set because a file downloaded. The
-- ingestion service validates every field, checks the notification/effective
-- date, recomputes confidence and (for anything parsed from a PDF, or from a
-- non-official mirror) leaves the row PENDING for human approval. Only rows
-- that pass every structural check against an official source can be written
-- as verified automatically. See src/lib/customs/.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Rename the old snapshot table (preserve its rows).
--    Guarded so running this twice is a no-op.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.customs_exchange_rates') IS NOT NULL
     AND to_regclass('public.customs_rate_snapshot') IS NULL THEN
    ALTER TABLE public.customs_exchange_rates RENAME TO customs_rate_snapshot;
  END IF;
END $$;

-- If the module table already exists (this patch was run before), leave it be.
CREATE TABLE IF NOT EXISTS customs_rate_snapshot (
  currency_code    varchar(3) PRIMARY KEY,
  currency_name    text,
  import_rate      numeric(14,6) CHECK (import_rate IS NULL OR import_rate > 0),
  export_rate      numeric(14,6) NOT NULL CHECK (export_rate > 0),
  effective_date   date,
  notification_no  text,
  source           text NOT NULL DEFAULT 'eximin.net',
  source_url       text,
  fetched_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE customs_rate_snapshot IS
  'Disposable per-currency "latest fetched" cache used by the Exchange Rate Master page (src/lib/fx/customs.ts). NOT the rate register — that is customs_exchange_rates.';

-- -----------------------------------------------------------------------------
-- 2. The rate register.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customs_exchange_rates (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  currency_code          varchar(3) NOT NULL REFERENCES currencies(code),
  currency_name          text,
  -- 1 normally; 100 for currencies the notification quotes per 100 units
  -- (e.g. JPY, KRW). Stored explicitly so the calculator never has to guess.
  currency_unit          integer NOT NULL DEFAULT 1 CHECK (currency_unit IN (1, 10, 100, 1000)),
  import_rate            numeric(18,8) CHECK (import_rate IS NULL OR import_rate > 0),
  export_rate            numeric(18,8) NOT NULL CHECK (export_rate > 0),
  effective_start_date   date NOT NULL,
  effective_end_date     date,
  notification_no        text,
  notification_date      date,
  -- 'verified' means an approved official figure. The five statuses below are
  -- the required set; 'superseded' is added so a correction can retire a row
  -- without deleting the history the spec requires us to keep forever.
  verification_status    text NOT NULL DEFAULT 'pending'
                           CHECK (verification_status IN
                             ('pending', 'verified', 'rejected', 'source_unavailable',
                              'extraction_failed', 'superseded')),
  source                 text NOT NULL DEFAULT 'manual'
                           CHECK (source IN ('icegate', 'cbic', 'admin_csv',
                                             'admin_document', 'manual', 'mirror')),
  source_url             text,
  source_document_ref    text,
  source_checksum        text,
  extraction_confidence  numeric(5,2) CHECK (extraction_confidence IS NULL
                             OR (extraction_confidence >= 0 AND extraction_confidence <= 100)),
  validation_notes       text,
  raw_payload            jsonb,
  fetched_at             timestamptz NOT NULL DEFAULT now(),
  verified_by            uuid REFERENCES employees(id),
  verified_by_name       text,
  verified_at            timestamptz,
  created_by             uuid REFERENCES employees(id),
  supersedes_id          uuid REFERENCES customs_exchange_rates(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customs_rates_date_range
    CHECK (effective_end_date IS NULL OR effective_end_date >= effective_start_date)
);

COMMENT ON TABLE customs_exchange_rates IS
  'Permanent Indian Customs exchange-rate register: one effective-dated row per currency per notification, import and export rates stored separately, never rounded, with source document reference + checksum and verification status. Verified rows are immutable (see customs_exchange_rates_immutable). Read via get_customs_exchange_rate_as_of() or src/lib/customs/.';

-- One verified rate per currency per effective date. Pending/rejected rows may
-- repeat, so a correction proposal can sit beside the live row until approved.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customs_rates_verified_unique
  ON customs_exchange_rates (currency_code, effective_start_date)
  WHERE verification_status = 'verified';

-- Same source document must not be ingested twice for the same currency.
CREATE UNIQUE INDEX IF NOT EXISTS idx_customs_rates_checksum_unique
  ON customs_exchange_rates (source_checksum, currency_code)
  WHERE source_checksum IS NOT NULL;

-- Date-wise lookup is the hot path (API + calculator + history search).
CREATE INDEX IF NOT EXISTS idx_customs_rates_lookup
  ON customs_exchange_rates (currency_code, effective_start_date DESC, effective_end_date);
CREATE INDEX IF NOT EXISTS idx_customs_rates_status
  ON customs_exchange_rates (verification_status, effective_start_date DESC);
CREATE INDEX IF NOT EXISTS idx_customs_rates_notification
  ON customs_exchange_rates (notification_no);

-- -----------------------------------------------------------------------------
-- 3. Immutable audit trail.
--    Written by the application (src/lib/customs/ingest.ts and the admin
--    actions) so every row names WHO did it — a DB trigger cannot see the
--    signed-in employee through PostgREST. The trigger in §4 is the
--    defence-in-depth half: it refuses the mutation regardless of who calls.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customs_exchange_rate_audit (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rate_id            uuid REFERENCES customs_exchange_rates(id) ON DELETE CASCADE,
  action             text NOT NULL CHECK (action IN
                       ('insert', 'update', 'approve', 'reject', 'supersede',
                        'delete', 'sync', 'upload')),
  actor_employee_id  uuid REFERENCES employees(id),
  actor_name         text,
  changes            jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customs_rate_audit_rate
  ON customs_exchange_rate_audit (rate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customs_rate_audit_created
  ON customs_exchange_rate_audit (created_at DESC);

-- -----------------------------------------------------------------------------
-- 4. Guards: verified rows are immutable, and verified rows cannot be deleted.
--    A correction inserts a new row (supersedes_id) and archives the old one
--    as verification_status='superseded' — the rates themselves never change.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION customs_exchange_rates_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.verification_status IN ('verified', 'superseded') THEN
      RAISE EXCEPTION
        'Customs rate % (%) is % and cannot be deleted — insert a corrected row instead.',
        OLD.id, OLD.currency_code, OLD.verification_status;
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.verification_status = 'verified' THEN
    IF NEW.currency_code        IS DISTINCT FROM OLD.currency_code
       OR NEW.currency_unit     IS DISTINCT FROM OLD.currency_unit
       OR NEW.import_rate       IS DISTINCT FROM OLD.import_rate
       OR NEW.export_rate       IS DISTINCT FROM OLD.export_rate
       OR NEW.effective_start_date IS DISTINCT FROM OLD.effective_start_date
       OR NEW.notification_no   IS DISTINCT FROM OLD.notification_no
       OR NEW.source_checksum   IS DISTINCT FROM OLD.source_checksum THEN
      RAISE EXCEPTION
        'A verified customs rate is immutable. Insert a corrected row that supersedes %, do not edit it.',
        OLD.id;
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_customs_exchange_rates_guard ON customs_exchange_rates;
CREATE TRIGGER trg_customs_exchange_rates_guard
  BEFORE UPDATE OR DELETE ON customs_exchange_rates
  FOR EACH ROW EXECUTE FUNCTION customs_exchange_rates_guard();

CREATE OR REPLACE FUNCTION customs_exchange_rates_touch() RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_customs_exchange_rates_touch ON customs_exchange_rates;
CREATE TRIGGER trg_customs_exchange_rates_touch
  BEFORE UPDATE ON customs_exchange_rates
  FOR EACH ROW EXECUTE FUNCTION customs_exchange_rates_touch();

-- -----------------------------------------------------------------------------
-- 5. Sync log — one row per automatic/manual run, success or failure.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS customs_rate_sync_log (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  trigger_source text NOT NULL DEFAULT 'manual'
                   CHECK (trigger_source IN ('cron', 'manual', 'upload')),
  status         text NOT NULL DEFAULT 'running'
                   CHECK (status IN ('running', 'success', 'partial', 'failed',
                                     'source_unavailable')),
  provider       text,
  source_url     text,
  rows_extracted integer NOT NULL DEFAULT 0,
  rows_verified  integer NOT NULL DEFAULT 0,
  rows_pending   integer NOT NULL DEFAULT 0,
  message        text,
  details        jsonb,
  actor_employee_id uuid REFERENCES employees(id),
  actor_name     text
);
CREATE INDEX IF NOT EXISTS idx_customs_sync_started
  ON customs_rate_sync_log (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_customs_sync_status
  ON customs_rate_sync_log (status, started_at DESC);

COMMENT ON TABLE customs_rate_sync_log IS
  'Every customs-rate ingestion attempt (cron, manual sync, admin upload): outcome, provider, counts and the failure reason shown on the dashboard.';

-- -----------------------------------------------------------------------------
-- 6. As-of-date lookup. Returns the verified rate in force on p_as_of.
--    SECURITY: execute is granted to service_role only (the app's capability
--    gated server code); anon/authenticated cannot call it.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_customs_exchange_rate_as_of(
  p_currency_code varchar(3),
  p_as_of date
)
RETURNS TABLE (
  id                  uuid,
  currency_code       varchar(3),
  currency_name       text,
  currency_unit       integer,
  import_rate         numeric(18,8),
  export_rate         numeric(18,8),
  effective_start_date date,
  effective_end_date  date,
  notification_no     text,
  notification_date   date,
  source              text,
  source_url          text,
  source_document_ref text,
  verification_status text,
  verified_at         timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT r.id,
         r.currency_code,
         r.currency_name,
         r.currency_unit,
         r.import_rate,
         r.export_rate,
         r.effective_start_date,
         r.effective_end_date,
         r.notification_no,
         r.notification_date,
         r.source,
         r.source_url,
         r.source_document_ref,
         r.verification_status,
         r.verified_at
  FROM customs_exchange_rates r
  WHERE r.currency_code = upper(p_currency_code)
    AND r.verification_status = 'verified'
    AND r.effective_start_date <= p_as_of
    AND (r.effective_end_date IS NULL OR r.effective_end_date >= p_as_of)
  ORDER BY r.effective_start_date DESC, r.verified_at DESC NULLS LAST
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION get_customs_exchange_rate_as_of(varchar, date) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION get_customs_exchange_rate_as_of(varchar, date) FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON FUNCTION get_customs_exchange_rate_as_of(varchar, date) FROM authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION get_customs_exchange_rate_as_of(varchar, date) TO service_role';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 7. RLS — service-role-only tables (every read/write goes through server code
--    that has already checked a capability). Same stance as the biometric
--    tables: no blanket authenticated policy, no direct PostgREST access.
-- -----------------------------------------------------------------------------
ALTER TABLE customs_exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE customs_exchange_rates FORCE ROW LEVEL SECURITY;
ALTER TABLE customs_exchange_rate_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE customs_exchange_rate_audit FORCE ROW LEVEL SECURITY;
ALTER TABLE customs_rate_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE customs_rate_sync_log FORCE ROW LEVEL SECURITY;
ALTER TABLE customs_rate_snapshot ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON customs_exchange_rates, customs_exchange_rate_audit, customs_rate_sync_log FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON customs_exchange_rates, customs_exchange_rate_audit, customs_rate_sync_log FROM authenticated';
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 8. Capabilities.
--    customs_rate_view  — see current/historical rates + use the calculator.
--    customs_rate_admin — manual sync, uploads, approve/reject.
-- -----------------------------------------------------------------------------
INSERT INTO capabilities (code, description) VALUES
  ('customs_rate_view',  'View Indian Customs exchange rates (current + historical) and use the customs conversion calculator'),
  ('customs_rate_admin', 'Sync, upload and approve/reject Indian Customs exchange rate data — Admin/MD only')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, x.cap
FROM roles r
JOIN (VALUES
  ('Admin',   'customs_rate_view'),
  ('MD',      'customs_rate_view'),
  ('Finance', 'customs_rate_view'),
  ('Logistics', 'customs_rate_view'),
  ('Admin',   'customs_rate_admin'),
  ('MD',      'customs_rate_admin')
) AS x(role_name, cap) ON x.role_name = r.name
ON CONFLICT DO NOTHING;
