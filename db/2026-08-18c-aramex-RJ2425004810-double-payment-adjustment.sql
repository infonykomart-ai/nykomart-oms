-- 2026-08-18 — user uploaded both PNB NEFT payment confirmation PDFs and
-- confirmed via chat: "RJ2425004810 is bill ke against me do baar payment
-- hua tha 05-11-2025 ref 5229719723 [aur] ref 5233324469 vali entry
-- adjustment dikhao". This resolves the ambiguous-payment flag from
-- db/2026-08-18-aramex-ledger-reconciliation.sql's header comment (bill
-- 374b17de-ddca-454c-95ca-432cc6af2771, ref RJ2425004810, Rs.46,862.83) —
-- that file found TWO real Aramex-side receipts of this exact amount
-- (05-Nov-2025 and 28-Nov-2025) and couldn't tell which paid this bill
-- without the bank's own record. The two uploaded PNB slips answer that:
-- BOTH NEFTs were sent with remark "INVOICE-RJ2425004810" — this single
-- bill was genuinely paid twice, Rs.93,725.66 total against a
-- Rs.46,862.83 bill.
--
--   Reference ID 5229719723 — 05-11-2025 — Rs.46,862.83 (the correct,
--     first payment; already reflected in bill_pass_register.total_paid)
--   Reference ID 5233324469 — 28-11-2025 — Rs.46,862.83 (the SECOND,
--     excess payment — not yet recorded anywhere; this file adds it)
--
-- reference_no below uses PNB's own "Reference ID" from the two uploaded
-- slips (our outgoing-NEFT reference), not Aramex/HSBC's incoming-credit
-- UTR ("PUNBN...") used elsewhere in the prior file — both identify the
-- same real transfer, this is simply the reference the user gave and it
-- is the more authoritative one since it's our own bank's record.
--
-- No dedicated "vendor advance" table exists in this schema (only
-- employee_advances, which is staff-specific) — so per this table's own
-- design (bill_pass_register.total_paid = SUM(bill_pass_register_payments)
-- for that bill, balance_due = total_amt - credit_note_amt - total_paid,
-- both auto/generated), the excess payment is recorded as a SECOND
-- payment row against the SAME bill. This deliberately drives
-- balance_due to -46,862.83 (a credit/advance with Aramex, not an error)
-- — it naturally drops off the Bill Payment outstanding list
-- (.gt(balance_due, 0)) since it's genuinely not due, and shows up
-- correctly on the Party Ledger page's chronological running balance as
-- the "adjustment" the user asked to see: two Credit lines against the
-- one Debit line, running balance going negative, then netting back up
-- against whichever of Aramex's future bills it gets applied to.
--
-- Idempotent — the INSERT is guarded by NOT EXISTS on this exact
-- reference_no, the UPDATEs target fixed ids/values.

-- 1) Tag the first (correct) payment with its real bank reference — this
-- row already carries the right date (2025-11-05) and amount.
UPDATE bill_pass_register_payments
SET reference_no = '5229719723'
WHERE id = '777f214d-cf54-4270-a076-0dba3e292f57';

-- 2) Add the second (excess) payment.
INSERT INTO bill_pass_register_payments
  (bill_pass_register_id, amount, payment_date, payment_mode, reference_no, remark)
SELECT '374b17de-ddca-454c-95ca-432cc6af2771', 46862.83, '2025-11-28', 'NEFT', '5233324469',
       'Second NEFT sent against this same invoice (see PNB slip, remark '
       || '"INVOICE- RJ2425004810") — excess/duplicate payment, Rs.46,862.83 '
       || 'credit with Aramex to be adjusted against a future bill.'
WHERE NOT EXISTS (
  SELECT 1 FROM bill_pass_register_payments
  WHERE bill_pass_register_id = '374b17de-ddca-454c-95ca-432cc6af2771'
    AND reference_no = '5233324469'
);

-- 3) Recompute total_paid from the payments ledger, same convention the
-- app itself uses (src/app/dashboard/bill-payment/actions.ts) — never
-- hand-set a total that could drift from the itemized rows.
UPDATE bill_pass_register
SET total_paid = (
  SELECT COALESCE(SUM(amount), 0) FROM bill_pass_register_payments
  WHERE bill_pass_register_id = '374b17de-ddca-454c-95ca-432cc6af2771'
)
WHERE id = '374b17de-ddca-454c-95ca-432cc6af2771';

-- Verify after running:
-- select b.total_amt, b.total_paid, b.balance_due,
--        p.amount, p.payment_date, p.reference_no, p.remark
-- from bill_pass_register b
-- join bill_pass_register_payments p on p.bill_pass_register_id = b.id
-- where b.id = '374b17de-ddca-454c-95ca-432cc6af2771'
-- order by p.payment_date;
-- Expected: total_amt 46862.83, total_paid 93725.66, balance_due
-- -46862.83; 2 payment rows, refs 5229719723 (05-11-2025) and 5233324469
-- (28-11-2025).
