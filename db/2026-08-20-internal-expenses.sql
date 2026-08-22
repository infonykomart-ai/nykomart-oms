-- 2026-08-20 — Gap 4 of the "5 real gaps" plan (see project doc
-- claude/five-gaps-implementation-plan-2026-08-20.md): office/cash expenses
-- (rent, electricity, fuel, etc.) that are NOT tied to any purchase order
-- or AWB. Confirmed previously-flagged gap — a comment in
-- db/2026-08-19-payment-ledger-reconciliation-round2.sql already notes
-- "OFFICE EXP." bank-ledger rows are deliberately excluded from
-- bill_pass_register because there was nowhere else for them to go.
--
-- User explicitly confirmed (2026-08-20): this should also feed the P&L
-- Dashboard (crm/page.tsx's "P&L by Company" / "P&L by Month" sections,
-- backed by pl_dashboard_by_company_view / pl_dashboard_by_month_view in
-- SECTION 12 of schema.sql) as a distinct overhead line — NOT merged into
-- sale_profit_ledger.total_expenses_inr, which is a per-order
-- marketplace/shipping expense figure with different meaning. Both views
-- get 2 new trailing columns (total_internal_expenses_inr,
-- net_earn_after_overhead); existing columns are untouched and in the same
-- order, so CREATE OR REPLACE VIEW is safe here (Postgres only forbids
-- removing/reordering existing output columns, not appending new ones).
--
-- pl_dashboard_by_month_view previously only ever showed months present in
-- sale_profit_ledger. This migration also fixes that so a month with
-- office expenses but zero sales still shows up (a real edge case: rent is
-- paid even in a month with no dispatches) — done via a `months` CTE that
-- unions distinct months from both tables, rather than silently continuing
-- to drop expense-only months.
--
-- Category is plain `text` (not a DB enum) — "rent, electricity, fuel,
-- etc." is an open-ended, evolving list; validated against an in-app Set in
-- actions.ts instead, matching how parties.party_type is handled elsewhere
-- in this codebase (cheaper to extend later, no migration needed for a new
-- category).
--
-- Idempotency: this is a first-time CREATE TABLE, expected to run once —
-- matches the convention of the other 2026-08-* first-time-table
-- migrations (no IF NOT EXISTS guard on the CREATE TABLE itself). The RLS
-- policy uses DROP POLICY IF EXISTS + CREATE, safe to re-run. The two
-- CREATE OR REPLACE VIEW statements and the capability/role-grant INSERTs
-- (ON CONFLICT DO NOTHING) are all safe to re-run too.

BEGIN;

-- ===== New table =====

