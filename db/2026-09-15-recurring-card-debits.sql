-- 2026-09-15 — "kuch payment auto debit hote hai credit card se — erank,
-- etsy bill, ebay & other"
--
-- Recurring card auto-debits: fixed vendor subscriptions that hit the
-- company credit card every month without anyone typing anything —
-- eRank, Etsy bill, eBay store, etc. Two pieces:
--
-- 1. recurring_card_debits — the REGISTRY (what renews, how much, which
--    card, which day of the month, active/paused). NOT the expense
--    itself.
-- 2. The actual expense rows still land in internal_expenses (so the P&L
--    views pl_dashboard_by_company_view / pl_dashboard_by_month_view
--    keep folding them in with zero changes). The app's "Log due" action
--    stamps them with recurring_debit_id so each month's auto-debit is
--    generated exactly once.
--
-- day_of_month: 1-31; months without that day (e.g. 31 in April) debit on
-- the month's last day (app-side clamp).
--
-- last_logged_month (YYYY-MM): idempotency cursor — the generate action
-- won't create a second internal_expenses row for the same registry row +
-- month. NULL = never logged.
--
-- amount CAN change month to month (Etsy bill varies with sales) — the
-- amount here is the EXPECTED one for the due-soon list; when logging,
-- the user can override per month. expected_amount IS NULL = "variable —
-- ask me each month".

CREATE TABLE IF NOT EXISTS recurring_card_debits (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  vendor_name       text NOT NULL,
  category          text NOT NULL DEFAULT 'Bank/Card Charges',
  amount            numeric(14,2) CHECK (amount IS NULL OR amount > 0),
  card_label        text,
  day_of_month      int NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  active            boolean NOT NULL DEFAULT true,
  last_logged_month text,
  remark            text,
  created_by_employee_id uuid REFERENCES employees(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, lower(vendor_name))
);

CREATE INDEX IF NOT EXISTS idx_recurring_card_debits_company ON recurring_card_debits(company_id) WHERE active;

-- Every generated auto-debit is traceable back to its registry row, and
-- one registry row can't be logged twice for the same month (the app also
-- guards via last_logged_month; this is the belt over the braces — a
-- manual insert with the same (recurring_debit_id, month) fails loudly).
ALTER TABLE internal_expenses
  ADD COLUMN IF NOT EXISTS recurring_debit_id uuid REFERENCES recurring_card_debits(id) ON DELETE SET NULL;
ALTER TABLE internal_expenses
  ADD COLUMN IF NOT EXISTS recurring_month text;
CREATE INDEX IF NOT EXISTS idx_internal_expenses_recurring ON internal_expenses(recurring_debit_id) WHERE recurring_debit_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_internal_expenses_recurring_month
  ON internal_expenses(recurring_debit_id, recurring_month)
  WHERE recurring_debit_id IS NOT NULL AND recurring_month IS NOT NULL;
