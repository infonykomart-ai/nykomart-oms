-- 2026-09-11 — Phase 2 of building the enterprise Payroll & HR blueprint
-- (claude/payroll-hr-architecture-design-2026-09-11.md) into the real OMS.
-- See claude/hr-payroll-build-roadmap-2026-09-11.md for the full phase
-- plan and Phase 1 (CTC payroll structure).
--
-- This round adds real leave TYPES (Casual/Sick/Earned/Maternity/Comp-Off,
-- whatever the company wants to define) with per-type accrual and a real
-- per-employee balance, on top of the EXISTING leave_requests
-- apply/approve workflow (db/2026-08-12-leave-requests-coverage.sql) —
-- that workflow is untouched; this only adds an optional leave_type_id to
-- it. A leave request with no type keeps working EXACTLY as it did before
-- this round (governed by employee_salary.allowed_leaves_per_month, the
-- original flat monthly pool) — nothing breaks for a company that never
-- sets up leave types.

-- ── leave_types: per-company configurable leave categories ────────────────
CREATE TABLE leave_types (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id),
  name                  text NOT NULL,          -- "Casual Leave", "Sick Leave", "Earned Leave", "Maternity Leave", "Comp Off", ...
  code                  text,                   -- short display code, e.g. "CL"/"SL"/"EL"/"ML"/"CO" — optional
  paid                  boolean NOT NULL DEFAULT true,   -- false = every day of this type is always deducted in payroll, regardless of balance
  annual_accrual_days   numeric(5,1) NOT NULL DEFAULT 0,
  -- 'Monthly' = accrues pro-rata as the year progresses (typical for
  -- Casual/Sick — common Indian convention: 1 day/month). 'Upfront' = the
  -- full annual_accrual_days is available as soon as the employee is
  -- active in that leave year (typical for Earned/Privilege Leave).
  accrual_frequency     text NOT NULL DEFAULT 'Monthly' CHECK (accrual_frequency IN ('Monthly', 'Upfront')),
  carry_forward_cap     numeric(5,1),           -- NULL = this app doesn't auto-carry-forward at all (admin carries forward manually via a leave_balance_adjustments row below each January) — see honest caveat in the roadmap doc
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);
COMMENT ON TABLE leave_types IS
  'Real leave categories, admin-configurable per company from /dashboard/leave/admin. A company with zero rows '
  'here keeps the original single-pool leave behavior (employee_salary.allowed_leaves_per_month) unchanged.';

-- ── leave_requests: optional type on the EXISTING request/approval table ──
ALTER TABLE leave_requests ADD COLUMN leave_type_id uuid REFERENCES leave_types(id);
COMMENT ON COLUMN leave_requests.leave_type_id IS
  'NULL = untyped request, original 2026-08-12 behavior unchanged (governed by the flat monthly leave allowance). '
  'Set = this request draws from that leave type''s real accrued balance — see decideLeaveRequest() in actions.ts.';

-- ── attendance: which leave type (if any) a Leave day belongs to, and
-- whether it was determined to be PAID or UNPAID at approval time ─────────
ALTER TABLE attendance
  ADD COLUMN leave_type_id uuid REFERENCES leave_types(id),
  ADD COLUMN leave_unpaid  boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN attendance.leave_unpaid IS
  'Only meaningful when status = ''Leave'' AND leave_type_id IS NOT NULL. Decided ONCE at approval time '
  '(decideLeaveRequest, walking the request''s date range against the employee''s real balance at that moment) '
  'and never recomputed later, so a payslip already run never silently changes if the leave type''s rules change '
  'afterward. true = this day is deducted in payroll regardless of the flat monthly allowance (either the leave '
  'type itself is unpaid, or this day fell after the employee''s real balance for that type ran out).';

-- ── leave_balance_adjustments: a real ledger, not a mutable counter ───────
-- Opening balances (e.g. migrating a carry-forward figure from the old
-- system), manual corrections, or a one-off extra grant — same "durable
-- event row, never SUM-and-forget" philosophy as employee_advances. A
-- positive adjustment_days ADDS to the employee's balance for that leave
-- type/year; negative SUBTRACTS.
CREATE TABLE leave_balance_adjustments (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id             uuid NOT NULL REFERENCES employees(id),
  leave_type_id           uuid NOT NULL REFERENCES leave_types(id),
  leave_year              int NOT NULL,        -- calendar year this adjustment applies to, e.g. 2026
  adjustment_days         numeric(5,1) NOT NULL,
  reason                  text,
  entered_by_employee_id  uuid REFERENCES employees(id),
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_leave_balance_adjustments_employee ON leave_balance_adjustments(employee_id, leave_type_id, leave_year);
COMMENT ON TABLE leave_balance_adjustments IS
  'Ledger of manual balance corrections (opening/carry-forward balances, one-off grants, mistakes fixed). The '
  'live balance for (employee, leave_type, leave_year) is: SUM(adjustment_days here) + accrued-to-date (computed '
  'live from leave_types.annual_accrual_days/accrual_frequency, see src/lib/attendance/leave-balance.ts) minus '
  'approved Leave days of that type this year (counted from attendance, not stored anywhere separately).';
