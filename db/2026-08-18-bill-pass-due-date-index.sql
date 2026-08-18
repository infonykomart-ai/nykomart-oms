-- 2026-08-18 performance fix (one of the lower-priority items flagged in
-- the 2026-08-17 perf audit, BRAIN.md §7)
--
-- bill-payment/page.tsx's main query is
-- `.eq("company_id", ...).gt("balance_due", 0).order("due_date")`. The
-- existing idx_bill_pass_company index covers company_id but Postgres still
-- has to filter balance_due and sort by due_date separately. This partial
-- index matches the query's exact WHERE shape (balance_due > 0) and column
-- order (company_id, due_date), so the planner can satisfy the whole query
-- — filter AND sort — directly from the index.
--
-- Idempotent — safe to run again if this file is re-run by mistake.
-- (The 2nd flagged low-priority item — a .limit() on the finished-goods
-- inventory query — is a pure code change, no SQL needed; see
-- src/app/dashboard/inventory/page.tsx.)

CREATE INDEX IF NOT EXISTS idx_bill_pass_company_due_date
  ON bill_pass_register(company_id, due_date)
  WHERE balance_due > 0;
