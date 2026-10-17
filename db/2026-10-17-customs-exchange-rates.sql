-- 2026-10-17 — automatic customs/export exchange rates.
--
-- "exchange rate abhi kaha se aari hai ... DGFT se ana chahiye jo auto update
--  rahe ... agar ye link kaam nahi kare to ICEGATE ... agar yaha se bhi nahi
--  mile to eximin.net ... automatic aani chahiye convert hokar export ki rate
--  sabhi currency ki."
--
-- One row per currency: the latest customs notification's IMPORT and EXPORT
-- rate-to-INR, when it took effect, and which provider supplied it. The
-- reader (src/lib/fx/customs.ts) refreshes this when older than 12 hours, so
-- there is no cron job to maintain — any page that needs a rate refreshes it.
--
-- Why a separate table from exchange_rates: exchange_rates is the legal
-- master (one row per currency per CBIC notification, entered by Finance) and
-- must never be silently rewritten by an API feed. The EXPORT rate from here
-- is mirrored into exchange_rates ONLY for a currency+date that no manual row
-- already owns, and those API-written rows carry remark "AUTO — ...".
CREATE TABLE IF NOT EXISTS customs_exchange_rates (
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

COMMENT ON TABLE customs_exchange_rates IS
  'Automatically refreshed customs exchange rates (import/export, INR per unit) from DGFT → ICEGATE → eximin.net. Disposable snapshot; the legal master is exchange_rates. See src/lib/fx/customs.ts.';

ALTER TABLE customs_exchange_rates ENABLE ROW LEVEL SECURITY;
