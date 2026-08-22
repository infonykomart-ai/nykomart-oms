-- 2026-08-19 — Shivam Enterprises duplicate-payment fix.
--
-- User asked to cross-check the Shivam Enterprises invoice list from
-- NYKOMART_PAYMNETS.xlsx against bill_pass_register. Invoice numbers
-- matched exactly (all 37 present, none missing/extra) but pulling amounts
-- for comparison surfaced 8 invoices where total_paid is exactly DOUBLE
-- total_amt. Root cause, confirmed live via Supabase (each of the 8 has
-- exactly two bill_pass_register_payments rows for the identical amount):
--   1. One entered manually through the app, remark "Full Payment",
--      payment_date 2026-08-12 — a real staff action.
--   2. One from the older bulk NYKO-PNB bank-ledger import, remark
--      "AGAINST BILL [Imported from NYKO-PNB SR ...]" — that import
--      resolved purely by invoice_no with no check for an existing
--      payment already on file, so it re-recorded the same real payment
--      a second time.
-- Same underlying class of bug as db/2026-08-17-dedupe-payment-import.sql
-- addressed elsewhere, just not caught for these 8 rows at the time.
--
-- Fix approach: per the user's request, this does NOT delete either
-- payment row (no history erased — both stay, so anyone auditing later
-- can still see the duplicate that happened). Tried adding a negative
-- "difference" row to bill_pass_register_payments to document the
-- correction inline in the payments audit trail, but that table has
-- `amount numeric(14,2) NOT NULL CHECK (amount > 0)` — negative/adjustment
-- rows aren't representable there by design (caught by the dry run below,
-- not guessed). So the difference entry instead goes into the bill's own
-- `remark` field, appended (not replacing the existing remark), and
-- total_paid is brought back down to total_amt (total_paid is a plain
-- stored value here, not something the app recomputes from the payments
-- rows — see BRAIN.md — so it has to be updated explicitly).
--
-- Guarded so it only touches a row if total_paid is currently exactly
-- 2x total_amt (the exact signature of this bug) — safe to run more than
-- once; the second run will find total_paid already back at total_amt and
-- do nothing.

BEGIN;

UPDATE bill_pass_register b
SET total_paid = b.total_amt,
    remark = coalesce(b.remark || ' | ', '') || 'Difference entry 2026-08-19: duplicate payment found — ' || b.total_amt::text || ' was recorded twice (once as "Full Payment" 2026-08-12, once via NYKO-PNB bank-ledger bulk import), total_paid corrected from ' || (b.total_amt * 2)::text || ' back to ' || b.total_amt::text || '. Both original payment rows kept for audit — see bill_pass_register_payments.'
FROM parties p, companies c
WHERE p.id = b.party_id AND c.id = b.company_id
AND c.name = 'Nyko Mart' AND p.name = 'Shivam Enterprises'
AND b.invoice_no IN ('INV/26-27/423','INV/26-27/436','INV/26-27/450','INV/26-27/468','INV/26-27/479','INV/26-27/483','INV/26-27/489','INV/26-27/493')
AND b.total_paid = b.total_amt * 2;

COMMIT;

-- Verify after running:
-- select invoice_no, total_amt, total_paid, balance_due from bill_pass_register b
-- join parties p on p.id=b.party_id join companies c on c.id=b.company_id
-- where c.name='Nyko Mart' and p.name='Shivam Enterprises'
-- and invoice_no in ('INV/26-27/423','INV/26-27/436','INV/26-27/450','INV/26-27/468','INV/26-27/479','INV/26-27/483','INV/26-27/489','INV/26-27/493');
-- Expect: total_paid = total_amt, balance_due = 0.00 for all 8.
