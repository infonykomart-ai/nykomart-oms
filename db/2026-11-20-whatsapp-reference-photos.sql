-- 2026-11-20 — "REF PHOTO [ORDER NUMBER]" WhatsApp automation.
--
-- When an order is updated in the OMS, any Close-Up / Reference photos
-- already attached to that order are now sent to the company's WhatsApp
-- order group automatically, as real image attachments, with the caption
-- "REF PHOTO PO-XXXX" (the order's own ref_no — never hard-coded).
--
-- Everything needed already exists on `orders`:
--   • orders.photo_url     = the MAIN product photo (photo #1)
--   • orders.photo_urls[]  = the full list, photo #1 first; every later
--                            entry is a Close-Up / Reference photo
--                            (db/2026-09-18-orders-multi-photo-and-
--                            capability-sync.sql). Nothing here changes
--                            those columns, so every existing reader keeps
--                            working unchanged.
--
-- This migration only adds the delivery log the automation needs:
--   • which event caused a send (event_id — a hash of the order's state, so
--     a repeated webhook / double click for the SAME update can never send
--     the same photos twice, while a genuinely new edit has a new id)
--   • which photos were attached and which WhatsApp message ids came back
--   • the delivery status, the failure reason, and the retry count
--
-- SIZE UNITS ARE DELIBERATELY UNTOUCHED. This file does not read or write
-- orders.size_label / dimension_* and does not touch
-- company_measurement_settings. Order sizes are stored exactly as typed and
-- are never converted or overridden by global measurement settings.
--
-- Safe to re-run: every object is IF NOT EXISTS / CREATE OR REPLACE-ish, and
-- no existing table, column, row or policy is modified.

BEGIN;

CREATE TABLE IF NOT EXISTS order_whatsapp_messages (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid REFERENCES companies(id) ON DELETE SET NULL,
  order_id                uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  order_reference         text NOT NULL,
  -- 'order_update' is reserved for the existing order-update message so the
  -- same log can hold it later without another migration.
  message_type            text NOT NULL DEFAULT 'reference_photo'
                            CHECK (message_type IN ('reference_photo', 'order_update')),
  -- Hash of the order state that triggered the send. UNIQUE with
  -- (order_id, message_type) below is the duplicate guard: the same update
  -- event can only ever have one log row, and that row is UPDATED on retry
  -- rather than a second copy being inserted.
  event_id                text NOT NULL,
  message_text            text,
  -- Photo URLs in the order they were attempted, and the WhatsApp message id
  -- for each successful one (same index -> same photo). Both empty for a
  -- 'skipped' row (no close-up photos on that event).
  attachment_photo_ids    text[] NOT NULL DEFAULT '{}',
  whatsapp_message_ids    text[] NOT NULL DEFAULT '{}',
  delivery_status         text NOT NULL DEFAULT 'pending'
                            CHECK (delivery_status IN ('pending', 'sent', 'partial', 'failed', 'skipped')),
  error_message           text,
  retry_count             integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  created_by_employee_id  uuid REFERENCES employees(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  -- Only set when at least one image genuinely left the OMS. A failed or
  -- pending row stays NULL — a failure is never recorded as delivered.
  sent_at                 timestamptz,
  UNIQUE (order_id, message_type, event_id)
);

COMMENT ON TABLE order_whatsapp_messages IS
  '2026-11-20: delivery log for automatic WhatsApp sends from an order. '
  'message_type=reference_photo is the "REF PHOTO <ref_no>" message that carries '
  'the order''s Close-Up photos (orders.photo_urls[2..]); message_type=order_update '
  'is reserved for the existing order-update message. event_id is a hash of the '
  'order state, and (order_id, message_type, event_id) is unique, so a repeated '
  'webhook/click for the same update cannot send the same photos twice. A retry '
  'updates the same row (retry_count + 1); sent_at is only set when something was '
  'actually delivered. Order sizes/units are not involved.';

COMMENT ON COLUMN order_whatsapp_messages.attachment_photo_ids IS
  'Ordered photo URLs attempted for this event. whatsapp_message_ids holds the '
  'WhatsApp message id of each successful one at the same index, so a partial '
  'send can be resumed without re-sending the photos that already went out.';

-- The order page reads the newest row per order; this is the exact lookup.
CREATE INDEX IF NOT EXISTS idx_order_whatsapp_messages_order_created
  ON order_whatsapp_messages (order_id, created_at DESC);

-- Retry/ops views: find failed deliveries quickly.
CREATE INDEX IF NOT EXISTS idx_order_whatsapp_messages_status
  ON order_whatsapp_messages (delivery_status, created_at DESC)
  WHERE delivery_status IN ('failed', 'partial', 'pending');

-- Same RLS convention as every other operational table in this project:
-- app code uses the service-role client, and authenticated users may use the
-- table directly if they ever do.
ALTER TABLE order_whatsapp_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_whatsapp_messages FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated_all ON order_whatsapp_messages;
CREATE POLICY allow_authenticated_all ON order_whatsapp_messages
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- ============================================================================
-- Verification (read-only; run after the migration)
-- ============================================================================
-- 1) Table + columns exist:
--    SELECT column_name, data_type, is_nullable
--      FROM information_schema.columns
--     WHERE table_name = 'order_whatsapp_messages'
--     ORDER BY ordinal_position;
-- 2) Duplicate guard exists:
--    SELECT indexname, indexdef FROM pg_indexes
--     WHERE tablename = 'order_whatsapp_messages';
-- 3) Existing order data is untouched (total must not change):
--    SELECT count(*) AS orders, count(photo_urls) AS with_photo_list FROM orders;
-- 4) Size/unit columns are untouched — values are still exactly as entered:
--    SELECT id, ref_no, size_label, dimension_length, dimension_width, dimension_unit
--      FROM orders ORDER BY entry_timestamp DESC LIMIT 10;
-- 5) Recent reference-photo sends:
--    SELECT order_reference, delivery_status, retry_count, created_at, sent_at, error_message
--      FROM order_whatsapp_messages
--     WHERE message_type = 'reference_photo'
--     ORDER BY created_at DESC LIMIT 20;
