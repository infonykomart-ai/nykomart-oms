-- 2026-11-25 — Automatic WhatsApp order-status messages.
--
-- WHAT THIS ADDS
--   1. order_whatsapp_messages learns the new message kind ('order_status')
--      and the delivery states a real 1:1 send goes through — queued →
--      processing → sent → delivered → read, plus failed — so "the API
--      accepted it" and "the handset received it" are recorded separately,
--      as they must be.
--   2. The columns a 1:1 customer message needs: the number it went to, the
--      transition that caused it (previous_status → new_status), the sender
--      (provider) and the provider's own message id, which is what the
--      delivery webhook matches on.
--   3. company_whatsapp_settings — the admin-controlled switchboard: one row
--      per company, auto-send on/off, one toggle per trigger, and the three
--      message templates. No token column: the Whapi token stays in the
--      deployment environment (WHAPI_TOKEN), never in a row a browser can read.
--
-- WHY THE EXISTING TABLE IS REUSED
--   order_whatsapp_messages already holds every WhatsApp send with an
--   event_id and UNIQUE (order_id, message_type, event_id) — exactly the
--   duplicate guard this feature needs. A second table would duplicate the
--   history and split "what did we send this order" in two.
--
-- COMPATIBILITY
--   Every change is additive: existing rows keep message_type
--   'reference_photo', their delivery_status values stay valid, and the new
--   columns are nullable. The reference-photo automation is untouched.
--
-- ROLLBACK
--   DROP TABLE IF EXISTS company_whatsapp_settings;
--   DROP INDEX IF EXISTS idx_order_whatsapp_retry;
--   DROP INDEX IF EXISTS idx_order_whatsapp_provider_message;
--   ALTER TABLE order_whatsapp_messages
--     DROP COLUMN IF EXISTS customer_phone,
--     DROP COLUMN IF EXISTS previous_status,
--     DROP COLUMN IF EXISTS new_status,
--     DROP COLUMN IF EXISTS provider,
--     DROP COLUMN IF EXISTS provider_message_id,
--     DROP COLUMN IF EXISTS delivered_at,
--     DROP COLUMN IF EXISTS read_at,
--     DROP COLUMN IF EXISTS next_attempt_at,
--     DROP COLUMN IF EXISTS last_attempt_at;
--   -- then restore the two older CHECK constraints from
--   -- db/2026-11-20-whatsapp-reference-photos.sql.
--
-- Safe to run more than once.

BEGIN;

-- 1. New message kind -------------------------------------------------------
ALTER TABLE order_whatsapp_messages
  DROP CONSTRAINT IF EXISTS order_whatsapp_messages_message_type_check;

ALTER TABLE order_whatsapp_messages
  ADD CONSTRAINT order_whatsapp_messages_message_type_check
  CHECK (message_type IN ('reference_photo', 'order_update', 'order_status'));

-- 2. Full delivery lifecycle ------------------------------------------------
-- 'queued'/'processing' = saved, not yet attempted / attempt in flight.
-- 'delivered'/'read' are ONLY ever written by the provider webhook — a 2xx
-- from the send API means 'sent' and nothing more.
ALTER TABLE order_whatsapp_messages
  DROP CONSTRAINT IF EXISTS order_whatsapp_messages_delivery_status_check;

ALTER TABLE order_whatsapp_messages
  ADD CONSTRAINT order_whatsapp_messages_delivery_status_check
  CHECK (delivery_status IN (
    'queued', 'pending', 'processing', 'sent', 'partial',
    'delivered', 'read', 'failed', 'skipped'
  ));

-- 3. The 1:1 message columns ------------------------------------------------
ALTER TABLE order_whatsapp_messages
  ADD COLUMN IF NOT EXISTS customer_phone     text,
  ADD COLUMN IF NOT EXISTS previous_status    text,
  ADD COLUMN IF NOT EXISTS new_status         text,
  ADD COLUMN IF NOT EXISTS provider           text NOT NULL DEFAULT 'whapi',
  ADD COLUMN IF NOT EXISTS provider_message_id text,
  ADD COLUMN IF NOT EXISTS delivered_at       timestamptz,
  ADD COLUMN IF NOT EXISTS read_at            timestamptz,
  ADD COLUMN IF NOT EXISTS next_attempt_at    timestamptz,
  ADD COLUMN IF NOT EXISTS last_attempt_at    timestamptz;

COMMENT ON COLUMN order_whatsapp_messages.customer_phone IS
  'Digits sent to, international format (no +). Never rendered back to a broad audience; the admin settings page masks it.';
COMMENT ON COLUMN order_whatsapp_messages.previous_status IS
  'Order status before the change that triggered this message (NULL for other message types).';
COMMENT ON COLUMN order_whatsapp_messages.new_status IS
  'Order status after the change — Hold / Cancelled / In Production for order_status rows.';
COMMENT ON COLUMN order_whatsapp_messages.provider_message_id IS
  'The sender''s own id for this message; the delivery webhook matches on it to set delivered/read.';
COMMENT ON COLUMN order_whatsapp_messages.next_attempt_at IS
  'Earliest time the retry job may try again. NULL = no retry scheduled.';

-- The retry job's own query: pending work, oldest-due first.
CREATE INDEX IF NOT EXISTS idx_order_whatsapp_retry
  ON order_whatsapp_messages (delivery_status, next_attempt_at)
  WHERE message_type = 'order_status';

-- Webhook lookups by the provider's id.
CREATE INDEX IF NOT EXISTS idx_order_whatsapp_provider_message
  ON order_whatsapp_messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_order_whatsapp_order_created
  ON order_whatsapp_messages (order_id, created_at DESC);

-- 4. Admin settings ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS company_whatsapp_settings (
  company_id                uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  auto_status_enabled       boolean NOT NULL DEFAULT true,
  hold_enabled              boolean NOT NULL DEFAULT true,
  cancel_enabled            boolean NOT NULL DEFAULT true,
  process_enabled           boolean NOT NULL DEFAULT true,
  -- '{po}' is replaced with the order's reference (e.g. PO-A1154). Text is
  -- stored here so an admin can reword without a deployment.
  hold_template             text NOT NULL DEFAULT 'Hold this order {po}',
  cancel_template           text NOT NULL DEFAULT 'Cancel This Order {po}',
  process_template          text NOT NULL DEFAULT 'Process This Order {po}',
  updated_by_employee_id    uuid REFERENCES employees(id) ON DELETE SET NULL,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE company_whatsapp_settings IS
  '2026-11-25 — admin-controlled automatic WhatsApp order-status messages. Missing row = built-in defaults (all enabled, default templates).';

ALTER TABLE company_whatsapp_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_whatsapp_settings_authenticated_all ON company_whatsapp_settings;
CREATE POLICY company_whatsapp_settings_authenticated_all ON company_whatsapp_settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Verification (read-only, run after COMMIT):
--   SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conrelid = 'order_whatsapp_messages'::regclass ORDER BY 1;
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name IN ('order_whatsapp_messages', 'company_whatsapp_settings')
--    ORDER BY table_name, ordinal_position;

COMMIT;
