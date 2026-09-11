-- 2026-09-11 — Phase 1 of building the enterprise Payroll & HR blueprint
-- (claude/payroll-hr-architecture-design-2026-09-11.md) into the real OMS,
-- scaled to what this app actually is (one Next.js + Supabase app — no
-- Kafka, no LinkedIn API, per the user's explicit scope decision). See
-- claude/hr-payroll-build-roadmap-2026-09-11.md for the full phase plan.
--
-- This round upgrades the existing flat "Monthly Salary" (employee_salary,
-- built 2026-08-11) into an OPTIONAL CTC (Cost-to-Company) structure that
-- auto-computes Basic/HRA/Special Allowance + Employer/Employee PF + ESI +
-- Professional Tax, on top of the SAME versioned-by-effective_from row and
-- the SAME attendance-based LOP deduction (src/lib/attendance/payroll.ts)
-- that already exists — nothing about the existing flat-salary flow
-- changes for an employee who doesn't use CTC mode; every new column here
-- is nullable/defaulted so old rows and old behavior are untouched.
--
-- ⚠️ STATUTORY RATES DISCLAIMER: the default percentages this ships with
-- (PF 12%/12%, ESI 3.25%/0.75%, PF wage ceiling ₹15,000, ESI threshold
-- ₹21,000) are current PUBLICLY PUBLISHED defaults, editable per employee
-- in the UI — NOT verified against this company's actual PF/ESI
-- registration. Confirm with a CA/accountant before relying on this for a
-- real statutory filing. See src/lib/attendance/statutory.ts for the full
-- calculation + the same disclaimer in code.

-- ── employees: statutory identity + bank details for disbursement ─────────
-- None of these existed before — needed for the payslip (PAN/UAN/bank a/c
-- shown on every payslip) and eventually for a real bank-transfer file
-- (later round). All nullable — fill in per employee from Edit Details.
ALTER TABLE employees
  ADD COLUMN pan_number               text,
  ADD COLUMN uan_number                text,   -- Universal Account Number (EPFO) — distinct from the employer-assigned PF account number below
  ADD COLUMN pf_number                  text,
  ADD COLUMN esi_number                  text,
  ADD COLUMN bank_account_holder_name     text,
  ADD COLUMN bank_account_no               text,
  ADD COLUMN bank_ifsc                      text,
  ADD COLUMN bank_name                       text;

-- ── employee_salary: optional CTC structure, alongside the existing flat
-- monthly_salary column (which stays required — when CTC mode is used in
-- the UI, monthly_salary is auto-filled with the CTC-derived Gross Monthly
-- so every existing payroll/attendance-deduction query keeps working
-- unchanged; ctc_annual IS NULL is exactly how the app tells "flat salary,
-- no CTC breakdown" apart from "CTC mode, here's the breakdown").
ALTER TABLE employee_salary
  ADD COLUMN ctc_annual              numeric(14,2),
  ADD COLUMN basic_percent_of_ctc    numeric(5,2)  NOT NULL DEFAULT 50,
  ADD COLUMN hra_percent_of_basic    numeric(5,2)  NOT NULL DEFAULT 50,
  ADD COLUMN employer_pf_percent     numeric(5,2)  NOT NULL DEFAULT 12,
  ADD COLUMN employee_pf_percent     numeric(5,2)  NOT NULL DEFAULT 12,
  ADD COLUMN pf_wage_ceiling         numeric(12,2) NOT NULL DEFAULT 15000,
  ADD COLUMN esi_applicable          boolean       NOT NULL DEFAULT false,
  ADD COLUMN esi_employee_percent    numeric(5,2)  NOT NULL DEFAULT 0.75,
  ADD COLUMN esi_employer_percent    numeric(5,2)  NOT NULL DEFAULT 3.25,
  ADD COLUMN professional_tax_amount numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN pt_state                text;

-- ── salary_payments: snapshot the actual statutory amounts withheld/
-- contributed AT THE MOMENT of payment (not re-derived later from whatever
-- employee_salary happens to say today) — same "the payment record is the
-- immutable source of truth" philosophy this table's own 2026-08-12 header
-- comment already documents for gross_salary/attendance_deduction_amount.
-- basic/hra/special_allowance are nullable — populated only when that
-- payment came from a CTC-mode salary row; a flat-salary payment leaves
-- them null and the payslip just shows one "Gross Salary" line instead of
-- a component breakdown.
ALTER TABLE salary_payments
  ADD COLUMN basic_amount             numeric(14,2),
  ADD COLUMN hra_amount               numeric(14,2),
  ADD COLUMN special_allowance_amount numeric(14,2),
  ADD COLUMN employee_pf_amount       numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN employer_pf_amount       numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN employee_esi_amount      numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN employer_esi_amount      numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN professional_tax_amount  numeric(14,2) NOT NULL DEFAULT 0;

-- net_paid_amount must now also subtract the employee-side statutory
-- deductions (employer PF/ESI are a company cost, never subtracted from
-- what the employee is paid). Postgres has no ALTER COLUMN ... generated
-- expression — drop and recreate is the only way; safe here since it's a
-- STORED generated column with no independent data of its own, and every
-- underlying column already exists on every row (new ones default to 0).
ALTER TABLE salary_payments DROP COLUMN net_paid_amount;
ALTER TABLE salary_payments ADD COLUMN net_paid_amount numeric(14,2) GENERATED ALWAYS AS (
  GREATEST(0, gross_salary - attendance_deduction_amount - advance_deduction_amount
             - employee_pf_amount - employee_esi_amount - professional_tax_amount)
) STORED;

COMMENT ON COLUMN employee_salary.ctc_annual IS
  'NULL = flat monthly_salary mode (original 2026-08-11 behavior, unchanged). Set = CTC mode — monthly_salary is '
  'auto-derived (Gross Monthly = Basic+HRA+Special Allowance) by the Salary form''s client-side calculator and '
  'saved as-is into monthly_salary, so every existing query keeps working; the extra columns here are what let '
  'submitSalaryPayment() also work out Employee/Employer PF, ESI, and Professional Tax at payment time.';
COMMENT ON COLUMN salary_payments.employee_pf_amount IS
  'Statutory rates used are current published defaults, NOT verified against this company''s real PF/ESI '
  'registration — see src/lib/attendance/statutory.ts header comment for the full disclaimer.';
