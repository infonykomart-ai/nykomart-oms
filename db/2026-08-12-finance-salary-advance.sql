-- 2026-08-12 (round 7): "attendance & attendance admin & sallery & advance
-- ek dusre se attech honge, jitni sellery debit hoyegi account se to uska
-- bhi konse section me jayegi finance ke" + "sellery advance vala bhi sahi
-- se kaam nahi kar raha, sellery decide karne ka option, agar kisi ne
-- advance liya hai to HR section se connect hokar yaha reflact hona
-- chahiye, phir apne account me ki is company me itne bande the unki is
-- account se sellery gyi, company ke account add ho konse me kitna
-- paymet gaya kese gaya"
--
-- Today (before this file): /dashboard/salary is a READ-ONLY report
-- (attendance-based deduction preview) — no "salary actually paid" record
-- exists anywhere, no Advance/loan tracking exists at all, and neither
-- ever touches any Finance ledger. This file builds the missing pieces:
--   1. Two new invoice_type values so Salary/Advance payouts can live in
--      the SAME bill_pass_register ledger every vendor/courier bill uses
--      (bill_pass_register.employee_id ties a row back to which employee,
--      alongside the existing vendor-facing party_id — exactly one of the
--      two is set per row, never both).
--   2. employee_advances — a real ledger of money advanced to an employee,
--      with a running recovered_amount so multiple partial salary
--      deductions across months can net it down over time.
--   3. salary_payments — a real "salary was actually paid" record (the
--      existing payroll report only ever computed a PREVIEW; this is what
--      makes an actual payment durable, one per employee per month).
--
-- Company-wise "which account did this money leave from" needs NO new
-- column — company_profiles.bank_name/account_no already exists (one bank
-- account on file per company) and every new row here is scoped by
-- company_id, so the Finance summary just joins through that.
--
-- IMPORTANT (same lesson as the 'Hold' order_status addition, 2026-08-08):
-- an ALTER TYPE ... ADD VALUE cannot be used in the same transaction that
-- adds it. Nothing below tries to USE 'Salary'/'Advance' as a literal
-- value (no DEFAULT, no CHECK, no backfill UPDATE references them), so
-- this file is safe to run as one paste in the Supabase SQL Editor. If it
-- ever errors on that account, just run the two ALTER TYPE lines first,
-- then the rest separately.

ALTER TYPE invoice_type ADD VALUE IF NOT EXISTS 'Salary';
ALTER TYPE invoice_type ADD VALUE IF NOT EXISTS 'Advance';

-- IMPORTANT — RLS: db/2026-08-08-enable-rls.sql loops over every table in
-- `public` AT THE TIME IT RUNS and attaches the blanket
-- allow_authenticated_all policy. `employee_advances` and `salary_payments`
-- below are brand-new tables, so they have NO RLS/policy at all until that
-- file is re-run — meaning the public anon key alone (no login) could
-- read/write every advance/salary row via the Supabase REST API in the
-- meantime (same lesson as `tasks` in db/2026-08-11-tasks-report-timer-
-- carryover.sql). Apply this migration FIRST, then re-run
-- db/2026-08-08-enable-rls.sql (idempotent, safe to re-run) so both new
-- tables get the same authenticated-only policy every other table has.

-- bill_pass_register: identify which EMPLOYEE a Salary/Advance row is
-- for (party_id stays NULL for these — an employee isn't a vendor party),
-- plus a loose, deliberately-not-FK'd (same convention the table's own
-- comment already uses for freight/duty/purchase bills) pointer back to
-- whichever salary_payments/employee_advances row generated this entry,
-- so the auto-inserted rows can be told apart from a manually-typed one.
ALTER TABLE bill_pass_register ADD COLUMN IF NOT EXISTS employee_id uuid REFERENCES employees(id);
ALTER TABLE bill_pass_register ADD COLUMN IF NOT EXISTS source text;
ALTER TABLE bill_pass_register ADD COLUMN IF NOT EXISTS source_id uuid;
CREATE INDEX IF NOT EXISTS idx_bill_pass_employee ON bill_pass_register(employee_id);
COMMENT ON COLUMN bill_pass_register.source IS
  'NULL = manually entered (vendor/courier bill, typed in directly). ''salary_payment'' / ''employee_advance'' '
  '= auto-inserted by those actions the moment money actually moves, so every real debit from a company account '
  'shows up in this one Finance ledger regardless of WHY it went out.';

-- Courier ka Credit Note against a specific bill — "shipment ke against me
-- courier ka credit note aagya" had no home before this (freight_bills /
-- duty_tax_bills had no credit-note field at all; only the unrelated,
-- disconnected bill_pass_register.credit_note_amt existed). Captured at
-- the bill level, matching how the physical document actually arrives —
-- against ONE courier invoice, not as a free-floating ledger line.
ALTER TABLE freight_bills ADD COLUMN IF NOT EXISTS credit_note_no text;
ALTER TABLE freight_bills ADD COLUMN IF NOT EXISTS credit_note_date date;
ALTER TABLE freight_bills ADD COLUMN IF NOT EXISTS credit_note_amt numeric(14,2) NOT NULL DEFAULT 0;
ALTER TABLE duty_tax_bills ADD COLUMN IF NOT EXISTS credit_note_no text;
ALTER TABLE duty_tax_bills ADD COLUMN IF NOT EXISTS credit_note_date date;
ALTER TABLE duty_tax_bills ADD COLUMN IF NOT EXISTS credit_note_amt numeric(14,2) NOT NULL DEFAULT 0;

