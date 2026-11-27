-- 2026-11-27 — orders.whatsapp_sent_at is DEPRECATED / read-only (audit fix
-- #3.10).
--
-- WHY
-- "Was a WhatsApp message sent for this order?" had two answers:
--   • orders.whatsapp_sent_at — the 2026-08-06 original: a single timestamp
--     written by the order-entry share button, which also drives the green
--     "✓ WA sent" row badge and the row tint on the Orders hub; and
--   • order_whatsapp_messages — the real delivery log (2026-11-20), one row per
--     automatic send (reference photos, order-status messages), with the
--     provider's message ids, delivery/read state and failure reason.
-- The two could disagree: a message in the log could exist with the legacy
-- column NULL (or the reverse), so the same order looked "not sent" in one
-- place and "sent" in another.
--
-- THE FIX (code, not this file)
-- The log is now the only writer AND the only source the badges derive from
-- (latest successful order_whatsapp_messages row). markOrderWhatsAppSent() no
-- longer writes this column — it records an `order_update` row in the log
-- instead. The badge keeps falling back to this column for orders whose only
-- send predates the log, so no history is lost.
--
-- This file only marks the column in the database itself, so anyone reading
-- the schema sees the same thing the code now says. The column is NOT dropped:
-- historical rows still carry real information and a drop needs a backup
-- snapshot first (db/MIGRATIONS.md §4).
--
-- Idempotent: safe to run twice. Creates nothing the API can verify, so it is a
-- `manual` probe on Admin → Database / Migration Status.
begin;

comment on column orders.whatsapp_sent_at is
  'DEPRECATED since 2026-11-27 (audit 3.10) — read-only history. The single source of truth for a WhatsApp send is order_whatsapp_messages (one row per message, with delivery/read state). This column is no longer written; the Orders/Order-Entry badges fall back to it only for sends that pre-date that log.';

commit;
