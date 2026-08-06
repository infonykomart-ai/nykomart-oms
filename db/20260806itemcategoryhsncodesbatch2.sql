-- Batch 2: HSN codes for the remaining 6 categories. 5 garment categories
-- share one code; HAND WOVEN JUTE RUG confirmed by user to share the same
-- code as HAND BRAIDED JUTE RUG (both jute rug constructions, same HSN).
-- Safe to re-run.

UPDATE item_categories SET hsn_code = '62114991' WHERE name = 'COTTON LADIES KURTI';
UPDATE item_categories SET hsn_code = '62114991' WHERE name = 'RAYON LADIES KURTI';
UPDATE item_categories SET hsn_code = '62114991' WHERE name = 'RAYON LADIES TOP';
UPDATE item_categories SET hsn_code = '62114991' WHERE name = 'COTTON LADIES TOP';
UPDATE item_categories SET hsn_code = '62114991' WHERE name = 'COTTON MATERNITY';
UPDATE item_categories SET hsn_code = '57050039' WHERE name = 'HAND WOVEN JUTE RUG';

-- Confirm:
SELECT name, hsn_code FROM item_categories ORDER BY name;
