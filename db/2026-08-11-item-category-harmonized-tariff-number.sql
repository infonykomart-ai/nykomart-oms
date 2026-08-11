-- Harmonized Tariff Number column — 2026-08-11.
-- "HSN code ke sath ek coloum Harmonized Tariff Number" — a column
-- alongside HSN code on the invoice item table.
--
-- HSN is the universal 6-digit code already on item_categories. Several
-- destination countries extend it with their own longer national tariff
-- schedule (e.g. USA's 10-digit HTS — see https://hts.usitc.gov/). This is
-- the same nullable, manually-entered-per-category pattern as hsn_code —
-- no per-destination-country lookup table, the business enters whichever
-- code applies for their typical destination (same as how HSN itself
-- already works).
ALTER TABLE item_categories
  ADD COLUMN harmonized_tariff_number text;

COMMENT ON COLUMN item_categories.harmonized_tariff_number IS 'National tariff schedule code (e.g. US HTS), printed alongside HSN on the invoice item table. Manually entered, same pattern as hsn_code.';
