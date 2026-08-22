-- 2026-08-19 — Shivam Enterprises duplicate-payment fix, v2 (supersedes
-- 2026-08-19-shivam-enterprises-duplicate-payment-fix.sql).
--
-- The first fix (v1) deliberately kept BOTH duplicate payment rows and only
-- corrected total_paid + the bill's remark — reasoning that total_paid is
-- what balance_due is generated from, so that alone would fix the "is this
-- overpaid" number. User then pasted the Party Ledger view
-- (src/app/dashboard/parties/[id]/ledger/page.tsx) for this party and
-- pointed out it STILL showed both the 2026-08-12 "Full Payment" line and
-- the 2026-12-08 "[Imported from NYKO-PNB SR ...]" line for all 8 invoices,
-- each still deducting from the running balance — because that page reads
-- bill_pass_register_payments directly (one ledger line per payment row,
-- see lines 78-90 and 145-152 of that file) and never looks at total_paid
-- at all. So v1's fix was invisible on the one screen that actually matters
-- here. User confirmed live: "ye dec vali hatao" — delete the 2026-12-08
-- (bulk-import) row, keep the 2026-08-12 (real, manually-entered) one.
--
-- This version actually deletes the 8 duplicate 2026-12-08 rows (remark
-- 'AGAINST BILL [Imported from NYKO-PNB SR%', the bulk-import ones) and
-- keeps total_paid = total_amt (same correct value v1 already set — this
-- re-applies it too, in case v1 was never run and this is run standalone).
--
-- Guarded to only delete a row that (a) matches the exact duplicate
-- signature (remark prefix + payment_date) and (b) belongs to one of these
-- 8 invoices — safe to run more than once; the second run deletes 0 because
-- the row is already gone.

BEGIN;

DELETE FROM bill_pass_register_payments bp
USING bill_pass_register b, parties p, companies c
WHERE bp.bill_pass_register_id = b.id
AND p.id = b.party_id AND c.id = b.company_id
AND c.name = 'Nyko Mart' AND p.name = 'Shivam Enterprises'
AND b.invoice_no IN ('INV/26-27/423','INV/26-27/436','INV/26-27/450','INV/26-27/468','INV/26-27/479','INV/26-27/483','INV/26-27/489','INV/26-27/493')
AND bp.remark LIKE 'AGAINST BILL [Imported from NYKO-PNB SR%'
AND bp.payment_date = '2026-12-08';

UPDATE bill_pass_register b
SET total_paid = b.total_amt
FROM parties p, companies c
WHERE p.id = b.party_id AND c.id = b.company_id
AND c.name = 'Nyko Mart' AND p.name = 'Shivam Enterprises'
AND b.invoice_no IN ('INV/26-27/423','INV/26-27/436','INV/26-27/450','INV/26-27/468','INV/26-27/479','INV/26-27/483','INV/26-27/489','INV/26-27/493')
AND b.total_paid <> b.total_amt;

COMMIT;

-- Verify after running (Party Ledger for Shivam Enterprises should now show
-- exactly ONE "Payment against INV/26-27/xxx" line per invoice, dated
-- 2026-08-12, and the running balance should no longer dip twice for these):
-- select b.invoice_no, b.total_amt, b.total_paid, b.balance_due, bp.payment_date, bp.remark
-- from bill_pass_register b join parties p on p.id=b.party_id join companies c on c.id=b.company_id
-- left join bill_pass_register_payments bp on bp.bill_pass_register_id = b.id
-- where c.name='Nyko Mart' and p.name='Shivam Enterprises'
-- and b.invoice_no in ('INV/26-27/423','INV/26-27/436','INV/26-27/450','INV/26-27/468','INV/26-27/479','INV/26-27/483','INV/26-27/489','INV/26-27/493')
-- order by b.invoice_no;
-- Expect: exactly 1 payment row per invoice (2026-08-12, "Full Payment"), total_paid = total_amt, balance_due = 0.00.
