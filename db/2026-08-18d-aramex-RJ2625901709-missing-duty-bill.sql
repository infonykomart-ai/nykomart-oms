-- 2026-08-18 — user uploaded an order-level Aramex duty breakdown
-- (New_Microsoft_Excel_Worksheet_3.xlsx: PO NO./ORDER NO./INVOICE NO./
-- BUYER/COURIER/AWB/DUTY & TAX MODE/amounts, 5 order rows across 3 duty
-- bill references) and said "ye aramex ki duty ki detail hai, sql".
--
-- Cross-checked all 3 refs in this file against bill_pass_register:
--   RJ2625901456 (1 order, Gross Total 950.77)  -> already in our system
--     (id 5e20147d-82b4-4609-af4f-90b2911d9b13), amount matches exactly.
--   RJ2625901457 (2 orders, 301.77+315.96=617.73) -> already in our system
--     (id 9e35ae5b-3a40-4db7-a0b9-0dfc86787592), amount matches exactly.
--   RJ2625901709 (2 orders, 329.21+329.21=658.42) -> MISSING. This is the
--     exact gap already flagged in the "49 missing entries" list delivered
--     earlier today (Aramex-Missing-Entries-2026-08-18.xlsx) — that file's
--     recent-tail note said RJ2625901709 (₹658.42, Duty Charges for Jun-26,
--     08-Jul-2026) looked like a genuinely new/not-yet-entered bill. This
--     upload confirms it with real order-level backing: 2 US orders
--     (NL-75-26-27 / NL-76-26-27, both Nyko Mart per the "NL" store
--     prefix), Aramex AWBs 37265028695 / 37265029756, DDP mode,
--     duty+tax USD 3.66 each -> INR 329.21 each, 0 GST both (courier
--     disbursement fee not itemized here, matching how every other
--     Aramex duty row already in the system was entered).
--
-- Only RJ2625901709 is added here — the other 2 refs in the uploaded file
-- are confirmed correct already and untouched.
--
-- Idempotent — WHERE NOT EXISTS guard, matches every prior file's pattern
-- this session.
INSERT INTO bill_pass_register
  (company_id, party_id, party_type, invoice_type, vendor_invoice_no, invoice_date, invoice_recv_date, total_amt)
SELECT 'd1b13f6d-10ad-4997-b38b-143b042c0aa6'::uuid, '9b187176-e289-47cf-b55e-7d8673eb3025'::uuid,
       'Courier', 'DUTY TAX'::invoice_type, 'RJ2625901709', '2026-07-08'::date, '2026-07-08'::date, 658.42::numeric
WHERE NOT EXISTS (
  SELECT 1 FROM bill_pass_register
  WHERE party_id = '9b187176-e289-47cf-b55e-7d8673eb3025'
    AND coalesce(vendor_invoice_no, invoice_no) = 'RJ2625901709'
);

-- Verify after running:
-- select vendor_invoice_no, invoice_date, total_amt, balance_due
-- from bill_pass_register
-- where party_id = '9b187176-e289-47cf-b55e-7d8673eb3025'
--   and vendor_invoice_no = 'RJ2625901709';
-- Expected: 1 row, total_amt 658.42, balance_due 658.42 (no payment made
-- against it yet — it isn't in Aramex's own payment-received ledger
-- either, since it's a very recent bill).
