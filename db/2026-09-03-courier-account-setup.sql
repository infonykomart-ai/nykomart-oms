-- 2026-09-03 — Courier Account Setup: per-company, per-courier credentials
-- entered through the app's own UI (new "Account Setup" tab on
-- /dashboard/courier-booking) instead of Vercel environment variables.
--
-- Context: owner asked (Hindi) for a unified booking/tracking/label
-- dashboard, "usme hi pehle account setup karne ka option ho jese apn naya
-- account setup karte hai" — an in-app place to enter each courier's own
-- account credentials, like setting up any new courier account. Investigation
-- (see claude project doc courier-account-setup-dashboard-2026-09-03.md)
-- found all 6 real-API booking clients (fedex-ship.ts, ups-ship.ts,
-- aramex-shipping.ts, delhivery-ship.ts, shiprocket-ship.ts, dhl-ship.ts)
-- read credentials straight from process.env.* — global to the whole
-- deployment, not per-company, and only settable by editing Vercel's
-- dashboard directly. This table is the new UI's storage.
--
-- Reuses the EXISTING encryption primitive (src/lib/crypto/secret-box.ts,
-- AES-256-GCM) already live for marketplace_credentials (see
-- db/2026-08-10-... — that table's own api_key_enc/api_secret_enc columns)
-- rather than inventing a new one. Unlike marketplace_credentials (exactly 2
-- fixed secret columns, one shape for every provider), each of these 6
-- couriers has a DIFFERENT credential shape (2 to 6 fields — see
-- src/lib/couriers/credentials.ts's COURIER_CREDENTIAL_FIELDS for the
-- authoritative per-courier field list) — a single jsonb column of
-- individually-encrypted field values avoids either 6 near-duplicate tables
-- or one table with a dozen mostly-null columns (same reasoning
-- courier_shipments itself already used for the analogous per-courier
-- response-shape problem — see that table's own migration comment).
--
-- Idempotent (IF NOT EXISTS / ON CONFLICT everywhere) — safe to re-run.

-- -----------------------------------------------------------------------
-- 1. courier_credentials
-- -----------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS courier_credentials (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id   uuid NOT NULL REFERENCES companies(id),
  courier      text NOT NULL CHECK (courier IN ('fedex', 'ups', 'aramex', 'delhivery', 'shiprocket', 'dhl')),
  secrets_enc  jsonb NOT NULL DEFAULT '{}',
  updated_at   timestamptz NOT NULL DEFAULT now(),
  updated_by   uuid REFERENCES employees(id),
  UNIQUE (company_id, courier)
);

COMMENT ON TABLE courier_credentials IS
  'Per-company, per-courier API credentials entered via the Account Setup tab on /dashboard/courier-booking. Every credential FIELD is individually encrypted with secret-box.ts''s encryptSecret() (AES-256-GCM: iv||authTag||ciphertext), then base64-encoded, before being written into secrets_enc as {"field_name": "<base64>"} — Postgres has no "map of bytea" type, so jsonb-of-base64-strings stands in for it. Field NAMES are plain jsonb keys (not secret); only the VALUES are ciphertext. Decrypt with decryptSecret(Buffer.from(value, "base64")) — src/lib/couriers/credentials.ts is the only file that should ever read this column, and it must never log or return the decrypted object to the browser. When a company has no row (or a row missing some fields) for a courier, src/lib/couriers/credentials.ts falls back to that courier''s legacy process.env.* vars for whatever is missing — nothing breaks for a company that hasn''t used Account Setup yet.';

CREATE INDEX IF NOT EXISTS idx_courier_credentials_company ON courier_credentials(company_id);

-- -----------------------------------------------------------------------
-- 2. New capability — deliberately separate from 'courier_booking_shipment',
--    same reasoning performance_admin was split from attendance_admin
--    (2026-09-02): entering/editing courier API credentials is more
--    sensitive than making a booking with credentials someone else already
--    set up. Only MD/Admin get it by default. An employee with
--    courier_booking_shipment but not this capability still sees the
--    Account Setup tab's read-only "configured ✓ / not set up" badges (those
--    never reveal a secret value) but not the save forms themselves.
-- -----------------------------------------------------------------------
INSERT INTO capabilities (code, description) VALUES
  ('courier_credentials_admin', 'Enter/edit courier API account credentials (FedEx, UPS, Aramex, Delhivery, Shiprocket, DHL) in the Courier Booking dashboard''s Account Setup tab — Admin/MD only')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'courier_credentials_admin'
FROM roles r
WHERE r.name IN ('MD', 'Admin')
ON CONFLICT (role_id, capability_code) DO NOTHING;
