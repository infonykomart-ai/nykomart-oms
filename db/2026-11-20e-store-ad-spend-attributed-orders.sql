-- 2026-11-20 — Ad-attributed orders for the Store Ad Spend report.
--
-- The report can only split "orders that came from ads" from "organic orders"
-- if the ad platform's own attributed-order count is captured next to the
-- Budget/Spend that is already typed in per store / day (/Amazon country).
-- Nothing in `orders` records whether an order came from an ad, and inferring
-- it from "this store had spend that day" would mislabel organic orders — so
-- the number stays an explicit, optional ad-platform figure.
--
-- NULL = "not recorded" (the report hides the ad/organic split for that row
-- instead of claiming 0 ad orders). 0 is a real value: spend ran, but no
-- order was attributed to it.
--
-- Safe to run more than once.

ALTER TABLE store_ad_spend
  ADD COLUMN IF NOT EXISTS ad_orders integer;

COMMENT ON COLUMN store_ad_spend.ad_orders IS
  'Orders the ad platform attributed to this spend (Amazon Ads / Etsy Ads / eBay Ads). NULL = not recorded; the report hides the ad/organic split rather than assuming 0.';

ALTER TABLE store_ad_spend
  DROP CONSTRAINT IF EXISTS store_ad_spend_ad_orders_check;

ALTER TABLE store_ad_spend
  ADD CONSTRAINT store_ad_spend_ad_orders_check
  CHECK (ad_orders IS NULL OR ad_orders >= 0);
