-- 2026-10-28 — "office expense vale section ko jese purchase ki entry karte
-- hai vese banao: multiple item, party ka naam, invoice no (if applicable),
-- invoice date, edit / preview / delete option".
--
-- Until now internal_expenses was a flat one-row-per-expense log (company,
-- date, category, amount). That is fine for "petrol ₹500", but an actual
-- office/service bill (stationery from SHREE RAM PLASTIC, a repair from a
-- vendor, a printing bill) is exactly like a purchase bill: one vendor
-- invoice carrying several line items. So the bill's HEADER fields are added
-- to every row and the rows of one bill share an `entry_group_id`:
--
--   entry_group_id  the bill this line belongs to (NULL on rows created
--                   before this patch — the app treats a NULL as "this row
--                   is its own one-line bill", so old data needs no backfill)
--   party_id        the vendor / party the bill is from (optional)
--   invoice_no      the vendor's invoice number (optional, "if applicable")
--   invoice_date    the vendor's invoice date (optional)
--   description     per-line description ("A4 paper ream", "chair repair")
--   updated_at      last edit stamp
--
-- Why one table instead of a header + items pair of tables: the P&L views
-- (pl_dashboard_by_company_view / pl_dashboard_by_month_view) SUM
-- internal_expenses.amount_inr. Keeping one row per line item means those
-- views stay correct with zero changes — splitting the amount into a child
-- table would have silently zeroed every office expense out of the P&L until
-- each view was rewritten.
--
-- Idempotent: safe to run twice. Folded into db/schema.sql in the same
-- change, so CI's schema-check stays green.
--
-- If this patch is NOT run: the app keeps working — the office-expense screen
-- falls back to the old single-row form (see the header note in
-- src/app/dashboard/expenses/page.tsx) and nothing is lost.

ALTER TABLE internal_expenses ADD COLUMN IF NOT EXISTS party_id     uuid REFERENCES parties(id) ON DELETE SET NULL;
ALTER TABLE internal_expenses ADD COLUMN IF NOT EXISTS invoice_no   text;
ALTER TABLE internal_expenses ADD COLUMN IF NOT EXISTS invoice_date date;
ALTER TABLE internal_expenses ADD COLUMN IF NOT EXISTS description  text;
ALTER TABLE internal_expenses ADD COLUMN IF NOT EXISTS entry_group_id uuid;
ALTER TABLE internal_expenses ADD COLUMN IF NOT EXISTS updated_at   timestamptz;

CREATE INDEX IF NOT EXISTS idx_internal_expenses_group ON internal_expenses(entry_group_id) WHERE entry_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_internal_expenses_party ON internal_expenses(party_id) WHERE party_id IS NOT NULL;
