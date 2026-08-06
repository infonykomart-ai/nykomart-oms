-- Adds an HSN code field to Item Category (needed for the CSB-V/CSB-IV
-- invoice's item table — every line item prints its category's HSN code,
-- confirmed from your real sample invoices NL1702627.pdf / ERG122627.pdf /
-- ERG092627.pdf). Safe to re-run.

ALTER TABLE item_categories ADD COLUMN IF NOT EXISTS hsn_code text;

-- HSN codes confirmed from your real sample invoices — 3 of 9 categories.
-- The other 6 (COTTON LADIES KURTI, RAYON LADIES KURTI, RAYON LADIES TOP,
-- COTTON LADIES TOP, COTTON MATERNITY) still need their HSN codes from you.
UPDATE item_categories SET hsn_code = '57050024' WHERE name = 'HANDMADE 100% COTTON RUG';
UPDATE item_categories SET hsn_code = '57050039' WHERE name = 'HAND BRAIDED JUTE RUG';
UPDATE item_categories SET hsn_code = '57031010' WHERE name = 'HAND TUFTED WOOL RUG';

-- Confirm:
SELECT name, hsn_code FROM item_categories ORDER BY name;
