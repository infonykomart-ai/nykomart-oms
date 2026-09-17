-- 2026-09-17 — FY date validation backstop ("data validation or pura
-- system FY par depend hoyega").
--
-- CONTEXT: the P&L-by-Month table showed a "20026-09-01" month — one typo'd
-- year in a human entry fed date_trunc('month') in
-- pl_dashboard_by_month_view and became its own bogus month (September
-- appearing twice). The app now validates every entry date through
-- src/lib/fy-date.ts (FY-anchored window, mirrors fy_label() in
-- db/schema.sql — April = FY start, window = current FY minus 10 years to
-- current FY plus 1). This file is the DATABASE half of the same rule:
--
--   1) A sanity CHECK on the four P&L-feeding date columns, added NOT VALID
--      — Postgres enforces CHECK ... NOT VALID on all NEW/UPDATED rows
--      immediately while leaving existing rows alone, so this can never
--      fail to apply because of the already-bad row, yet no new 5-digit-year
--      typo can ever be inserted again from any path (app, cron, CSV import,
--      manual SQL).
--
--   2) The diagnostic query to FIND the existing bad rows (same one given
--      in chat — kept here so it lives with the migration), and the UPDATE
--      template to fix each one once identified.
--
-- Safe to re-run (IF NOT EXISTS via pg_constraint probe).

-- ---------------------------------------------------------------------------
-- 1) NOT VALID sanity checks — new 4-digit-year-guaranteed writes only.
--    Range chosen wide (1990..2099) on purpose: the FY-window nuance lives
--    in the app validator; the DB's job is only to make an impossible year
--    (20026, 22026, 0027, ...) physically unstorable.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'orders_order_date_sane_chk' AND conrelid = 'orders'::regclass
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_order_date_sane_chk
      CHECK (order_date BETWEEN DATE '1990-01-01' AND DATE '2099-12-31') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'purchase_bills_vendor_invoice_date_sane_chk'
      AND conrelid = 'purchase_bills'::regclass
  ) THEN
    ALTER TABLE purchase_bills ADD CONSTRAINT purchase_bills_vendor_invoice_date_sane_chk
      CHECK (vendor_invoice_date BETWEEN DATE '1990-01-01' AND DATE '2099-12-31') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sale_profit_ledger_invoice_date_sane_chk'
      AND conrelid = 'sale_profit_ledger'::regclass
  ) THEN
    ALTER TABLE sale_profit_ledger ADD CONSTRAINT sale_profit_ledger_invoice_date_sane_chk
      CHECK (invoice_date BETWEEN DATE '1990-01-01' AND DATE '2099-12-31') NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'internal_expenses_expense_date_sane_chk'
      AND conrelid = 'internal_expenses'::regclass
  ) THEN
    ALTER TABLE internal_expenses ADD CONSTRAINT internal_expenses_expense_date_sane_chk
      CHECK (expense_date BETWEEN DATE '1990-01-01' AND DATE '2099-12-31') NOT VALID;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2) Find the EXISTING bad rows (run after the DO block above — the checks
--    are NOT VALID, so existing bad rows don't block them):
-- ---------------------------------------------------------------------------
-- SELECT 'orders' AS src, id::text, order_date::date AS bad_date
--   FROM orders WHERE order_date NOT BETWEEN DATE '1990-01-01' AND DATE '2099-12-31'
-- UNION ALL
-- SELECT 'purchase_bills', id::text, vendor_invoice_date::date
--   FROM purchase_bills WHERE vendor_invoice_date NOT BETWEEN DATE '1990-01-01' AND DATE '2099-12-31'
-- UNION ALL
-- SELECT 'sale_profit_ledger', id::text, invoice_date::date
--   FROM sale_profit_ledger WHERE invoice_date NOT BETWEEN DATE '1990-01-01' AND DATE '2099-12-31'
-- UNION ALL
-- SELECT 'internal_expenses', id::text, expense_date::date
--   FROM internal_expenses WHERE expense_date NOT BETWEEN DATE '1990-01-01' AND DATE '2099-12-31';

-- 3) Fix each row the diagnostic finds (set the REAL date; the 20026-09-01
--    row seen on the dashboard was meant to be 2026-09-01):
-- UPDATE orders            SET order_date         = '2026-09-01' WHERE id = '<id from step 2>';
-- UPDATE purchase_bills    SET vendor_invoice_date = '2026-09-01' WHERE id = '<id>';
-- UPDATE sale_profit_ledger SET invoice_date      = '2026-09-01' WHERE id = '<id>';
-- UPDATE internal_expenses SET expense_date       = '2026-09-01' WHERE id = '<id>';

-- 4) Optional, once step 2 returns zero rows — promote the checks to full
--    validation so even legacy rows are guaranteed:
-- ALTER TABLE orders            VALIDATE CONSTRAINT orders_order_date_sane_chk;
-- ALTER TABLE purchase_bills    VALIDATE CONSTRAINT purchase_bills_vendor_invoice_date_sane_chk;
-- ALTER TABLE sale_profit_ledger VALIDATE CONSTRAINT sale_profit_ledger_invoice_date_sane_chk;
-- ALTER TABLE internal_expenses VALIDATE CONSTRAINT internal_expenses_expense_date_sane_chk;
