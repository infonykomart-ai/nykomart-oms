-- 2026-10-15 — Amazon is advertised per MARKETPLACE COUNTRY, not per store:
-- "AMAZON ME ALAG ALAG COUNTRY KE HISAB SE BUDGT & SPEND HOTA HAI TO USKA
-- MERE HISAB SE COUNTRY SECTION OR BAN JAYE JO SIRF AMAZON PAR WORK KARE".
-- One Amazon store (e.g. "Amazon Rugara") runs separate US / UK / DE … ad
-- campaigns with their own daily budgets, so a single (store, date) row can
-- no longer hold the whole day's numbers.
--
-- Design (mirrors db/schema.sql's own comment on store_ad_spend):
--   * country_code is the Amazon marketplace country code ('US', 'GB', …).
--   * Non-Amazon stores (Etsy / eBay / Website / Wholesale) keep ONE row per
--     day with country_code = '' — the column is genuinely not applicable
--     there, and '' (never NULL) keeps the UNIQUE key below enforceable
--     (Postgres treats NULLs as distinct, which would silently allow
--     duplicate "blank country" rows for the same store/date).
--   * The country list is validated in the app (src/app/dashboard/ad-spend/
--     amazon-countries.ts) AND here, so a bad code can't reach the table.
--
-- Totals are unaffected: splitting one day's Amazon row into per-country
-- rows sums to exactly the same Budget/Spend as before, so every existing
-- consumer (finance dashboard RPC, P&L by store, etc.) keeps its numbers.

ALTER TABLE store_ad_spend
  ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT '';

COMMENT ON COLUMN store_ad_spend.country_code IS
  'Amazon marketplace country code (US/CA/MX/AU/GB/DE/IT/JP/FR/ES/IN/AE). Empty string = the store is not Amazon, one row per store+day. See db/2026-10-15-ad-spend-amazon-country.sql.';

-- The old key was (store_id, spend_date) — replace it with the 3-column key
-- so the Amazon per-country rows can coexist on the same day.
ALTER TABLE store_ad_spend
  DROP CONSTRAINT IF EXISTS store_ad_spend_store_id_spend_date_key;

ALTER TABLE store_ad_spend
  DROP CONSTRAINT IF EXISTS store_ad_spend_store_date_country_key;

ALTER TABLE store_ad_spend
  ADD CONSTRAINT store_ad_spend_store_date_country_key
  UNIQUE (store_id, spend_date, country_code);

ALTER TABLE store_ad_spend
  DROP CONSTRAINT IF EXISTS store_ad_spend_country_code_check;

ALTER TABLE store_ad_spend
  ADD CONSTRAINT store_ad_spend_country_code_check
  CHECK (country_code IN ('', 'US', 'CA', 'MX', 'AU', 'GB', 'DE', 'IT', 'JP', 'FR', 'ES', 'IN', 'AE'));

CREATE INDEX IF NOT EXISTS idx_store_ad_spend_store_country_date
  ON store_ad_spend(store_id, country_code, spend_date);
