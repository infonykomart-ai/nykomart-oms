-- 2026-11-21 (round 2) — Daily Ad Report upgrades.
--
-- 1. store_ad_spend.ad_revenue_usd — the ad platform's OWN daily revenue
--    (Amazon Ads / eBay ad report). Without it the report's REVENUE column
--    could only show Etsy's monthly figure, so Amazon/eBay ROAS and ACoS were
--    always 0. NULL = not recorded (like ad_orders and the channel metrics).
--
-- 2. store_ad_targets — one monthly budget + ROAS target per store, used by
--    the report's budget-pacing and over-budget alerts. A blank pair means
--    "no target for this store".
--
-- 3. employee_store_access.valid_until — temporary Store Access (leave
--    coverage): NULL = permanent, a date = access ends after that day.
--    require-capability.ts filters expired rows on every request.
--
-- 4. employee_store_access_log — who granted/revoked which store access and
--    when. Written best-effort by updateEmployeeStoreAccess.

ALTER TABLE store_ad_spend
  ADD COLUMN IF NOT EXISTS ad_revenue_usd numeric(14, 2);

CREATE TABLE IF NOT EXISTS store_ad_targets (
  store_id uuid PRIMARY KEY REFERENCES stores(id) ON DELETE CASCADE,
  monthly_budget_usd numeric(14, 2),
  roas_target numeric(8, 2),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE employee_store_access
  ADD COLUMN IF NOT EXISTS valid_until date;

CREATE TABLE IF NOT EXISTS employee_store_access_log (
  id bigserial PRIMARY KEY,
  employee_id uuid REFERENCES employees(id) ON DELETE CASCADE,
  store_id uuid REFERENCES stores(id) ON DELETE CASCADE,
  actor_employee_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_store_access_log_employee
  ON employee_store_access_log(employee_id, created_at DESC);

COMMENT ON COLUMN store_ad_spend.ad_revenue_usd IS
  'Ad platform daily revenue (Amazon Ads / eBay) — feeds ROAS and ACoS in the Daily Ad Report.';
COMMENT ON COLUMN employee_store_access.valid_until IS
  'NULL = permanent grant; otherwise the last day the store access is active.';