CREATE TABLE internal_expenses (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  expense_date            date NOT NULL,
  category                text NOT NULL,   -- 'Rent' | 'Electricity' | 'Fuel' | ... — validated in actions.ts, not a DB enum, see header note
  amount_inr              numeric(14,2) NOT NULL CHECK (amount_inr > 0),
  payment_mode            text,
  remark                  text,
  created_by_employee_id  uuid REFERENCES employees(id),
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_internal_expenses_company ON internal_expenses(company_id);
CREATE INDEX idx_internal_expenses_date    ON internal_expenses(expense_date);

COMMENT ON TABLE internal_expenses IS
  'Office/cash overhead (rent, electricity, fuel, etc.) not tied to any purchase order or AWB — Gap 4 of the '
  '2026-08-20 five-gaps plan. Feeds pl_dashboard_by_company_view / pl_dashboard_by_month_view as a distinct '
  '"Internal Expenses" overhead line, kept separate from sale_profit_ledger.total_expenses_inr (per-order '
  'marketplace/shipping expense) rather than merged into it.';

-- Same blanket RLS policy every table in this app gets (see
-- db/2026-08-08-enable-rls.sql / db/2026-08-17-rls-policy-audit-fix.sql —
-- a table missing this silently breaks anon-key/RLS-bound reads while
-- service-role writes keep working, exactly the bug fixed for chalan
-- tables on 2026-08-17). Company/capability scoping itself is enforced in
-- application code (requireCapability + .eq/.in("company_id", ...)), not
-- via a per-company RLS policy.
ALTER TABLE internal_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE internal_expenses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated_all ON internal_expenses;
CREATE POLICY allow_authenticated_all ON internal_expenses
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ===== Capability + role grant (Finance, Admin — same set bill_payment gets) =====

INSERT INTO capabilities (code, description) VALUES
  ('internal_expense_entry', 'Log office/cash expenses (rent, electricity, fuel, etc.) not tied to any purchase order or AWB')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'internal_expense_entry' FROM roles r WHERE r.name IN ('Finance', 'Admin')
ON CONFLICT DO NOTHING;

-- ===== P&L Dashboard views — add Internal Expenses as a distinct overhead line =====

CREATE OR REPLACE VIEW pl_dashboard_by_company_view AS
SELECT
  c.id AS company_id, c.name AS company_name,
  SUM(l.total_value_inr)       AS total_sale_value_inr,
  SUM(l.total_expenses_inr)    AS total_expenses_inr,
  SUM(l.net_total_value)       AS net_total_value,
  SUM(l.portal_expenses_25pct) AS portal_expenses_25pct,
  SUM(l.net_earn)              AS net_earn,
  (SUM(l.net_earn) / NULLIF(SUM(l.total_value_inr), 0)) AS profit_pct,
  COALESCE(ie.total_internal_expenses_inr, 0)             AS total_internal_expenses_inr,
  SUM(l.net_earn) - COALESCE(ie.total_internal_expenses_inr, 0) AS net_earn_after_overhead
FROM companies c
LEFT JOIN sale_profit_ledger l ON l.company_id = c.id
LEFT JOIN (
  SELECT company_id, SUM(amount_inr) AS total_internal_expenses_inr
  FROM internal_expenses GROUP BY company_id
) ie ON ie.company_id = c.id
GROUP BY c.id, c.name, ie.total_internal_expenses_inr;

CREATE OR REPLACE VIEW pl_dashboard_by_month_view AS
WITH months AS (
  SELECT DISTINCT date_trunc('month', invoice_date)::date AS month FROM sale_profit_ledger WHERE invoice_date IS NOT NULL
  UNION
  SELECT DISTINCT date_trunc('month', expense_date)::date AS month FROM internal_expenses
),
ledger_agg AS (
  SELECT date_trunc('month', invoice_date)::date AS month,
    SUM(total_value_inr)    AS total_sale_value_inr,
    SUM(total_expenses_inr) AS total_expenses_inr,
    SUM(net_earn)           AS net_earn
  FROM sale_profit_ledger
  WHERE invoice_date IS NOT NULL
  GROUP BY date_trunc('month', invoice_date)
),
expense_agg AS (
  SELECT date_trunc('month', expense_date)::date AS month, SUM(amount_inr) AS total_internal_expenses_inr
  FROM internal_expenses
  GROUP BY date_trunc('month', expense_date)
)
SELECT
  m.month,
  COALESCE(la.total_sale_value_inr, 0)    AS total_sale_value_inr,
  COALESCE(la.total_expenses_inr, 0)      AS total_expenses_inr,
  COALESCE(la.net_earn, 0)                AS net_earn,
  (COALESCE(la.net_earn, 0) / NULLIF(la.total_sale_value_inr, 0)) AS profit_pct,
  COALESCE(ea.total_internal_expenses_inr, 0) AS total_internal_expenses_inr,
  COALESCE(la.net_earn, 0) - COALESCE(ea.total_internal_expenses_inr, 0) AS net_earn_after_overhead
FROM months m
LEFT JOIN ledger_agg la ON la.month = m.month
LEFT JOIN expense_agg ea ON ea.month = m.month
ORDER BY m.month DESC;

COMMIT;

-- Verify after running:
-- 1) Table + RLS exist:
-- select tablename, rowsecurity, forcerowsecurity from pg_tables where tablename = 'internal_expenses';
-- select policyname, cmd from pg_policies where tablename = 'internal_expenses';
-- 2) Capability granted:
-- select r.name, rc.capability_code from role_capabilities rc join roles r on r.id = rc.role_id
-- where rc.capability_code = 'internal_expense_entry';
-- Expect: Finance, Admin.
-- 3) Views still return their original columns plus the 2 new ones, with
-- zero rows initially (table is empty right after this migration):
-- select * from pl_dashboard_by_company_view limit 5;
-- select * from pl_dashboard_by_month_view limit 5;
-- Expect: total_internal_expenses_inr = 0 and net_earn_after_overhead = net_earn for every row, until real
-- expenses are entered through the new /dashboard/expenses page.
