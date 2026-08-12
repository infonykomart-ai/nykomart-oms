-- 2026-08-12 (round 9): "JESE KISI EMPLOYEE NE ADVANCE LE LIYE TO VO USKI
-- SELLERY SE DEDECTUION HONA CHAHIYE NE SATH ME EK OPTION YE BHI HONA
-- CHAHIYE KI JO ADVANCE LIYE HAI VO KITNE MAHINE ME KATEGA AB JESE 10000
-- ADVACNE LE LIYE TO JESE 10 MAHINE ME RECOVER KARNA HAI TO HAR MAHINE
-- 1000 KATE JAYE ACCOUNT SE" — an optional recovery SCHEDULE on top of the
-- existing employee_advances/submitSalaryPayment recovery mechanism
-- (db/2026-08-12-finance-salary-advance.sql): give an advance "over N
-- months" and each month's salary payment auto-suggests (pre-fills, still
-- editable) that month's fixed installment instead of the admin having to
-- work out and type the right number by hand every time.
--
-- recovery_months is nullable on purpose — an advance given WITHOUT a
-- schedule keeps behaving exactly as before (fully manual amount typed
-- each month). monthly_installment is a GENERATED column (amount /
-- recovery_months, rounded to paise) so it can never drift out of sync
-- with amount/recovery_months, and is NULL whenever no schedule was set.

ALTER TABLE employee_advances ADD COLUMN IF NOT EXISTS recovery_months int CHECK (recovery_months IS NULL OR recovery_months > 0);
ALTER TABLE employee_advances ADD COLUMN IF NOT EXISTS monthly_installment numeric(14,2)
  GENERATED ALWAYS AS (
    CASE WHEN recovery_months IS NOT NULL AND recovery_months > 0
      THEN ROUND(amount / recovery_months, 2)
      ELSE NULL
    END
  ) STORED;

COMMENT ON COLUMN employee_advances.recovery_months IS
  'Optional — "kitne mahine me katega". NULL = no fixed schedule, fully manual recovery amount each month (the '
  'original behavior). When set, submitSalaryPayment pre-fills (not force-applies — still editable/overridable '
  'per month) that advance''s monthly_installment as the suggested "Deduct from Advance" amount.';
COMMENT ON COLUMN employee_advances.monthly_installment IS
  'amount / recovery_months, rounded to paise — GENERATED so it can never drift from the two source columns. '
  'The LAST month''s actual deduction is still clamped to whatever''s left outstanding (see submitSalaryPayment), '
  'so a rounding remainder never gets stranded forever.';
