-- 2026-10-15b — live FX rate cache for the Amazon Country-wise ad spend view.
--
-- "TOTAL BUDGET KITNA HUA AMAZON KA SPEND KITNA HUA PERFECT CALCULATION SE
--  ACTUAL CONVERSION KE HISAB SE JO DAILY BASIS PAR UPDATE HO AUTOMATICLLY
--  GOOGLE SE": the Amazon ad-spend figures are entered in USD, while the
-- company's books are in INR — so the section has to convert them at a real
-- market rate, and that rate has to keep itself up to date instead of being
-- re-typed by hand.
--
-- Design notes (why a SEPARATE table and not exchange_rates):
--   * exchange_rates is the CUSTOMS/legal rate master — one row per currency
--     per CBIC notification date, entered by Finance with a notification no.
--     It governs invoice/valuation maths and must never be overwritten by an
--     API feed. This cache is the opposite: disposable, machine-refreshed, and
--     only ever used for on-screen conversion of ad-spend figures.
--   * rate is "1 unit of base_currency = `rate` units of quote_currency", so
--     1 USD = 95.25 INR is stored as ('USD','INR',95.25). Every row is cached
--     with base_currency = 'USD' (the provider's free endpoint is USD-based),
--     and a cross rate (e.g. GBP→INR) is derived as
--     usd_to_inr / usd_to_gbp — see src/lib/fx/rates.ts.
--   * market_updated_at is the provider's own "rates last changed" stamp;
--     fetched_at is when THIS app last pulled. The reader refreshes when
--     fetched_at is older than 12 hours, so the numbers are at most a day old
--     without any cron job.
CREATE TABLE IF NOT EXISTS fx_rate_cache (
  base_currency       varchar(3) NOT NULL,
  quote_currency      varchar(3) NOT NULL,
  rate                numeric(18,8) NOT NULL CHECK (rate > 0),
  source              text NOT NULL DEFAULT 'open.er-api.com',
  market_updated_at   timestamptz,
  fetched_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (base_currency, quote_currency)
);

COMMENT ON TABLE fx_rate_cache IS
  'Disposable cache of live FX rates (base USD) used only for on-screen conversion, e.g. the Amazon country-wise ad spend totals. NOT the legal/customs rate — that is exchange_rates. See src/lib/fx/rates.ts and db/2026-10-15b-fx-rate-cache.sql.';

-- Same "no public RLS policies" stance as the other service-role-only tables
-- (every read/write goes through a capability-checked server action/page).
ALTER TABLE fx_rate_cache ENABLE ROW LEVEL SECURITY;

INSERT INTO fx_rate_cache (base_currency, quote_currency, rate, source, market_updated_at)
VALUES ('USD', 'USD', 1, 'identity', now())
ON CONFLICT (base_currency, quote_currency) DO NOTHING;
