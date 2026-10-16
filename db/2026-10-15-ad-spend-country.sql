-- 2026-10-15 — Store Ad Spend: Amazon country dimension.
-- "AMAZON ME ALAG ALAG COUNTRY KE HISAB SE BUDGT & SPEND HOTA HAI TO USKA
--  MERE HISAB SE COUNTRY SECTION OR BAN JAYE JO SIRF AMAZON PAR WORK KARE."
--
-- Amazon's ad console budgets/spends per marketplace COUNTRY, so an Amazon
-- store now gets one row per (store, date, country). Every other platform
-- (Etsy / eBay / Website) keeps the old one-row-per-(store, date) shape with
-- country = ''. '' rather than NULL so the unique index below treats all
-- non-Amazon rows as the SAME single slot — Postgres unique indexes let NULL
-- repeat, so a nullable column would have allowed duplicate same-day rows.
-- The 12 countries are exactly the user's list (Amazon marketplaces they run).
--
-- Idempotent: safe to run twice. Folded into db/schema.sql (single source of
-- truth); regenerate src/types/database.ts afterwards (node scripts/gen-types.mjs
-- with a local Postgres loaded from schema.sql).

ALTER TABLE store_ad_spend
  ADD COLUMN IF NOT EXISTS country text NOT NULL DEFAULT '';

-- The old (store_id, spend_date) slot is too narrow once Amazon splits by
-- country; drop and replace with the 3-column version.
ALTER TABLE store_ad_spend DROP CONSTRAINT IF EXISTS store_ad_spend_store_id_spend_date_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'store_ad_spend_country_check'
      AND conrelid = 'store_ad_spend'::regclass
  ) THEN
    ALTER TABLE store_ad_spend ADD CONSTRAINT store_ad_spend_country_check
      CHECK (country IN (
        '', 'USA', 'Canada', 'Mexico', 'Australia', 'UK',
        'Germany', 'Italy', 'Japan', 'France', 'Spain', 'India', 'UAE'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'store_ad_spend_store_id_spend_date_country_key'
      AND conrelid = 'store_ad_spend'::regclass
  ) THEN
    ALTER TABLE store_ad_spend ADD CONSTRAINT store_ad_spend_store_id_spend_date_country_key
      UNIQUE (store_id, spend_date, country);
  END IF;
END $$;

COMMENT ON COLUMN store_ad_spend.country IS
  'Amazon-only marketplace country (USA/Canada/Mexico/Australia/UK/Germany/Italy/Japan/France/Spain/India/UAE) — Amazon budgets per country, so an Amazon store has one row per (store, date, country). Every non-Amazon platform keeps '''' (one row per store+date, matching the pre-2026-10-15 shape).';
