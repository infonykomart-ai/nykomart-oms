-- 2026-08-17: Party Master cleanup + new parties, ahead of importing the
-- historical "Master Bill Pass File" spreadsheets (Nyko Mart + Rug Ara)
-- into bill_pass_register. Run this FIRST, before the two import files
-- (2026-08-17-nyko-mart-bill-pass-import.sql /
-- 2026-08-17-rug-ara-bill-pass-import.sql), since those look up party_id
-- by name and will silently leave party_id NULL for any name not yet in
-- `parties`.
--
-- Run all three statements below in ONE transaction (this whole file) so a
-- half-applied state (duplicate deleted but re-link not committed, etc.)
-- can never happen.

BEGIN;

-- -----------------------------------------------------------------------
-- STEP 1 — dedupe "PRACHI RUGS" vs "M/S. Prachi Rugs".
-- Confirmed live (2026-08-17): "PRACHI RUGS" has 291 purchase_bills rows,
-- "M/S. Prachi Rugs" has 2. User confirmed (Cowork chat, 2026-08-17):
-- keep "M/S. Prachi Rugs", re-link the 291 bills onto it, then delete
-- "PRACHI RUGS". Every other FK table (orders, washing_entries,
-- debit_notes, stock_items, stock_in, stock_out, bill_pass_register,
-- freight_bills, duty_tax_bills) was checked live and had 0 rows against
-- either party id, so purchase_bills is the only table that needs the
-- re-link.
UPDATE purchase_bills
SET vendor_party_id = (SELECT id FROM parties WHERE name = 'M/S. Prachi Rugs')
WHERE vendor_party_id = (SELECT id FROM parties WHERE name = 'PRACHI RUGS');

DELETE FROM parties WHERE name = 'PRACHI RUGS';

-- -----------------------------------------------------------------------
-- STEP 2 — create the new parties referenced by the CSV imports that don't
-- already exist in Party Master (checked live against all 17 existing
-- rows, case-insensitively, before writing this). Names below use the
-- exact spelling the import files will look up by (case-insensitive
-- match via `name citext`), except the couriers, whose `party_type` is
-- set to the exact string 'Courier' (not the CSV's longer descriptive
-- text) because that's what groupPartyOptions() in the Document Entry /
-- Party Ledger UI matches on to bucket a party under "🚚 Courier" — the
-- CSV's own wording is preserved in `remark` instead so it isn't lost.
INSERT INTO parties (name, party_type, invoice_type, remark) VALUES
  ('Aramex',           'Courier', NULL, 'Courier /international shipping (imported from Master Bill Pass File)'),
  ('FedEx',             'Courier', NULL, 'Courier /international shipping (imported from Master Bill Pass File)'),
  ('On Point Express',   'Courier', NULL, 'Courier /international shipping (imported from Master Bill Pass File)'),
  ('Shiprocket',          'Courier', NULL, 'Courier /international shipping (imported from Master Bill Pass File)'),
  ('UPS',                  'Courier', NULL, 'Courier /international shipping (imported from Master Bill Pass File)'),
  ('West Express',          'Courier', NULL, 'Courier /international shipping (imported from Master Bill Pass File)'),
  ('AU BANK',                'Office Expances', 'Service', 'imported from Master Bill Pass File'),
  ('Aaradhya Fabrics',        'Office Expances', 'Purchase', 'imported from Master Bill Pass File'),
  ('Choice Computer',          'Purchase Compuer & Parts', 'Purchase', 'imported from Master Bill Pass File'),
  ('DILEEP COMPUTERS',           'OTHER', 'Purchase', 'imported from Master Bill Pass File'),
  ('E-COM STAR',                  'Office Expances', 'Purchase', 'imported from Master Bill Pass File'),
  ('ERANK',                        'Office Expances', 'Service', 'imported from Master Bill Pass File'),
  ('GARGI ENTERPRISES',             'Domestic Purchase Matrial', 'Purchase', 'imported from Master Bill Pass File'),
  ('M.S. It Solution',               'Office Expances', 'Purchase', 'imported from Master Bill Pass File'),
  ('Mangal Murti Enterprises',        'Packing material', 'Purchase', 'imported from Master Bill Pass File'),
  ('New KR Printer',                   'Printing Cotton Rug', 'Printing', 'imported from Master Bill Pass File'),
  ('PARSHOTAM & ASSOCIATES',             'Service', 'Purchase', 'imported from Master Bill Pass File'),
  ('Parma Impex Pvt. ltd.',                'Black hook Tape', 'Purchase', 'imported from Master Bill Pass File'),
  ('Shree Shyam Packing',                    'Domestic Purchase Matrial', 'Purchase', 'imported from Master Bill Pass File'),
  ('The Agra Weavers',                         'Purchase / Cotton Dhurrie', 'Purchase', 'imported from Master Bill Pass File'),
  ('Veera Industries',                           'Purchase / Kurtis', 'Purchase', 'imported from Master Bill Pass File'),
  ('Vinita Singh',                                 'Block Craft', 'JOB WORK', 'imported from Master Bill Pass File')
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- After running, verify with:
--   SELECT count(*) FROM parties;                          -- was 17, should be 17 - 1 (PRACHI RUGS deleted) + 22 (new) = 38
--   SELECT count(*) FROM purchase_bills WHERE vendor_party_id = (SELECT id FROM parties WHERE name = 'M/S. Prachi Rugs');  -- should be 293 (2 + 291)
