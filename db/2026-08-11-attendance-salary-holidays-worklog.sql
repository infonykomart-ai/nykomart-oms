-- Attendance / Salary / Holiday / Daily Work Report module — 2026-08-11.
-- "PERSENT/APSENT SELLERY STRACTURE HOLYDAY ... LOGIN KARTE HI PERSENT LAG
-- JAYE OR SAAM KO ... LOGOUT KARTE HI PUNCH OUT ... EK REPORT KA SYSTEM BHI
-- BANANA HAI ... AUTO SYNC HOYE AGAR GALTI SE REFRESH HO TO JO LIKHA HAI VO
-- VESA HI RAHE".
--
-- The `attendance` table itself already existed (SECTION 16, 2026-08-01
-- round) but had no UI built on top of it yet — this migration only adds
-- what was still missing: a Holiday value for attendance_status, a weekly
-- off pattern per company, a holiday calendar, salary records, and a daily
-- work log table. Per-employee company/store access (multi-access, chosen
-- by Admin/MD) and company-based branding were BOTH already fully built
-- (employee_company_access/employee_store_access + the company switcher +
-- companies.logo_url) — nothing new needed there, confirmed by reading the
-- existing code before writing this migration.
--
-- Safe to re-run: every ALTER uses IF NOT EXISTS / ADD VALUE IF NOT EXISTS,
-- every CREATE TABLE will simply error harmlessly on a second run same as
-- every other migration in this repo (matches the existing convention —
-- run once).

-- 'Week Off' already existed and is reused for the recurring weekly-off day
-- (see companies.weekly_off_days below). 'Holiday' is new — a specific
-- calendar date (Diwali, Independence Day, etc.), which varies year to
-- year, so it's kept as its own status distinct from the recurring weekly
-- pattern. Both are treated identically by the payroll report (never
-- Absent, never deducted) but stay visibly distinct rather than merged
-- into one ambiguous bucket.
ALTER TYPE attendance_status ADD VALUE IF NOT EXISTS 'Holiday';

-- Weekly off pattern per company — e.g. every Sunday off. Stored as an
-- array of day-of-week ints, 0=Sunday..6=Saturday (matches both JS
-- Date.getDay() and Postgres EXTRACT(DOW FROM date), so no day-numbering
-- translation is needed on either side). Defaults to Sunday only, the most
-- common pattern in India — editable per company from the Attendance Admin
-- screen.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS weekly_off_days int[] NOT NULL DEFAULT '{0}';

-- Holiday calendar — specific calendar dates. NULL company_id = applies to
-- every company (a national holiday); a company_id set = that one company
-- only (e.g. an office-specific day off). Did not exist in the old system
-- at all — genuinely new.
CREATE TABLE holidays (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid REFERENCES companies(id),   -- NULL = all companies
  holiday_date            date NOT NULL,
  name                    text NOT NULL,
  created_by_employee_id  uuid REFERENCES employees(id),
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_holidays_date ON holidays(holiday_date);

-- Monthly salary per employee — versioned by effective_from so a raise
-- doesn't rewrite payroll history for earlier months (the payroll report
-- always looks up the row effective as of the month being calculated, not
-- just "whatever the current value is right now"). Absent-day deduction
-- convention used by the payroll report: per-day rate = monthly_salary /
-- days in that calendar month; days absent beyond allowed_leaves_per_month
-- are deducted at that per-day rate. This is a common/standard Indian
-- payroll convention, NOT a verified copy of this company's actual written
-- policy — flagged here and in the UI as the assumption it is; edit
-- allowed_leaves_per_month per employee, or ask to change the formula
-- itself if their real policy differs.
CREATE TABLE employee_salary (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id               uuid NOT NULL REFERENCES employees(id),
  monthly_salary            numeric(12,2) NOT NULL,
  allowed_leaves_per_month  numeric(4,1) NOT NULL DEFAULT 1,
  effective_from            date NOT NULL,
  entered_by_employee_id    uuid REFERENCES employees(id),
  created_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_employee_salary_employee ON employee_salary(employee_id, effective_from DESC);

-- Daily Work Report — direct equivalent of the standalone "NYKO MART Work &
-- Performance" Apps Script tool's DailyLogs sheet (given as a reference
-- this round), rebuilt against Postgres. One row per work item logged for
-- a given day. Auto-saved from the UI as the employee types (debounced,
-- see attendance/daily-report-form.tsx) rather than one "submit the whole
-- day" button — updated_at is what the browser compares its own
-- localStorage draft against on page load, to decide whether an unsaved
-- draft is newer than what's already in the database (refresh-safe).
CREATE TABLE daily_work_logs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id     uuid NOT NULL REFERENCES employees(id),
  company_id      uuid NOT NULL REFERENCES companies(id),
  log_date        date NOT NULL DEFAULT CURRENT_DATE,
  category        text,
  description     text NOT NULL DEFAULT '',
  target_qty      text,
  qty_done        text,
  work_status     text,   -- 'Completed' / 'In Progress' / 'Next Day Carry On'
  estimated_time  text,
  time_taken      text,
  remark_sku      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_daily_work_logs_employee_date ON daily_work_logs(employee_id, log_date DESC);
CREATE INDEX idx_daily_work_logs_company_date ON daily_work_logs(company_id, log_date DESC);
