-- =====================================================================
-- Automation infrastructure: marketplace API credentials, sync audit
-- log, and courier webhook audit log.
--
-- This does NOT change `orders` or `dispatch_invoices` — new orders
-- created by the sync job go through the exact same insert path as
-- manual entry (createOrderCore() in src/app/dashboard/orders/new/actions.ts),
-- so every existing business rule (ref-no reservation, duplicate-buyer
-- detection, currency conversion) keeps applying identically whether a
-- human typed the order or the connector fetched it.
--
-- Run this AFTER db/2026-08-08-enable-rls.sql, then RE-RUN
-- db/2026-08-08-enable-rls.sql once more so its authenticated-only
-- policy gets applied to these 3 new tables too (that script loops over
-- every table in `public` at the time it runs — these tables don't
-- exist yet on a first pass before this file, so the loop needs to run
-- again afterward to pick them up; safe/idempotent to re-run).
-- =====================================================================

CREATE TYPE marketplace_provider AS ENUM ('amazon','etsy','woocommerce','ebay','walmart');

-- One row per store's connection to its marketplace API. A store already
-- exists per marketplace in `stores` (see db/schema.sql) — this table adds
-- the credential + sync-state layer on top of that, without touching the
-- existing table.
CREATE TABLE marketplace_credentials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id          uuid NOT NULL UNIQUE REFERENCES stores(id),
  provider          marketplace_provider NOT NULL,

  -- Encrypted with AES-256-GCM in the application layer (see
  -- src/lib/crypto/secret-box.ts) BEFORE being written here — never store
  -- plain API keys/secrets, even in a column that RLS already protects.
  -- bytea holds: iv(12) || authTag(16) || ciphertext, base64-decoded.
  api_key_enc       bytea NOT NULL,
  api_secret_enc    bytea,               -- nullable: some providers (Etsy OAuth) use a refresh token here instead
  extra_config      jsonb NOT NULL DEFAULT '{}',  -- provider-specific: shop_id, marketplace region, store URL, etc.

  is_active         boolean NOT NULL DEFAULT true,
  last_synced_at    timestamptz,          -- watermark: next sync fetches orders placed after this
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid REFERENCES employees(id)
);

-- Every sync run (cron-triggered) writes one row here, success or failure.
-- This is what lets you actually see "did last night's Amazon sync work"
-- instead of silently trusting a cron job.
CREATE TABLE marketplace_sync_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  store_id              uuid NOT NULL REFERENCES stores(id),
  started_at            timestamptz NOT NULL DEFAULT now(),
  finished_at           timestamptz,
  orders_fetched        integer NOT NULL DEFAULT 0,
  orders_created        integer NOT NULL DEFAULT 0,
  orders_skipped_dup    integer NOT NULL DEFAULT 0,  -- marketplace_order_no already existed — not an error, just idempotency
  status                text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','SUCCESS','FAILED')),
  error_message         text
);
CREATE INDEX idx_sync_log_store_started ON marketplace_sync_log(store_id, started_at DESC);

-- Courier tracking webhooks: raw payload always logged first (before any
-- processing), so a bug in the parsing logic never loses data — you can
-- always replay from here. `processed` flips true once dispatch_invoices/
-- orders have actually been updated from this payload.
CREATE TABLE courier_webhook_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at       timestamptz NOT NULL DEFAULT now(),
  courier_name      text NOT NULL,
  awb_no            text,
  raw_payload       jsonb NOT NULL,
  processed         boolean NOT NULL DEFAULT false,
  processed_at      timestamptz,
  error_message     text
);
CREATE INDEX idx_courier_webhook_awb ON courier_webhook_log(awb_no);
CREATE INDEX idx_courier_webhook_unprocessed ON courier_webhook_log(processed) WHERE processed = false;

-- New tables need RLS too — see header comment. Enabling here as a
-- baseline (matches the rest of this file's tables being locked down by
-- default); the authenticated-all policy gets attached when
-- 2026-08-08-enable-rls.sql is re-run after this file.
ALTER TABLE marketplace_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE marketplace_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE courier_webhook_log ENABLE ROW LEVEL SECURITY;
