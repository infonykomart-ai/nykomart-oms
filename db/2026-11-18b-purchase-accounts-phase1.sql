-- 2026-11-18b — PURCHASE & ACCOUNTS (PHASE 1: OFFICE / CASH EXPENSES)
-- + the setup prerequisites Phase 2 needs before purchase bills are posted to
-- this ledger (financial years, cash/bank accounts, opening balances).
--
-- Request: "PURCHASE, ACCOUNTS & EXPENSE MANAGEMENT ERP" master prompt —
-- full accounting, admin approval, one common entry, all units, UPI mapped to
-- its real bank account. Phase 1 is office/cash expenses; this file is the
-- database half of it.
--
-- WHY NEW TABLES INSTEAD OF MORE COLUMNS ON internal_expenses
-- `internal_expenses` is a P&L overhead feed (one flat row per expense line,
-- no ledger, no approval state, no GST breakup, no journal). It stays exactly
-- as it is — every existing report that reads it keeps working. The accounting
-- module keeps its own voucher + double-entry tables so a posted voucher can
-- never be affected by a P&L-side edit.
--
-- REUSED, NOT DUPLICATED
--   • companies / employees / parties / departments / roles — all existing.
--   • sequence_counters + reserve_next_number() + format_document_no() +
--     fy_label() — the same FY-resetting numbering every document uses.
--   • bank_recon_accounts — a fin_accounts row may LINK to one, so a UPI /
--     bank payment in the Cash Book and the bank reconciliation screen refer
--     to the same real account instead of two parallel lists.
--   • audit_log (via logAudit) for the coarse log; expense_voucher_events adds
--     the workflow trail (old status → new status, actor, reason).
--
-- ACCOUNTING RULES ENCODED HERE (not hardcoded in the UI)
--   • A voucher can only be posted from `approved` and only ONCE — the
--     post function checks both inside the same transaction.
--   • Debits must equal credits exactly (paise) or the post fails.
--   • A posted voucher's journal is immutable; corrections are reversal
--     entries (fin_reverse_expense_voucher), never an in-place edit.
--   • UPI is a payment MODE; the money always leaves a real bank account
--     (payment_account_id must be a bank account — enforced in the app's
--     validator, and re-checked by the post function's account-company guard).
--
-- Idempotent: every statement uses IF NOT EXISTS / CREATE OR REPLACE, seeds
-- use ON CONFLICT DO NOTHING. Safe to run twice.
--
-- MUST run BEFORE the new /dashboard/accounts screens are used. The screens
-- detect the missing tables and show "run this SQL" instead of failing.

-- ============================================================================
-- 1. FINANCIAL YEARS  (Phase 2 setup prerequisite)
-- ============================================================================
-- One row per company per FY. `is_current` decides which FY a new voucher
-- picks when its date falls outside every configured year; `is_locked` is the
-- hard stop on back-dating into a closed year (enforced by the post function).
CREATE TABLE IF NOT EXISTS fin_financial_years (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label       text NOT NULL,                 -- '2026-27'
  start_date  date NOT NULL,                 -- Indian FY: 1 April
  end_date    date NOT NULL,                 -- 31 March
  is_current  boolean NOT NULL DEFAULT false,
  is_locked   boolean NOT NULL DEFAULT false,
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fin_financial_years_range CHECK (end_date > start_date),
  CONSTRAINT fin_financial_years_unique UNIQUE (company_id, label)
);
CREATE INDEX IF NOT EXISTS idx_fin_financial_years_company ON fin_financial_years(company_id, start_date DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_financial_years_current
  ON fin_financial_years(company_id) WHERE is_current;

-- ============================================================================
-- 2. CHART OF ACCOUNTS + PAYMENT ACCOUNTS
-- ============================================================================
-- ONE table for the whole chart. Cash / bank / petty-cash / credit-card
-- accounts are the same rows flagged with a boolean instead of a second table,
-- because every ledger report, the Cash Book and the Bank Book all need to
-- read the same list. A bank/card row may point at the existing
-- bank_recon_accounts record so the two modules can never name the same
-- account differently.
CREATE TABLE IF NOT EXISTS fin_accounts (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id             uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  code                   text NOT NULL,
  name                   text NOT NULL,
  account_type           text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'income', 'expense')),
  account_group          text,
  is_cash                boolean NOT NULL DEFAULT false,
  is_bank                boolean NOT NULL DEFAULT false,
  is_petty_cash          boolean NOT NULL DEFAULT false,
  is_credit_card         boolean NOT NULL DEFAULT false,
  bank_recon_account_id  uuid REFERENCES bank_recon_accounts(id) ON DELETE SET NULL,
  upi_handle             text,
  active                 boolean NOT NULL DEFAULT true,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz,
  CONSTRAINT fin_accounts_unique_code UNIQUE (company_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_accounts_name ON fin_accounts(company_id, lower(name));
CREATE INDEX IF NOT EXISTS idx_fin_accounts_company ON fin_accounts(company_id) WHERE active;
CREATE INDEX IF NOT EXISTS idx_fin_accounts_payment
  ON fin_accounts(company_id) WHERE active AND (is_cash OR is_bank OR is_petty_cash OR is_credit_card);

-- ============================================================================
-- 3. OPENING BALANCES  (Phase 2 setup prerequisite)
-- ============================================================================
-- Before the accounting module goes live, every real cash/bank account and
-- every opening payable/receivable needs its balance carried in, otherwise the
-- Cash Book and the Trial Balance start at zero and the first real payment
-- looks like an unexplained negative. Stored per account per FY (never as a
-- journal entry until posted, so setup can be corrected freely), then posted
-- ONCE with fin_post_opening_balances().
CREATE TABLE IF NOT EXISTS fin_opening_balances (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  financial_year_id       uuid NOT NULL REFERENCES fin_financial_years(id) ON DELETE CASCADE,
  account_id              uuid NOT NULL REFERENCES fin_accounts(id) ON DELETE CASCADE,
  debit                   numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit                  numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  narration               text,
  created_by_employee_id  uuid REFERENCES employees(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz,
  CONSTRAINT fin_opening_balances_one_side CHECK (NOT (debit > 0 AND credit > 0)),
  CONSTRAINT fin_opening_balances_unique UNIQUE (financial_year_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_fin_opening_balances_fy ON fin_opening_balances(financial_year_id);

-- ============================================================================
-- 4. EXPENSE CATEGORIES / SUBCATEGORIES
-- ============================================================================
-- company_id NULL = shared seed row available to every company (the master
-- prompt's list); a company row with the same name wins for that company.
-- parent_id gives the subcategory tree. ledger_account_id is what the posting
-- uses for that category's debit; NULL falls back to the default "Office &
-- Administrative Expenses" account, so a brand-new category never blocks a
-- voucher.
CREATE TABLE IF NOT EXISTS expense_categories (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid REFERENCES companies(id) ON DELETE CASCADE,
  name               text NOT NULL,
  group_name         text NOT NULL DEFAULT 'Other',
  parent_id          uuid REFERENCES expense_categories(id) ON DELETE RESTRICT,
  ledger_account_id  uuid REFERENCES fin_accounts(id) ON DELETE SET NULL,
  default_gst_rate   numeric(5,2) NOT NULL DEFAULT 0 CHECK (default_gst_rate >= 0 AND default_gst_rate <= 28),
  gst_applicable     boolean NOT NULL DEFAULT true,
  itc_eligible       boolean NOT NULL DEFAULT true,
  sort_order         integer NOT NULL DEFAULT 100,
  active             boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_categories_name
  ON expense_categories (
    COALESCE(company_id, '00000000-0000-0000-0000-000000000000'::uuid),
    lower(name),
    COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );
CREATE INDEX IF NOT EXISTS idx_expense_categories_company ON expense_categories(company_id);
CREATE INDEX IF NOT EXISTS idx_expense_categories_parent ON expense_categories(parent_id);

-- ============================================================================
-- 5. EXPENSE VOUCHERS  (header)
-- ============================================================================
-- One voucher = one entry, whatever it pays for. Expense TYPE (accounting
-- nature) and PAYMENT MODE (how the money left) are deliberately separate
-- columns — "Office Expense paid by UPI from PNB" is one voucher, not two.
CREATE TABLE IF NOT EXISTS expense_vouchers (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL REFERENCES companies(id),
  voucher_no                text UNIQUE,           -- trigger below
  voucher_date              date NOT NULL DEFAULT CURRENT_DATE,
  expense_type              text NOT NULL DEFAULT 'Office Expense'
                              CHECK (expense_type IN ('Office Expense', 'Cash Expense', 'Petty Cash Expense',
                                                      'Employee Reimbursement', 'Advance Settlement',
                                                      'Recurring Expense', 'Emergency Expense')),
  financial_year_id         uuid REFERENCES fin_financial_years(id) ON DELETE SET NULL,
  department_id             uuid REFERENCES departments(id) ON DELETE SET NULL,
  branch                    text,
  cost_centre               text,
  paid_to                   text,
  party_id                  uuid REFERENCES parties(id) ON DELETE SET NULL,
  employee_id               uuid REFERENCES employees(id) ON DELETE SET NULL,
  invoice_no                text,
  invoice_date              date,
  gstin                     text,
  vendor_state              text,
  place_of_supply           text,
  is_interstate             boolean NOT NULL DEFAULT false,
  description               text,
  remarks                   text,
  -- Payment: mode is HOW, account is WHERE THE MONEY CAME FROM. For UPI this
  -- is the real bank account — the app refuses to save a UPI voucher without
  -- one, so a UPI payment can never invent a second cash transaction.
  payment_mode              text NOT NULL DEFAULT 'Cash'
                              CHECK (payment_mode IN ('Cash', 'Bank Transfer', 'UPI', 'NEFT', 'RTGS', 'IMPS',
                                                      'Cheque', 'Credit Card', 'Other')),
  payment_account_id        uuid REFERENCES fin_accounts(id) ON DELETE RESTRICT,
  payment_reference         text,
  upi_reference             text,
  payment_status            text NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'pending', 'paid')),
  attachment_url            text,
  -- Money, all numeric(14,2). Computed in the app from the lines in PAISE
  -- (integer arithmetic — see src/lib/accounts/money.ts) and stored here so
  -- reports never have to re-derive a total.
  gross_total               numeric(14,2) NOT NULL DEFAULT 0,
  discount_total            numeric(14,2) NOT NULL DEFAULT 0,
  taxable_total             numeric(14,2) NOT NULL DEFAULT 0,
  cgst_total                numeric(14,2) NOT NULL DEFAULT 0,
  sgst_total                numeric(14,2) NOT NULL DEFAULT 0,
  igst_total                numeric(14,2) NOT NULL DEFAULT 0,
  cess_total                numeric(14,2) NOT NULL DEFAULT 0,
  charges_total             numeric(14,2) NOT NULL DEFAULT 0,
  non_gst_total             numeric(14,2) NOT NULL DEFAULT 0,
  itc_total                 numeric(14,2) NOT NULL DEFAULT 0,
  round_off                 numeric(8,2) NOT NULL DEFAULT 0
                              CHECK (round_off >= -1000 AND round_off <= 1000),
  grand_total               numeric(14,2) NOT NULL DEFAULT 0,
  -- Draft -> Submitted -> Admin Review (approved/rejected) -> Posted -> Paid.
  status                    text NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'posted', 'paid', 'cancelled')),
  submitted_at              timestamptz,
  submitted_by_employee_id  uuid REFERENCES employees(id),
  approved_at               timestamptz,
  approved_by_employee_id   uuid REFERENCES employees(id),
  rejection_reason          text,
  posted_at                 timestamptz,
  posted_by_employee_id     uuid REFERENCES employees(id),
  paid_at                   timestamptz,
  reversal_of               uuid REFERENCES expense_vouchers(id) ON DELETE SET NULL,
  created_by_employee_id    uuid NOT NULL REFERENCES employees(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz
);
CREATE INDEX IF NOT EXISTS idx_expense_vouchers_company_date ON expense_vouchers(company_id, voucher_date DESC);
CREATE INDEX IF NOT EXISTS idx_expense_vouchers_status ON expense_vouchers(company_id, status);
CREATE INDEX IF NOT EXISTS idx_expense_vouchers_payment_account ON expense_vouchers(payment_account_id);
CREATE INDEX IF NOT EXISTS idx_expense_vouchers_party ON expense_vouchers(party_id) WHERE party_id IS NOT NULL;
-- Duplicate-bill guard (Test 9 in the master prompt): the same vendor invoice
-- can never be entered twice for the same company + vendor. Partial, because
-- most cash expenses have no invoice number at all.
CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_vouchers_vendor_invoice
  ON expense_vouchers(company_id, party_id, lower(invoice_no))
  WHERE party_id IS NOT NULL AND invoice_no IS NOT NULL AND invoice_no <> '';
CREATE INDEX IF NOT EXISTS idx_expense_vouchers_fy ON expense_vouchers(financial_year_id);

-- ============================================================================
-- 6. EXPENSE VOUCHER LINES
-- ============================================================================
CREATE TABLE IF NOT EXISTS expense_voucher_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id         uuid NOT NULL REFERENCES expense_vouchers(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL REFERENCES companies(id),
  line_no            integer NOT NULL DEFAULT 1,
  description        text NOT NULL,
  category_id        uuid REFERENCES expense_categories(id) ON DELETE SET NULL,
  qty                numeric(14,3),
  unit               text,
  rate               numeric(14,4),
  gross_amount       numeric(14,2) NOT NULL DEFAULT 0,
  discount           numeric(14,2) NOT NULL DEFAULT 0,
  taxable_value      numeric(14,2) NOT NULL DEFAULT 0,
  gst_rate           numeric(5,2) NOT NULL DEFAULT 0,
  cgst               numeric(14,2) NOT NULL DEFAULT 0,
  sgst               numeric(14,2) NOT NULL DEFAULT 0,
  igst               numeric(14,2) NOT NULL DEFAULT 0,
  cess               numeric(14,2) NOT NULL DEFAULT 0,
  gst_inclusive      boolean NOT NULL DEFAULT false,
  is_gst_applicable  boolean NOT NULL DEFAULT true,
  non_gst_amount     numeric(14,2) NOT NULL DEFAULT 0,
  total_amount       numeric(14,2) NOT NULL DEFAULT 0,
  ledger_account_id  uuid REFERENCES fin_accounts(id) ON DELETE SET NULL,
  itc_eligible       boolean NOT NULL DEFAULT true,
  cost_centre        text,
  remarks            text,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expense_voucher_items_voucher ON expense_voucher_items(voucher_id);

-- Additional charges (freight, loading, kanta, labour, packing, insurance…).
-- Each keeps its OWN GST so a taxable charge can never be taxed twice by
-- being folded into the item taxable value as well.
CREATE TABLE IF NOT EXISTS expense_voucher_charges (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id         uuid NOT NULL REFERENCES expense_vouchers(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL REFERENCES companies(id),
  charge_name        text NOT NULL,
  amount             numeric(14,2) NOT NULL DEFAULT 0,
  gst_rate           numeric(5,2) NOT NULL DEFAULT 0,
  cgst               numeric(14,2) NOT NULL DEFAULT 0,
  sgst               numeric(14,2) NOT NULL DEFAULT 0,
  igst               numeric(14,2) NOT NULL DEFAULT 0,
  is_taxable         boolean NOT NULL DEFAULT false,
  itc_eligible       boolean NOT NULL DEFAULT true,
  ledger_account_id  uuid REFERENCES fin_accounts(id) ON DELETE SET NULL,
  allocation_method  text NOT NULL DEFAULT 'value'
                       CHECK (allocation_method IN ('equal', 'quantity', 'weight', 'value', 'manual')),
  total_amount       numeric(14,2) NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expense_voucher_charges_voucher ON expense_voucher_charges(voucher_id);

-- ============================================================================
-- 7. DOUBLE-ENTRY JOURNAL
-- ============================================================================
-- Every posted accounting effect lives here. `source_type` says what created
-- the pair so the General Ledger can always explain itself; `voucher_id` links
-- back to the expense voucher for drill-down. Rows are written ONLY by the
-- post/reverse functions below (one transaction each).
CREATE TABLE IF NOT EXISTS fin_journal_entries (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  financial_year_id       uuid REFERENCES fin_financial_years(id) ON DELETE SET NULL,
  entry_date              date NOT NULL,
  source_type             text NOT NULL CHECK (source_type IN ('expense_voucher', 'opening_balance',
                                                              'petty_cash', 'reimbursement', 'reversal', 'manual', 'depreciation')),
  source_id               uuid,
  voucher_id              uuid REFERENCES expense_vouchers(id) ON DELETE CASCADE,
  account_id              uuid NOT NULL REFERENCES fin_accounts(id),
  debit                   numeric(14,2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit                  numeric(14,2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  narration               text,
  posted_at               timestamptz NOT NULL DEFAULT now(),
  created_by_employee_id  uuid REFERENCES employees(id),
  reversal_of_entry_id    uuid,
  CONSTRAINT fin_journal_one_side CHECK (NOT (debit > 0 AND credit > 0))
);
CREATE INDEX IF NOT EXISTS idx_fin_journal_company_date ON fin_journal_entries(company_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_fin_journal_account ON fin_journal_entries(account_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_fin_journal_voucher ON fin_journal_entries(voucher_id);
CREATE INDEX IF NOT EXISTS idx_fin_journal_source ON fin_journal_entries(source_type, source_id);
-- Opening balances can be posted exactly once per company per FY.
CREATE UNIQUE INDEX IF NOT EXISTS uq_fin_journal_opening
  ON fin_journal_entries(company_id, financial_year_id, account_id, entry_date)
  WHERE source_type = 'opening_balance';

-- ============================================================================
-- 8. PETTY CASH
-- ============================================================================
CREATE TABLE IF NOT EXISTS petty_cash_accounts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name                    text NOT NULL,
  custodian_employee_id   uuid REFERENCES employees(id) ON DELETE SET NULL,
  ledger_account_id       uuid NOT NULL REFERENCES fin_accounts(id),
  opening_balance         numeric(14,2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
  float_limit             numeric(14,2),
  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_petty_cash_accounts_name ON petty_cash_accounts(company_id, lower(name));

-- Closing balance = opening + allocations + replenishments − expenses − returns.
-- Stored as signed rows (never a mutated balance column) so the arithmetic can
-- be re-derived and audited at any time; src/lib/accounts/petty-cash.ts owns
-- the formula.
CREATE TABLE IF NOT EXISTS petty_cash_transactions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  petty_cash_account_id   uuid NOT NULL REFERENCES petty_cash_accounts(id) ON DELETE CASCADE,
  txn_date                date NOT NULL DEFAULT CURRENT_DATE,
  txn_type                text NOT NULL CHECK (txn_type IN ('allocation', 'replenishment', 'expense', 'return', 'verification')),
  amount                  numeric(14,2) NOT NULL CHECK (amount > 0),
  voucher_id              uuid REFERENCES expense_vouchers(id) ON DELETE SET NULL,
  narration               text,
  created_by_employee_id  uuid REFERENCES employees(id),
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_petty_cash_txn_account ON petty_cash_transactions(petty_cash_account_id, txn_date DESC);

-- ============================================================================
-- 9. EMPLOYEE REIMBURSEMENT CLAIMS
-- ============================================================================
-- Claim -> review -> payable -> payment. `claim_fingerprint` is the
-- duplicate-claim guard: same employee + same date + same amount + same
-- description can only be submitted once.
CREATE TABLE IF NOT EXISTS employee_expense_claims (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  employee_id             uuid NOT NULL REFERENCES employees(id),
  claim_date              date NOT NULL DEFAULT CURRENT_DATE,
  category_id             uuid REFERENCES expense_categories(id) ON DELETE SET NULL,
  description             text NOT NULL,
  amount                  numeric(14,2) NOT NULL CHECK (amount > 0),
  receipt_url             text,
  status                  text NOT NULL DEFAULT 'submitted'
                            CHECK (status IN ('submitted', 'approved', 'rejected', 'paid')),
  reviewer_employee_id    uuid REFERENCES employees(id),
  reviewed_at             timestamptz,
  rejection_reason        text,
  approved_amount         numeric(14,2),
  voucher_id              uuid REFERENCES expense_vouchers(id) ON DELETE SET NULL,
  claim_fingerprint       text,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employee_expense_claims_company ON employee_expense_claims(company_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_employee_expense_claims_fingerprint
  ON employee_expense_claims(company_id, employee_id, claim_fingerprint)
  WHERE claim_fingerprint IS NOT NULL;

-- ============================================================================
-- 10. APPROVAL LIMITS + WORKFLOW TRAIL
-- ============================================================================
-- Configurable per role: up to what amount a role may approve, and whether it
-- may approve its own entry. The app checks this AND the "no self-approval"
-- rule; the post function independently re-checks the status.
CREATE TABLE IF NOT EXISTS fin_approval_limits (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role_id            uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  max_amount         numeric(14,2) NOT NULL DEFAULT 0 CHECK (max_amount >= 0),
  can_self_approve   boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fin_approval_limits_unique UNIQUE (company_id, role_id)
);

CREATE TABLE IF NOT EXISTS expense_voucher_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id         uuid NOT NULL REFERENCES expense_vouchers(id) ON DELETE CASCADE,
  company_id         uuid NOT NULL REFERENCES companies(id),
  action             text NOT NULL,
  from_status        text,
  to_status          text,
  actor_employee_id  uuid REFERENCES employees(id),
  actor_name         text,
  reason             text,
  changes            jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_expense_voucher_events_voucher ON expense_voucher_events(voucher_id, created_at DESC);

-- ============================================================================
-- 11. VOUCHER NUMBERING + FINANCIAL-YEAR STAMP
-- ============================================================================
-- Same numbering machinery as every other document: NM/EV/26-27/0001.
CREATE OR REPLACE FUNCTION trg_expense_vouchers_doc_no() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_code text;
  v_num  integer;
  v_fy   uuid;
BEGIN
  SELECT short_code INTO v_code FROM companies WHERE id = NEW.company_id;
  v_num := reserve_next_number(NEW.company_id, 'EXP_VOUCHER', true, NEW.voucher_date);
  NEW.voucher_no := format_document_no(v_code, 'EV', fy_label(NEW.voucher_date), v_num);
  IF NEW.financial_year_id IS NULL THEN
    SELECT id INTO v_fy FROM fin_financial_years
     WHERE company_id = NEW.company_id
       AND NEW.voucher_date BETWEEN start_date AND end_date
     ORDER BY start_date DESC LIMIT 1;
    NEW.financial_year_id := v_fy;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS expense_vouchers_before_insert ON expense_vouchers;
CREATE TRIGGER expense_vouchers_before_insert BEFORE INSERT ON expense_vouchers
  FOR EACH ROW WHEN (NEW.voucher_no IS NULL) EXECUTE FUNCTION trg_expense_vouchers_doc_no();

-- ============================================================================
-- 12. DEFAULT CHART OF ACCOUNTS
-- ============================================================================
-- Every posting needs a real account row. These defaults make Phase 1 work on
-- day one (Office Expenses, GST input, cash/bank, vendor payable) without
-- anybody hand-building a chart first. Adding real bank accounts is the setup
-- screen's job — this only guarantees the non-payment side exists.
CREATE OR REPLACE FUNCTION fin_seed_default_accounts(p_company_id uuid) RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE v_count integer := 0;
BEGIN
  INSERT INTO fin_accounts (company_id, code, name, account_type, account_group, is_cash, is_bank, is_petty_cash)
  VALUES
    (p_company_id, '1010', 'Main Cash',                        'asset',     'Cash & Bank',           true,  false, false),
    (p_company_id, '1020', 'Petty Cash',                       'asset',     'Cash & Bank',           false, false, true),
    (p_company_id, '1301', 'Input CGST',                       'asset',     'Duties & Taxes',        false, false, false),
    (p_company_id, '1302', 'Input SGST',                       'asset',     'Duties & Taxes',        false, false, false),
    (p_company_id, '1303', 'Input IGST',                       'asset',     'Duties & Taxes',        false, false, false),
    (p_company_id, '1304', 'Input Cess',                       'asset',     'Duties & Taxes',        false, false, false),
    (p_company_id, '2100', 'Sundry Creditors - Office Expenses', 'liability', 'Current Liabilities',  false, false, false),
    (p_company_id, '2110', 'Employee Reimbursement Payable',   'liability', 'Current Liabilities',   false, false, false),
    (p_company_id, '5100', 'Office & Administrative Expenses', 'expense',   'Indirect Expenses',     false, false, false),
    (p_company_id, '5110', 'Freight & Transport Charges',      'expense',   'Direct Expenses',       false, false, false),
    (p_company_id, '5120', 'Repair & Maintenance',             'expense',   'Indirect Expenses',     false, false, false),
    (p_company_id, '5200', 'Depreciation',                     'expense',   'Indirect Expenses',     false, false, false)
  ON CONFLICT (company_id, code) DO NOTHING;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END; $$;

-- ============================================================================
-- 13. POSTING (atomic, balanced, once)
-- ============================================================================
-- The debit/credit DERIVATION lives in TypeScript (src/lib/accounts/journal.ts)
-- so it is unit-tested without a database. This function is the transaction
-- boundary: it re-validates the lines it is handed (balance, company
-- ownership, approved status, not already posted) inside one statement, writes
-- the journal and flips the voucher. p_lines shape:
--   [{ "account_id": "<uuid>", "debit": 1234.56, "credit": 0, "narration": "..." }]
CREATE OR REPLACE FUNCTION fin_post_expense_voucher(
  p_voucher_id uuid,
  p_employee_id uuid,
  p_lines jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v            expense_vouchers%ROWTYPE;
  v_line       jsonb;
  v_account    uuid;
  v_debit      numeric(14,2);
  v_credit     numeric(14,2);
  v_count      integer := 0;
  v_fy_locked  boolean;
BEGIN
  SELECT * INTO v FROM expense_vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense voucher not found.';
  END IF;

  IF v.status = 'posted' OR v.status = 'paid' THEN
    RAISE EXCEPTION 'This voucher is already posted. Use a reversal voucher to correct it.';
  END IF;
  IF v.status <> 'approved' THEN
    RAISE EXCEPTION 'Only an approved voucher can be posted (current status: %).', v.status;
  END IF;
  IF EXISTS (SELECT 1 FROM fin_journal_entries WHERE voucher_id = p_voucher_id) THEN
    RAISE EXCEPTION 'This voucher already has journal entries.';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'No accounting lines were supplied.';
  END IF;

  SELECT COALESCE(fy.is_locked, false) INTO v_fy_locked
    FROM fin_financial_years fy WHERE fy.id = v.financial_year_id;
  IF v_fy_locked THEN
    RAISE EXCEPTION 'The financial year for this voucher is locked.';
  END IF;

  SELECT COALESCE(SUM((l->>'debit')::numeric), 0), COALESCE(SUM((l->>'credit')::numeric), 0)
    INTO v_debit, v_credit
    FROM jsonb_array_elements(p_lines) AS l;

  IF ROUND(v_debit, 2) <> ROUND(v_credit, 2) THEN
    RAISE EXCEPTION 'Journal does not balance: debit % vs credit %.', v_debit, v_credit;
  END IF;
  IF ROUND(v_debit, 2) <= 0 THEN
    RAISE EXCEPTION 'Journal total must be greater than zero.';
  END IF;

  FOR v_line IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_account := (v_line->>'account_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM fin_accounts WHERE id = v_account AND company_id = v.company_id) THEN
      RAISE EXCEPTION 'Account % does not belong to this company.', v_account;
    END IF;
    IF ROUND(COALESCE((v_line->>'debit')::numeric, 0), 2) = 0
       AND ROUND(COALESCE((v_line->>'credit')::numeric, 0), 2) = 0 THEN
      RAISE EXCEPTION 'A journal line has no debit and no credit.';
    END IF;
    INSERT INTO fin_journal_entries (
      company_id, financial_year_id, entry_date, source_type, source_id, voucher_id,
      account_id, debit, credit, narration, created_by_employee_id
    ) VALUES (
      v.company_id, v.financial_year_id, v.voucher_date, 'expense_voucher', v.id, v.id,
      v_account,
      ROUND(COALESCE((v_line->>'debit')::numeric, 0), 2),
      ROUND(COALESCE((v_line->>'credit')::numeric, 0), 2),
      NULLIF(v_line->>'narration', ''), p_employee_id
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE expense_vouchers
     SET status = 'posted',
         posted_at = now(),
         posted_by_employee_id = p_employee_id,
         updated_at = now()
   WHERE id = p_voucher_id;

  INSERT INTO expense_voucher_events (voucher_id, company_id, action, from_status, to_status, actor_employee_id, reason)
  VALUES (p_voucher_id, v.company_id, 'posted', v.status, 'posted', p_employee_id, NULL);

  RETURN jsonb_build_object('ok', true, 'entries', v_count, 'total', ROUND(v_debit, 2));
END; $$;
REVOKE ALL ON FUNCTION fin_post_expense_voucher(uuid, uuid, jsonb) FROM PUBLIC;

-- Reversal: posts the exact opposite of every entry in one transaction and
-- marks the voucher cancelled. The original entries stay untouched (Test 10:
-- a cancelled bill must have proper reversal entries, not a deleted journal).
CREATE OR REPLACE FUNCTION fin_reverse_expense_voucher(
  p_voucher_id uuid,
  p_employee_id uuid,
  p_reason text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v         expense_vouchers%ROWTYPE;
  v_entry   fin_journal_entries%ROWTYPE;
  v_count   integer := 0;
BEGIN
  SELECT * INTO v FROM expense_vouchers WHERE id = p_voucher_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense voucher not found.';
  END IF;
  IF v.status NOT IN ('posted', 'paid') THEN
    RAISE EXCEPTION 'Only a posted voucher can be reversed (current status: %).', v.status;
  END IF;
  IF EXISTS (SELECT 1 FROM fin_journal_entries e WHERE e.source_type = 'reversal' AND e.source_id = p_voucher_id) THEN
    RAISE EXCEPTION 'This voucher has already been reversed.';
  END IF;
  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'A reversal reason is required.';
  END IF;

  FOR v_entry IN SELECT * FROM fin_journal_entries WHERE voucher_id = p_voucher_id LOOP
    INSERT INTO fin_journal_entries (
      company_id, financial_year_id, entry_date, source_type, source_id, voucher_id,
      account_id, debit, credit, narration, created_by_employee_id, reversal_of_entry_id
    ) VALUES (
      v_entry.company_id, v_entry.financial_year_id, CURRENT_DATE, 'reversal', p_voucher_id, p_voucher_id,
      v_entry.account_id, v_entry.credit, v_entry.debit,
      'Reversal: ' || COALESCE(p_reason, ''), p_employee_id, v_entry.id
    );
    v_count := v_count + 1;
  END LOOP;

  UPDATE expense_vouchers
     SET status = 'cancelled', updated_at = now()
   WHERE id = p_voucher_id;

  INSERT INTO expense_voucher_events (voucher_id, company_id, action, from_status, to_status, actor_employee_id, reason)
  VALUES (p_voucher_id, v.company_id, 'reversed', v.status, 'cancelled', p_employee_id, p_reason);

  RETURN jsonb_build_object('ok', true, 'reversal_entries', v_count);
END; $$;
REVOKE ALL ON FUNCTION fin_reverse_expense_voucher(uuid, uuid, text) FROM PUBLIC;

-- Opening balances -> journal, once per company/FY. Debit total must equal
-- credit total or nothing is written.
CREATE OR REPLACE FUNCTION fin_post_opening_balances(
  p_company_id uuid,
  p_financial_year_id uuid,
  p_employee_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_debit  numeric(14,2);
  v_credit numeric(14,2);
  v_count  integer := 0;
  v_fy     fin_financial_years%ROWTYPE;
  r        RECORD;
BEGIN
  SELECT * INTO v_fy FROM fin_financial_years WHERE id = p_financial_year_id AND company_id = p_company_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Financial year not found for this company.';
  END IF;
  IF v_fy.is_locked THEN
    RAISE EXCEPTION 'This financial year is locked.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM fin_journal_entries
     WHERE company_id = p_company_id AND financial_year_id = p_financial_year_id AND source_type = 'opening_balance'
  ) THEN
    RAISE EXCEPTION 'Opening balances for this financial year are already posted.';
  END IF;

  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0) INTO v_debit, v_credit
    FROM fin_opening_balances
   WHERE company_id = p_company_id AND financial_year_id = p_financial_year_id;
  IF v_debit = 0 AND v_credit = 0 THEN
    RAISE EXCEPTION 'There are no opening balances to post.';
  END IF;
  IF ROUND(v_debit, 2) <> ROUND(v_credit, 2) THEN
    RAISE EXCEPTION 'Opening balances do not balance: debit % vs credit %.', v_debit, v_credit;
  END IF;

  FOR r IN SELECT * FROM fin_opening_balances
            WHERE company_id = p_company_id AND financial_year_id = p_financial_year_id
            ORDER BY account_id LOOP
    INSERT INTO fin_journal_entries (
      company_id, financial_year_id, entry_date, source_type, source_id,
      account_id, debit, credit, narration, created_by_employee_id
    ) VALUES (
      p_company_id, p_financial_year_id, v_fy.start_date, 'opening_balance', p_financial_year_id,
      r.account_id, r.debit, r.credit, COALESCE(r.narration, 'Opening balance ' || v_fy.label), p_employee_id
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'entries', v_count, 'debit', v_debit, 'credit', v_credit);
END; $$;
REVOKE ALL ON FUNCTION fin_post_opening_balances(uuid, uuid, uuid) FROM PUBLIC;

-- ============================================================================
-- 14. SEED: financial years, accounts, categories
-- ============================================================================
-- Current Indian FY for every existing company (back-dated vouchers outside
-- this range can still be entered — they simply carry no FY stamp until setup
-- adds the year).
INSERT INTO fin_financial_years (company_id, label, start_date, end_date, is_current)
SELECT c.id,
       to_char(d.s, 'YY') || '-' || to_char(d.s + interval '1 year', 'YY'),
       d.s::date,
       (d.s + interval '1 year - 1 day')::date,
       true
FROM companies c
CROSS JOIN LATERAL (
  SELECT make_date(
           CASE WHEN EXTRACT(MONTH FROM CURRENT_DATE) < 4 THEN EXTRACT(YEAR FROM CURRENT_DATE)::int - 1
                ELSE EXTRACT(YEAR FROM CURRENT_DATE)::int END, 4, 1) AS s
) d
ON CONFLICT (company_id, label) DO NOTHING;

SELECT fin_seed_default_accounts(id) FROM companies;

-- Master prompt §5B — the full category list as SHARED rows (company_id NULL).
INSERT INTO expense_categories (company_id, name, group_name, default_gst_rate, gst_applicable, itc_eligible, sort_order)
VALUES
  (NULL, 'Office Rent',                'Office & Administration', 0,  false, false, 10),
  (NULL, 'Electricity',                'Office & Administration', 0,  false, false, 11),
  (NULL, 'Water',                      'Office & Administration', 0,  false, false, 12),
  (NULL, 'Internet',                   'Office & Administration', 18, true,  true,  13),
  (NULL, 'Telephone',                  'Office & Administration', 18, true,  true,  14),
  (NULL, 'Mobile Recharge',            'Office & Administration', 18, true,  true,  15),
  (NULL, 'Stationery',                 'Office & Administration', 18, true,  true,  16),
  (NULL, 'Printing',                   'Office & Administration', 18, true,  true,  17),
  (NULL, 'Photocopy',                  'Office & Administration', 18, true,  true,  18),
  (NULL, 'Courier',                    'Office & Administration', 18, true,  true,  19),
  (NULL, 'Postage',                    'Office & Administration', 18, true,  true,  20),
  (NULL, 'Office Supplies',            'Office & Administration', 18, true,  true,  21),
  (NULL, 'Housekeeping',               'Office & Administration', 18, true,  true,  22),
  (NULL, 'Cleaning',                   'Office & Administration', 18, true,  true,  23),
  (NULL, 'Security',                   'Office & Administration', 18, true,  true,  24),
  (NULL, 'Office Maintenance',         'Office & Administration', 18, true,  true,  25),
  (NULL, 'Staff Welfare',              'Staff & Employee',        0,  false, false, 30),
  (NULL, 'Tea & Refreshments',         'Staff & Employee',        5,  false, false, 31),
  (NULL, 'Food Expenses',              'Staff & Employee',        5,  false, false, 32),
  (NULL, 'Employee Reimbursement',     'Staff & Employee',        0,  false, false, 33),
  (NULL, 'Staff Transportation',       'Staff & Employee',        5,  true,  true,  34),
  (NULL, 'Training',                   'Staff & Employee',        18, true,  true,  35),
  (NULL, 'Uniform',                    'Staff & Employee',        5,  true,  true,  36),
  (NULL, 'Petrol',                     'Travel & Transportation', 0,  false, false, 40),
  (NULL, 'Diesel',                     'Travel & Transportation', 0,  false, false, 41),
  (NULL, 'Taxi',                       'Travel & Transportation', 5,  true,  true,  42),
  (NULL, 'Auto',                       'Travel & Transportation', 5,  true,  true,  43),
  (NULL, 'Bus',                        'Travel & Transportation', 5,  true,  true,  44),
  (NULL, 'Train',                      'Travel & Transportation', 5,  true,  true,  45),
  (NULL, 'Air Ticket',                 'Travel & Transportation', 5,  true,  true,  46),
  (NULL, 'Hotel',                      'Travel & Transportation', 12, true,  true,  47),
  (NULL, 'Travel Allowance',           'Travel & Transportation', 0,  false, false, 48),
  (NULL, 'Local Conveyance',           'Travel & Transportation', 5,  true,  true,  49),
  (NULL, 'Transportation',             'Travel & Transportation', 5,  true,  true,  50),
  (NULL, 'Loading',                    'Travel & Transportation', 18, true,  true,  51),
  (NULL, 'Unloading',                  'Travel & Transportation', 18, true,  true,  52),
  (NULL, 'Warehouse Rent',             'Warehouse & Production',  0,  false, false, 60),
  (NULL, 'Factory Electricity',        'Warehouse & Production',  0,  false, false, 61),
  (NULL, 'Labour Charges',             'Warehouse & Production',  0,  false, false, 62),
  (NULL, 'Machine Repair',             'Warehouse & Production',  18, true,  true,  63),
  (NULL, 'Machine Maintenance',        'Warehouse & Production',  18, true,  true,  64),
  (NULL, 'Packing Expenses',           'Warehouse & Production',  18, true,  true,  65),
  (NULL, 'Material Handling',          'Warehouse & Production',  18, true,  true,  66),
  (NULL, 'Kanta / Weighbridge',        'Warehouse & Production',  18, true,  true,  67),
  (NULL, 'Loading Charges',            'Warehouse & Production',  18, true,  true,  68),
  (NULL, 'Unloading Charges',          'Warehouse & Production',  18, true,  true,  69),
  (NULL, 'Software Subscription',      'IT & Software',           18, true,  true,  70),
  (NULL, 'Hosting',                    'IT & Software',           18, true,  true,  71),
  (NULL, 'Domain Renewal',             'IT & Software',           18, true,  true,  72),
  (NULL, 'Computer Repair',            'IT & Software',           18, true,  true,  73),
  (NULL, 'Hardware Maintenance',       'IT & Software',           18, true,  true,  74),
  (NULL, 'Cloud Services',             'IT & Software',           18, true,  true,  75),
  (NULL, 'CA Fees',                    'Professional & Legal',    18, true,  true,  80),
  (NULL, 'Accounting Fees',            'Professional & Legal',    18, true,  true,  81),
  (NULL, 'Legal Fees',                 'Professional & Legal',    18, true,  true,  82),
  (NULL, 'Consultancy',                'Professional & Legal',    18, true,  true,  83),
  (NULL, 'Audit Fees',                 'Professional & Legal',    18, true,  true,  84),
  (NULL, 'Government Fees',            'Professional & Legal',    0,  false, false, 85),
  (NULL, 'Bank Charges',               'Professional & Legal',    0,  false, false, 86),
  (NULL, 'Advertising',                'Marketing & Sales',       18, true,  true,  90),
  (NULL, 'Photography',                'Marketing & Sales',       18, true,  true,  91),
  (NULL, 'Product Samples',            'Marketing & Sales',       18, true,  true,  92),
  (NULL, 'Marketing',                  'Marketing & Sales',       18, true,  true,  93),
  (NULL, 'Social Media',               'Marketing & Sales',       18, true,  true,  94),
  (NULL, 'Website Maintenance',        'Marketing & Sales',       18, true,  true,  95),
  (NULL, 'Miscellaneous',              'Other',                   0,  false, false, 900),
  (NULL, 'Emergency',                  'Other',                   0,  false, false, 901),
  (NULL, 'Other Business Expenses',    'Other',                   0,  false, false, 902),
  (NULL, 'Office Asset',               'Other',                   18, true,  true,  903)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- 15. RLS + CAPABILITIES
-- ============================================================================
-- Same posture as the customs-rate module: RLS on, forced, and no
-- anon/authenticated grant — every read/write goes through a Server Action
-- using the service-role client after a capability check.
ALTER TABLE fin_financial_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_financial_years FORCE ROW LEVEL SECURITY;
ALTER TABLE fin_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE fin_opening_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_opening_balances FORCE ROW LEVEL SECURITY;
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_categories FORCE ROW LEVEL SECURITY;
ALTER TABLE expense_vouchers ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_vouchers FORCE ROW LEVEL SECURITY;
ALTER TABLE expense_voucher_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_voucher_items FORCE ROW LEVEL SECURITY;
ALTER TABLE expense_voucher_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_voucher_charges FORCE ROW LEVEL SECURITY;
ALTER TABLE fin_journal_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_journal_entries FORCE ROW LEVEL SECURITY;
ALTER TABLE petty_cash_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE petty_cash_accounts FORCE ROW LEVEL SECURITY;
ALTER TABLE petty_cash_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE petty_cash_transactions FORCE ROW LEVEL SECURITY;
ALTER TABLE employee_expense_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_expense_claims FORCE ROW LEVEL SECURITY;
ALTER TABLE fin_approval_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_approval_limits FORCE ROW LEVEL SECURITY;
ALTER TABLE expense_voucher_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_voucher_events FORCE ROW LEVEL SECURITY;

REVOKE ALL ON fin_financial_years, fin_accounts, fin_opening_balances, expense_categories,
              expense_vouchers, expense_voucher_items, expense_voucher_charges, fin_journal_entries,
              petty_cash_accounts, petty_cash_transactions, employee_expense_claims,
              fin_approval_limits, expense_voucher_events
  FROM anon, authenticated;

INSERT INTO capabilities (code, description) VALUES
  ('accounts_view',           'Purchase & Accounts: view the accounts dashboard, expense register, cash book, bank book and trial balance'),
  ('accounts_expense_entry',  'Purchase & Accounts: create, submit and edit expense vouchers, petty cash, categories and reimbursement claims'),
  ('accounts_expense_approve','Purchase & Accounts: approve/reject submitted expense vouchers, reimbursement claims and post approved vouchers'),
  ('accounts_setup',          'Purchase & Accounts: financial years, cash/bank accounts, opening balances and approval limits')
ON CONFLICT (code) DO UPDATE SET description = EXCLUDED.description;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, x.cap
FROM roles r
JOIN (VALUES
  ('Admin',            'accounts_view'),
  ('Admin',            'accounts_expense_entry'),
  ('Admin',            'accounts_expense_approve'),
  ('Admin',            'accounts_setup'),
  ('MD',               'accounts_view'),
  ('MD',               'accounts_expense_entry'),
  ('MD',               'accounts_expense_approve'),
  ('MD',               'accounts_setup'),
  ('Higher Authority', 'accounts_view'),
  ('Higher Authority', 'accounts_expense_approve'),
  ('Finance',          'accounts_view'),
  ('Finance',          'accounts_expense_entry'),
  ('Finance',          'accounts_expense_approve'),
  ('Order Entry',      'accounts_expense_entry')
) AS x(role_name, cap) ON x.role_name = r.name
ON CONFLICT DO NOTHING;

COMMENT ON TABLE expense_vouchers IS
  'Phase 1 of Purchase & Accounts: one posted-atomically expense voucher. expense_type = accounting nature, payment_mode = how the money left; UPI always names its real bank account in payment_account_id so it can never double-count in Cash Book and Bank Book.';
COMMENT ON TABLE fin_journal_entries IS
  'Double-entry journal. Written only by fin_post_expense_voucher / fin_reverse_expense_voucher / fin_post_opening_balances — never edited in place; a correction is a reversal pair.';
COMMENT ON COLUMN expense_vouchers.payment_account_id IS
  'fin_accounts row the money actually left. For UPI this is the linked bank account (not a cash account), which is what keeps UPI out of the Cash Book.';

-- ============================================================================
-- 16. SUPABASE STORAGE (NOT part of db/schema.sql — Supabase only)
-- ============================================================================
-- Receipt / invoice attachments. Public-read like order-photos: uploads only
-- happen through the server action's service-role client, so public only
-- affects rendering the receipt in the voucher preview.
-- NOTE: this block is NOT folded into db/schema.sql because a fresh plain
-- Postgres (CI) has no `storage` schema.
INSERT INTO storage.buckets (id, name, public)
VALUES ('expense-receipts', 'expense-receipts', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- 17. COMPANY ACCOUNTS SETTINGS (added with the app layer)
-- ============================================================================
-- GSTIN + home state per company: these decide CGST/SGST vs IGST for every
-- voucher (place of supply = home state). Kept in its own tiny table rather
-- than a new companies column so the accounting module can be deployed without
-- touching the OMS company record.
CREATE TABLE IF NOT EXISTS fin_settings (
  company_id     uuid PRIMARY KEY REFERENCES companies(id) ON DELETE CASCADE,
  legal_name     text,
  gstin          text,
  home_state     text,
  round_to_rupee boolean NOT NULL DEFAULT false,
  updated_at     timestamptz
);
ALTER TABLE fin_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE fin_settings FORCE ROW LEVEL SECURITY;
REVOKE ALL ON fin_settings FROM anon, authenticated;

-- The posting functions are SECURITY DEFINER and revoked from PUBLIC; the app
-- calls them with the service-role client, so that role needs EXECUTE.
GRANT EXECUTE ON FUNCTION fin_post_expense_voucher(uuid, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION fin_reverse_expense_voucher(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION fin_post_opening_balances(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION fin_seed_default_accounts(uuid) TO service_role;