-- =============================================================================
-- Employee Advance — a real loan/advance ledger, not just a free-text note.
-- "agar kisi ne advance liya hai to HR section se connect hokar yaha
-- reflact hona chahiye" — employee_id is the connection point: the same
-- row is what the Employees (HR) admin screen reads to show "Outstanding
-- Advance: ₹X" per person, AND what Salary Payment below reads to offer
-- "deduct from this month's salary", AND what auto-inserts into
-- bill_pass_register so Finance sees it the moment it's given.
-- =============================================================================
CREATE TABLE IF NOT EXISTS employee_advances (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id         uuid NOT NULL REFERENCES employees(id),
  company_id          uuid NOT NULL REFERENCES companies(id),
  amount              numeric(14,2) NOT NULL,
  date_given          date NOT NULL,
  reason              text,
  given_by_employee_id uuid REFERENCES employees(id),
  -- Running total of how much of this advance has been recovered so far
  -- (via one or more salary_payments.advance_deduction_amount rows) — a
  -- plain column, not a live cross-table SUM, because it needs to be
  -- updated transactionally alongside each salary payment that recovers
  -- part of it (see submitSalaryPayment).
  recovered_amount    numeric(14,2) NOT NULL DEFAULT 0,
  outstanding_amount  numeric(14,2) GENERATED ALWAYS AS (amount - recovered_amount) STORED,
  remark              text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_employee_advances_employee ON employee_advances(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_advances_company  ON employee_advances(company_id);
COMMENT ON TABLE employee_advances IS
  '2026-08-12: real advance/loan tracking, requested alongside Salary — was previously just the salary_admin '
  'capability''s description ("not yet built in the source system"). Deliberately per-advance (not one running '
  'per-employee balance) so each advance keeps its own date/reason/recovery history.';

-- =============================================================================
-- Salary Payment — the ACTUAL "salary was paid" record. /dashboard/salary's
-- existing payroll table only ever computed a live PREVIEW from attendance
-- (computeDeduction) — nothing durable was ever written when salary was
-- really paid. UNIQUE(employee_id, pay_month) mirrors the same
-- one-per-period idempotency guard used elsewhere in this codebase
-- (daily_work_logs' carry-over unique index, tasks' submit guards).
-- =============================================================================
CREATE TABLE IF NOT EXISTS salary_payments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id                 uuid NOT NULL REFERENCES employees(id),
  company_id                  uuid NOT NULL REFERENCES companies(id),
  pay_month                   date NOT NULL,   -- always the 1st of the month, e.g. 2026-08-01
  gross_salary                numeric(14,2) NOT NULL,
  attendance_deduction_amount numeric(14,2) NOT NULL DEFAULT 0,
  -- How much of this payment was withheld to recover an outstanding
  -- employee_advances balance — captured here (not just on the advance
  -- row) so a single salary payment's own breakdown is self-contained.
  advance_deduction_amount    numeric(14,2) NOT NULL DEFAULT 0,
  advance_id                  uuid REFERENCES employee_advances(id),  -- which advance this payment recovered against, if any
  -- GREATEST(0, ...) floor: attendance_deduction_amount is recomputed
  -- fresh server-side at the moment of payment (see submitSalaryPayment)
  -- and advance_deduction_amount is clamped to the target advance's own
  -- outstanding balance, so this should never go negative in practice —
  -- but nothing upstream enforces attendance_deduction <= gross_salary,
  -- so the floor is a defensive guarantee that a payout is never negative.
  net_paid_amount              numeric(14,2) GENERATED ALWAYS AS (GREATEST(0, gross_salary - attendance_deduction_amount - advance_deduction_amount)) STORED,
  payment_date                 date NOT NULL,
  paid_by_employee_id          uuid REFERENCES employees(id),
  remark                       text,
  created_at                   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, pay_month)
);
CREATE INDEX IF NOT EXISTS idx_salary_payments_employee ON salary_payments(employee_id);
CREATE INDEX IF NOT EXISTS idx_salary_payments_company_month ON salary_payments(company_id, pay_month);
COMMENT ON TABLE salary_payments IS
  '2026-08-12: the actual "salary was paid" event — distinct from the pre-existing employee_salary table '
  '(the fixed MONTHLY RATE, versioned by effective_from) and from the payroll preview computeDeduction() '
  'renders live. One row per employee per pay_month (UNIQUE guard) once really paid.';

-- Atomic advance recovery — submitSalaryPayment used to do an unsafe
-- read-then-write (select recovered_amount, add in JS, update) which is a
-- race condition: two concurrent salary payments for the same employee
-- (different pay_month, so not blocked by salary_payments' own UNIQUE
-- guard) could both read the same starting recovered_amount and one
-- update would silently clobber the other's. A single UPDATE ... SET
-- recovered_amount = recovered_amount + p_amount is atomic at the row
-- level — Postgres serializes concurrent updates to the same row, so this
-- can never lose a recovery no matter how many payments land at once.
CREATE OR REPLACE FUNCTION recover_employee_advance(p_advance_id uuid, p_amount numeric)
RETURNS numeric AS $$
  UPDATE employee_advances
  SET recovered_amount = recovered_amount + p_amount
  WHERE id = p_advance_id
  RETURNING recovered_amount;
$$ LANGUAGE sql;

UPDATE capabilities SET description = 'Salary payment + advance tracking, connected to Attendance and Finance'
  WHERE code = 'salary_admin';
