-- 2026-09-30 — "EMPLOYEE KO JO MSG WHATSAPP SE THA USKO WHATSAPP KI JAGAH
-- TELEGRAM SE CONNECT KARO DIRECT TELEGRAM PAR MSG JAYE": the per-employee
-- punch confirmation (punch in / punch out) moves from WhatsApp (Whapi) to
-- a personal Telegram DM. WhatsApp is now OFF for this flow entirely —
-- see src/lib/attendance/telegram-notify.ts.
--
-- Destination: each employee's OWN Telegram chat id, captured self-serve
-- from the Attendance page — the employee opens
-- https://t.me/<TELEGRAM_BOT_USERNAME>?start=<employee_id>, presses Start,
-- and the "Connect" action reads that /start payload out of the bot's
-- getUpdates queue and stores message.from.id here. NULL = not connected
-- yet (the notification then skips, with a console warning that names the
-- employee — same observability contract the WhatsApp sender had).
--
-- The bot token (TELEGRAM_BOT_TOKEN) is the SAME bot the order-photo
-- Telegram notifications already use; this column is only the per-person
-- DM destination (like employees.whatsapp_no was for the WhatsApp channel).
ALTER TABLE employees ADD COLUMN IF NOT EXISTS telegram_chat_id text;

COMMENT ON COLUMN employees.telegram_chat_id IS
  'Telegram DM chat id (message.from.id) for punch in/out notifications — set via the Attendance page self-serve connect flow; NULL = not connected';
