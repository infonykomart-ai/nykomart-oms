-- 2026-09-20 — "agar casa aara ke order huye to": the Telegram
-- (telegram-send-order/route.ts) and Whapi.Cloud WhatsApp
-- (whapi-send-order/route.ts) auto-send routes were both built against a
-- SINGLE global destination (TELEGRAM_ORDER_CHAT_ID / WHAPI_GROUP_ID env
-- vars) — fine while only Nyko Mart orders existed, but this app is
-- multi-company (Nyko Mart / Rugara / CASA ARRA — see companies table,
-- orders.company_id). Each company has its own order-packing WhatsApp
-- group (confirmed via GET /groups: "NYKO Orders ALL" vs "CASA ARRA All
-- Orders" are two different groups, two different @g.us ids) — sending
-- every company's orders to one hardcoded group would put CASA ARRA orders
-- in the Nyko Mart group and vice versa.
--
-- Fix: two new PER-COMPANY nullable columns, same shape as the existing
-- master_invoice_prefix column (a per-company setting that isn't worth its
-- own 1:1 table). NULL means "not configured for this company yet" — both
-- send routes fall back to the global env var when a company's column is
-- NULL, so existing Nyko Mart behavior is unchanged until each company's
-- value is explicitly filled in.
--
-- Idempotent — safe to re-run.

ALTER TABLE companies ADD COLUMN IF NOT EXISTS whapi_group_id text;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS telegram_chat_id text;

COMMENT ON COLUMN companies.whapi_group_id IS
  'WhatsApp group chat id (format "<numeric>@g.us") that this company''s orders auto-send to via Whapi.Cloud (src/app/api/whapi-send-order/route.ts). NULL falls back to the WHAPI_GROUP_ID env var.';
COMMENT ON COLUMN companies.telegram_chat_id IS
  'Telegram group chat id (negative number, e.g. "-1004324583746") that this company''s orders auto-send to via the Telegram Bot API (src/app/api/telegram-send-order/route.ts). NULL falls back to the TELEGRAM_ORDER_CHAT_ID env var.';

-- Known values as of 2026-09-20 — fill in / correct as confirmed:
--   Nyko Mart  — WhatsApp "NYKO Orders ALL"     = 120363405229833854@g.us  (matches the already-set WHAPI_GROUP_ID env var — no row update needed, env fallback already covers it)
--   CASA ARRA  — WhatsApp "CASA ARRA All Orders" = 120363411544640806@g.us (HIGH confidence — matched by group name in a live GET /groups call; not yet written here, awaiting confirmation)
--   Rugara     — WhatsApp group not yet identified in the fetched group list
-- Telegram chat ids per company are not yet known for Casa Arra/Rugara.
--
-- Example (run once confirmed):
--   UPDATE companies SET whapi_group_id = '120363411544640806@g.us' WHERE name = 'CASA ARRA';
--   UPDATE companies SET telegram_chat_id = '<chat id>' WHERE name = 'CASA ARRA';
--   UPDATE companies SET whapi_group_id = '<chat id>', telegram_chat_id = '<chat id>' WHERE name = 'Rugara';
