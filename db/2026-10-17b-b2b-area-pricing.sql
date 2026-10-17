-- 2026-10-17b — B2B area-based pricing ("RATE PER SQ FT ME HAI … CALCULATION
-- BHI USI HISAB SE HO"). Run ONCE on the live Supabase DB (SQL Editor).
-- Already folded into db/schema.sql — a fresh DB built from schema.sql
-- already has all of this; do NOT replay this file on a fresh schema.
--
-- Three changes:
--   1. b2b_inquiry_items gains the size spec + parsed dims (mirrors
--      b2b_quotation_items), so an enquiry line can be sized and priced
--      per sq ft / per sq mtr.
--   2. b2b_quotation_items.line_total stops being GENERATED (qty × rate)
--      and becomes app-maintained: area-priced lines bill
--      qty × L × W × rate, which the generated column can never express.
--      Existing rows keep their qty × rate values (identical by definition).
--   3. b2b_sales_order_items: same line_total change + the same size columns.
--
-- Until this has run, B2B line-item inserts that carry the new values will
-- error — run it before deploying the code that needs it.

-- ── 1. inquiry items: size spec + parsed dims ────────────────────────────────
ALTER TABLE b2b_inquiry_items
  ADD COLUMN IF NOT EXISTS size            text,
  ADD COLUMN IF NOT EXISTS size_length     numeric(10,2),
  ADD COLUMN IF NOT EXISTS size_width      numeric(10,2),
  ADD COLUMN IF NOT EXISTS size_thickness  numeric(10,3),
  ADD COLUMN IF NOT EXISTS size_unit       text
    DEFAULT 'ft'
    CHECK (size_unit IN ('ft', 'm', 'cm', 'inch') OR size_unit IS NULL);

-- ── 2. quotation line_total: generated → stored (values preserved) ───────────
ALTER TABLE b2b_quotation_items
  ADD COLUMN IF NOT EXISTS line_total_new numeric(14,2) NOT NULL DEFAULT 0;
UPDATE b2b_quotation_items SET line_total_new = round(qty * unit_price, 2);
ALTER TABLE b2b_quotation_items DROP COLUMN line_total;
ALTER TABLE b2b_quotation_items RENAME COLUMN line_total_new TO line_total;

-- ── 3. sales-order items: same line_total change + size columns ──────────────
ALTER TABLE b2b_sales_order_items
  ADD COLUMN IF NOT EXISTS line_total_new numeric(14,2) NOT NULL DEFAULT 0;
UPDATE b2b_sales_order_items SET line_total_new = round(qty * unit_price, 2);
ALTER TABLE b2b_sales_order_items DROP COLUMN line_total;
ALTER TABLE b2b_sales_order_items RENAME COLUMN line_total_new TO line_total;

ALTER TABLE b2b_sales_order_items
  ADD COLUMN IF NOT EXISTS size            text,
  ADD COLUMN IF NOT EXISTS size_length     numeric(10,2),
  ADD COLUMN IF NOT EXISTS size_width      numeric(10,2),
  ADD COLUMN IF NOT EXISTS size_thickness  numeric(10,3),
  ADD COLUMN IF NOT EXISTS size_unit       text
    DEFAULT 'ft'
    CHECK (size_unit IN ('ft', 'm', 'cm', 'inch') OR size_unit IS NULL);
