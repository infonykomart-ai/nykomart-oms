-- Harmonized Tariff Number values — 2026-08-11.
-- Real US HTS codes, matched to the existing hsn_code already set on each
-- item_category. Stored with the dots exactly as given ("FIT TO COLLOM
-- AANE CHAHIYE") — displays as-is in the invoice item table's Harmonized
-- Tariff Number column, no reformatting.
--
-- Rug codes (57050039/57050024/57031010) cross-checked against Chapter 57
-- of the 2026 HTS Revision 15 — "Carpets and other textile floor
-- coverings", the correct chapter for this business's rug products.
--
-- Kurti code (62114991) cross-checked against Chapter 62 of the 2026 HTS
-- Revision 15 — "Articles of apparel and clothing accessories, not
-- knitted or crocheted". User confirmed the garment is cotton, which maps
-- to heading 6211.42 ("Other garments, women's or girls': Of cotton"),
-- not 6211.49 ("...of OTHER textile materials" — silk/wool/other) despite
-- the "49" in the HSN code the user gave, which doesn't carry over to the
-- US HTS structure 1:1. Within 6211.42, the general/residual "Other"
-- bucket (6211.42.10, catch-all not otherwise specified above — not
-- recreational performance outerwear, coveralls, track suits, blouses,
-- jumpers, vests, jackets, or hospital apparel) has stat suffix .92, not
-- .91 (no .91 exists under 6211.42 in the PDF) — user confirmed
-- 6211.42.10.92 is correct after reviewing this discrepancy.
--
-- Safe to re-run: matches by hsn_code, not by row id, and only touches
-- categories that already have one of these 4 codes set.

UPDATE item_categories SET harmonized_tariff_number = '5705.00.20.30' WHERE hsn_code = '57050039';
UPDATE item_categories SET harmonized_tariff_number = '5705.00.20.20' WHERE hsn_code = '57050024';
UPDATE item_categories SET harmonized_tariff_number = '5703.10.20.00' WHERE hsn_code = '57031010';
UPDATE item_categories SET harmonized_tariff_number = '6211.42.10.92' WHERE hsn_code = '62114991';
