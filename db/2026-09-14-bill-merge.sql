-- 2026-09-14 — "AGAR ESE KOI INVOICE AAYE TO USKO MERGE KARNE KA OPTION
-- BANANA HAI" (the cross-company merge from the earlier request: "jab
-- purchase ki entry hoti hai to teeno company ke bill register me jata hai
-- ... same party same invoice no but show 3 entry ek merge karne ka option
-- ho jis se invoice or party name same rahe baki jo payment hai vo jud ke
-- aajaye").
--
-- WHAT A MERGE IS HERE: the SAME vendor invoice (same party + same
-- vendor_invoice_no + same invoice_type, e.g. Purchase) legitimately lands
-- as SEPARATE bill_pass_register rows under DIFFERENT companies (Nyko
-- Mart / Rugara / CASA ARRA split the same vendor document). Each row
-- carries its own payments. "Merge" = pick one row as the KEEPER, move
-- every other row's payments onto it (total_paid then recomputes via the
-- app's recompute-from-ledger pattern), tag the losers with
-- merged_into_bill_id, and NET THEIR total_amt TO ZERO so their
-- balance_due (= total_amt - credit_note_amt - adj_amt - total_paid,
-- GENERATED) becomes 0 and they drop out of every unpaid-bill view
-- without ever being deleted (audit trail stays intact — the same
-- "never hard-delete a money row" rule the rest of the schema follows).
--
-- The KEEPER's id (and therefore its /dashboard/bill-payment URL) never
-- changes, so existing links keep working; the payments table is untouched
-- (payments are real documents, not copies — they just get re-pointed).
--
-- NOTE: total_amt (not balance_due/total_paid) is what the app writes on
-- losers — to_be_pay and balance_due are GENERATED ALWAYS AS ... STORED
-- columns and reject direct writes. This zeroing is exactly what makes a
-- merged row invisible to `.gt("balance_due", 0)` page filters.
--
-- Idempotent: safe to run twice.

ALTER TABLE bill_pass_register
  ADD COLUMN IF NOT EXISTS merged_into_bill_id uuid REFERENCES bill_pass_register(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_bpr_merged_into ON bill_pass_register(merged_into_bill_id)
  WHERE merged_into_bill_id IS NOT NULL;

-- Sanity check: should return 0 rows on a fresh DB.
SELECT count(*) FROM bill_pass_register WHERE merged_into_bill_id IS NOT NULL;
