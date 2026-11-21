-- 2026-11-21 — Channel metrics for the Store Ad Spend Daily Entry.
--
-- The user asked for marketplace-specific numbers to be entered next to the
-- Budget/Spend that already lives in store_ad_spend:
--
--   AMAZON  clicks (manual), impressions (manual), visiting (manual),
--           CTR% = if impressions = 0 then 0 else clicks * 100 / impressions
--   EBAY    visits, impressions, clicks
--   ETSY    visits (daily), visits (monthly), conversion rate (monthly),
--           revenue, orders, ads clicks, today's spend, and the monthly
--           spend percentage based on that revenue (computed on read, never
--           stored — see channel-metrics.ts).
--
-- All columns are NULL-able and nullable means "not recorded", exactly like
-- ad_orders: a blank field is not a typed zero, so the report and the charts
-- can leave it out instead of drawing a fake number.
--
-- CTR is never stored: it is always clicks * 100 / impressions computed from
-- the two typed values (see ctrPct() in channel-metrics.ts), so the two can
-- never disagree.
--
-- Safe to run more than once.

ALTER TABLE store_ad_spend
  ADD COLUMN IF NOT EXISTS clicks integer,
  ADD COLUMN IF NOT EXISTS impressions integer,
  ADD COLUMN IF NOT EXISTS visits integer,
  ADD COLUMN IF NOT EXISTS etsy_visits_daily integer,
  ADD COLUMN IF NOT EXISTS etsy_visits_monthly integer,
  ADD COLUMN IF NOT EXISTS etsy_conversion_rate_monthly numeric(7, 2),
  ADD COLUMN IF NOT EXISTS etsy_revenue_usd numeric(14, 2),
  ADD COLUMN IF NOT EXISTS etsy_orders integer,
  ADD COLUMN IF NOT EXISTS etsy_ad_clicks integer;

COMMENT ON COLUMN store_ad_spend.clicks IS
  'Ad clicks for the day (Amazon / eBay). NULL = not recorded.';
COMMENT ON COLUMN store_ad_spend.impressions IS
  'Ad impressions (views) for the day (Amazon / eBay). NULL = not recorded. CTR% is derived from this and clicks, never stored.';
COMMENT ON COLUMN store_ad_spend.visits IS
  'Amazon "Visiting" / eBay Visits for the day. NULL = not recorded.';
COMMENT ON COLUMN store_ad_spend.etsy_visits_daily IS
  'Etsy visits for the day. NULL = not recorded.';
COMMENT ON COLUMN store_ad_spend.etsy_visits_monthly IS
  'Etsy visits for the month (as shown by Etsy Stats). NULL = not recorded.';
COMMENT ON COLUMN store_ad_spend.etsy_conversion_rate_monthly IS
  'Etsy monthly conversion rate, in percent, exactly as Etsy Stats reports it. NULL = not recorded.';
COMMENT ON COLUMN store_ad_spend.etsy_revenue_usd IS
  'Etsy revenue for the month in USD. The monthly spend % based on revenue is derived from this and the month''s summed spend. NULL = not recorded.';
COMMENT ON COLUMN store_ad_spend.etsy_orders IS
  'Etsy order count for the month. NULL = not recorded.';
COMMENT ON COLUMN store_ad_spend.etsy_ad_clicks IS
  'Etsy Ads clicks for the day. NULL = not recorded.';

-- Negative counts/rates/revenue are possible only by typo, so block them at
-- the database as well as in the form action.
ALTER TABLE store_ad_spend
  DROP CONSTRAINT IF EXISTS store_ad_spend_channel_metrics_check;
ALTER TABLE store_ad_spend
  ADD CONSTRAINT store_ad_spend_channel_metrics_check
  CHECK (
    (clicks IS NULL OR clicks >= 0)
    AND (impressions IS NULL OR impressions >= 0)
    AND (visits IS NULL OR visits >= 0)
    AND (etsy_visits_daily IS NULL OR etsy_visits_daily >= 0)
    AND (etsy_visits_monthly IS NULL OR etsy_visits_monthly >= 0)
    AND (etsy_conversion_rate_monthly IS NULL OR etsy_conversion_rate_monthly >= 0)
    AND (etsy_revenue_usd IS NULL OR etsy_revenue_usd >= 0)
    AND (etsy_orders IS NULL OR etsy_orders >= 0)
    AND (etsy_ad_clicks IS NULL OR etsy_ad_clicks >= 0)
  );

-- The Daily Entry chart and the month-to-date spend % read a store's recent
-- rows by date, which is the same index the existing report already uses.
CREATE INDEX IF NOT EXISTS idx_store_ad_spend_store_date
  ON store_ad_spend(store_id, spend_date);
