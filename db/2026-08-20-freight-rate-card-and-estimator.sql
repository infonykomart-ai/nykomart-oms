-- 2026-08-20 — Gap 5 part 1 of the "5 real gaps" plan (see
-- claude/five-gaps-implementation-plan-2026-08-20.md): a manually-
-- maintained courier rate card + a freight-cost estimator, so staff can
-- estimate/compare shipping cost BEFORE dispatch. No courier API
-- dependency, so this covers Aramex/On Point Express (the couriers
-- actually in active use per the bank-ledger reconciliations) and any
-- other courier equally — unlike ShipGlobal, which has zero rate/quote
-- logic and doesn't support Aramex/On Point Express at all (confirmed by
-- reading src/lib/couriers/shipglobal.ts — SHIPGLOBAL_SERVICES is a
-- hardcoded courier list with no pricing anywhere in that file).
--
-- Two new tables:
--   1. courier_rate_cards — the rate sheet itself, entered/maintained by
--      Finance/MD/Admin (same role grant as exchange_rate_admin). One row
--      per (courier, zone, weight slab) — e.g. Aramex / "USA" / 0-5kg /
--      base 800 + 150/kg + 18% fuel surcharge. zone_label is free text
--      (not a fixed list) since every courier's own rate sheet names zones
--      differently — matched manually by whoever enters an estimate, not
--      auto-derived from destination country (that would need a separate
--      country->zone mapping per courier, a real scope increase not
--      requested here).
--   2. freight_cost_estimates — a saved calculation, optionally linked to
--      an order (order_id nullable — usable as a standalone "what would
--      this cost" check too, not just from within one order), storing the
--      inputs AND the computed breakdown (not just the final total) so a
--      saved estimate stays meaningful even if the rate card row it used
--      is later edited or deleted (rate_card_id is ON DELETE SET NULL, a
--      traceability pointer only — the estimate's own numbers are the
--      source of truth for what was actually shown to the user at the
--      time).
--
-- Both company-scoped (company_id NOT NULL), matching this app's dominant
-- convention (every other transactional/reference table does this) even
-- though a courier's real-world rate sheet isn't inherently company-
-- specific — kept consistent rather than making this one table an
-- exception; re-entering the same rates under each company is the
-- accepted cost of that consistency.
--
-- Deliberately NOT done in this round (see the plan doc's phasing):
-- live ShipGlobal rate-quote integration (part 2 — needs checking whether
-- their API even exposes a quote endpoint), and surfacing AWB/tracking
-- entry earlier in the order flow (folded into Gap 1's multi-package work
-- instead, since dispatch_invoices — where AWB/courier currently lives —
-- is 1-row-per-order and touching its creation flow now would tangle with
-- that upcoming schema-grain change).

BEGIN;

CREATE TABLE courier_rate_cards (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  courier_name            text NOT NULL,
  zone_label              text NOT NULL,
  min_weight_kg           numeric(10,3) NOT NULL DEFAULT 0,
  max_weight_kg           numeric(10,3) NOT NULL,
  base_rate               numeric(14,2) NOT NULL DEFAULT 0,
  rate_per_kg             numeric(14,2) NOT NULL DEFAULT 0,
  fuel_surcharge_pct      numeric(6,3) NOT NULL DEFAULT 0,
  other_charges           numeric(14,2) NOT NULL DEFAULT 0,
  currency                text NOT NULL DEFAULT 'INR',
  remark                  text,
  entered_by_employee_id  uuid REFERENCES employees(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  CHECK (min_weight_kg >= 0),
  CHECK (max_weight_kg > min_weight_kg)
);
CREATE INDEX idx_courier_rate_cards_lookup ON courier_rate_cards(company_id, courier_name, zone_label);

COMMENT ON TABLE courier_rate_cards IS
  'Manually-maintained courier rate sheet (Gap 5 part 1, 2026-08-20) — one row per courier/zone/weight-slab. '
  'Feeds the Freight Cost Estimator (/dashboard/freight-estimate). Not linked to any live courier API.';

CREATE TABLE freight_cost_estimates (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  order_id                uuid REFERENCES orders(id) ON DELETE SET NULL,
  courier_name            text NOT NULL,
  zone_label              text NOT NULL,
  weight_kg               numeric(10,3) NOT NULL CHECK (weight_kg > 0),
  base_rate               numeric(14,2) NOT NULL,
  weight_charge           numeric(14,2) NOT NULL,
  fuel_surcharge_amt      numeric(14,2) NOT NULL,
  other_charges           numeric(14,2) NOT NULL,
  estimated_total         numeric(14,2) NOT NULL,
  currency                text NOT NULL DEFAULT 'INR',
  rate_card_id            uuid REFERENCES courier_rate_cards(id) ON DELETE SET NULL,
  remark                  text,
  created_by_employee_id  uuid REFERENCES employees(id),
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_freight_cost_estimates_company ON freight_cost_estimates(company_id);
CREATE INDEX idx_freight_cost_estimates_order   ON freight_cost_estimates(order_id);

COMMENT ON TABLE freight_cost_estimates IS
  'Saved freight-cost estimates (Gap 5 part 1, 2026-08-20) — stores the full computed breakdown, not just the '
  'total, so a saved estimate stays meaningful even if the courier_rate_cards row it used is later edited/deleted. '
  'order_id is nullable — usable as a standalone quick check, not only from within one order.';

-- Same blanket RLS policy every table in this app gets — see
-- db/2026-08-20-internal-expenses.sql's header note for why this must be
-- in the migration itself (not just schema.sql).
ALTER TABLE courier_rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE courier_rate_cards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated_all ON courier_rate_cards;
CREATE POLICY allow_authenticated_all ON courier_rate_cards
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE freight_cost_estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE freight_cost_estimates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated_all ON freight_cost_estimates;
CREATE POLICY allow_authenticated_all ON freight_cost_estimates
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ===== Capabilities + role grants =====
-- freight_rate_admin (maintain the rate card) — same role set as
-- exchange_rate_admin (Finance, MD, Admin), since this is the same kind of
-- "maintained reference master" work.
-- freight_estimate (use the calculator) — broader: anyone who'd want to
-- check/compare a shipping cost before booking (Order Entry, Logistics,
-- Finance, MD, Admin).

INSERT INTO capabilities (code, description) VALUES
  ('freight_rate_admin', 'Maintain the Courier Rate Card (manual freight rate sheet by courier/zone/weight-slab)'),
  ('freight_estimate',   'Use the Freight Cost Estimator to estimate/compare shipping cost before booking/dispatch')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'freight_rate_admin' FROM roles r WHERE r.name IN ('Finance', 'MD', 'Admin')
ON CONFLICT DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'freight_estimate' FROM roles r WHERE r.name IN ('Order Entry', 'Logistics', 'Finance', 'MD', 'Admin')
ON CONFLICT DO NOTHING;

COMMIT;

-- Verify after running:
-- select tablename, rowsecurity, forcerowsecurity from pg_tables where tablename in ('courier_rate_cards', 'freight_cost_estimates');
-- select policyname, cmd from pg_policies where tablename in ('courier_rate_cards', 'freight_cost_estimates');
-- select code from capabilities where code in ('freight_rate_admin', 'freight_estimate');
-- select r.name, rc.capability_code from role_capabilities rc join roles r on r.id = rc.role_id
-- where rc.capability_code in ('freight_rate_admin', 'freight_estimate') order by 2, 1;
-- Expect freight_rate_admin: Admin, Finance, MD.
-- Expect freight_estimate: Admin, Finance, Logistics, MD, Order Entry.
