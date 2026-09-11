-- 2026-09-11 — Phase 4 (final phase) of building the enterprise Payroll &
-- HR blueprint (claude/payroll-hr-architecture-design-2026-09-11.md) into
-- the real OMS. See claude/hr-payroll-build-roadmap-2026-09-11.md for the
-- full phase plan and Phases 1-3 (CTC payroll, leave types + balances,
-- onboarding/org-chart/documents).
--
-- Full & Final (FnF) settlement — a real workflow for when an employee
-- resigns or is terminated: notice-period shortfall, leave encashment
-- (using Phase 2's real per-type balances), a gratuity ESTIMATE (Payment
-- of Gratuity Act convention — see the honest caveat in
-- src/lib/attendance/settlement.ts), outstanding advance recovery, and any
-- one-off additions/deductions (asset recovery, bonus, etc.) — all
-- combined into one final settlement amount and, once paid, mirrored into
-- the same Finance ledger every other payment in this app already uses.
--
-- Deliberately NOT fully automated: this migration adds REFERENCE numbers
-- (notice shortfall days, leave balance, gratuity estimate, outstanding
-- advances) for the admin to review, but every actual rupee amount on the
-- settlement is a LINE ITEM the admin explicitly adds — same "clearly
-- flagged, human confirms" philosophy as Phase 1's statutory defaults, one
-- notch more conservative because a final settlement is rarer and
-- higher-stakes than a routine monthly payroll run.

CREATE TABLE employee_settlements (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id                 uuid NOT NULL REFERENCES employees(id),
  company_id                  uuid NOT NULL REFERENCES companies(id),
  separation_type             text NOT NULL CHECK (separation_type IN ('Resignation', 'Termination')),
  resignation_date            date NOT NULL,   -- the date notice was given / termination decided
  last_working_day            date NOT NULL,
  reason                      text,
  -- Notice period — manually entered (this app has no per-company notice-
  -- period policy config yet) so the admin's own employment-contract figure
  -- is always what's used, never guessed.
  notice_period_required_days int NOT NULL DEFAULT 0,
  notice_period_served_days   int NOT NULL DEFAULT 0,
  status                      text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'Finalized', 'Paid')),
  initiated_by_employee_id    uuid REFERENCES employees(id),
  initiated_at                timestamptz NOT NULL DEFAULT now(),
  finalized_by_employee_id    uuid REFERENCES employees(id),
  finalized_at                timestamptz,
  payment_date                date,
  paid_by_employee_id         uuid REFERENCES employees(id),
  remark                      text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CHECK (last_working_day >= resignation_date)
);
CREATE INDEX idx_employee_settlements_employee ON employee_settlements(employee_id, created_at DESC);
CREATE INDEX idx_employee_settlements_company_status ON employee_settlements(company_id, status);
-- At most ONE in-progress (Draft/Finalized, not yet Paid) settlement per
-- employee at a time — a partial unique index rather than a plain UNIQUE
-- on employee_id, since an employee could in principle be rehired and
-- separated again later, and every past Paid settlement must stay in the
-- table as history.
CREATE UNIQUE INDEX idx_employee_settlements_one_active ON employee_settlements(employee_id) WHERE status != 'Paid';
COMMENT ON TABLE employee_settlements IS
  'One Full & Final settlement per resignation/termination. The actual rupee amounts live entirely in '
  'employee_settlement_line_items below — this row is the case/status wrapper, never a computed total.';

CREATE TABLE employee_settlement_line_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id  uuid NOT NULL REFERENCES employee_settlements(id),
  kind           text NOT NULL CHECK (kind IN ('Addition', 'Deduction')),
  category       text NOT NULL,   -- "Notice Pay Buyout", "Leave Encashment", "Gratuity", "Advance Recovery", "Asset Recovery", "Bonus", "Other", ...
  description    text,
  amount         numeric(12,2) NOT NULL CHECK (amount > 0),
  added_by_employee_id uuid REFERENCES employees(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_employee_settlement_line_items_settlement ON employee_settlement_line_items(settlement_id);
COMMENT ON TABLE employee_settlement_line_items IS
  'Every rupee on a settlement is an explicit line item the admin added — never an auto-computed total. '
  'Net settlement = SUM(amount) WHERE kind=''Addition'' minus SUM(amount) WHERE kind=''Deduction'', always '
  'computed live (same "durable ledger, never a stored/synced total" convention as employee_advances and '
  'leave_balance_adjustments), not stored anywhere on employee_settlements itself. Only editable while the '
  'parent settlement is still status=''Draft'' — enforced in the server action, not the DB.';
