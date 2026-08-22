-- 2026-08-18 — "hear is the on point express ladger data, check all bill
-- entry & make every party ledger according this": user uploaded On Point
-- Express's own account statement (Ledger 1.xls, Customer Code
-- NYKOMARTJ1, period 01-Oct-2025 to 31-Aug-2026). Reconciled every line of
-- it against bill_pass_register (party_id = On Point Express) before
-- writing this file — see claude/onpoint-express-ledger-reconciliation-
-- 2026-08-18.md in the project for the full writeup.
--
-- Method: the vendor's own statement groups its 74 individual AWB-level
-- freight charges into 11 batches via a "Sender" reference code (e.g.
-- R2526J2644) — this is the SAME code already used as vendor_invoice_no
-- on every existing bill_pass_register row for this party, so batches are
-- matched to our rows by exact vendor_invoice_no match.
--
-- Result: 7 of 11 real batches are already in our system and match the
-- vendor's own totals to within a few rupees (pre-existing rounding, not
-- touched here). 4 real batches are MISSING from our system entirely —
-- this file adds them, using each batch's own last shipment date as the
-- invoice date and the vendor's own summed total as total_amt (payments
-- against these are NOT guessed — the vendor's 36 "Amount Rcvds" lines are
-- NOT allocated to specific invoices in their own statement, so entering a
-- paid amount here would be inventing data; total_paid is left at its
-- default 0, same as any newly-entered pending bill, to be paid down
-- through the normal Bill Payment screen).
--
-- NOT included in this file, flagged separately for manual review instead
-- (see the project doc): bill_pass_register already has ONE row,
-- vendor_invoice_no = 'R2526J4435', invoice_date 2026-01-31, total_amt
-- 18,326.00, that does NOT correspond to ANY batch/reference code
-- anywhere in the vendor's own ledger — grepped the full sheet, genuinely
-- not there. This might be a mistyped reference for a real invoice, a
-- duplicate, or a bill from a different source altogether; deleting or
-- editing real money data without knowing which is not something to guess
-- at, so it's left as-is here.
--
-- Idempotent — the WHERE NOT EXISTS guard means re-running this is a
-- no-op if the rows are already present.

-- due_date is a GENERATED column (invoice_recv_date + 7) — not settable
-- directly, computes itself from invoice_recv_date below.
INSERT INTO bill_pass_register
  (company_id, party_id, party_type, invoice_type, vendor_invoice_no, invoice_date, invoice_recv_date, total_amt)
SELECT v.company_id, v.party_id, v.party_type, v.invoice_type, v.vendor_invoice_no, v.invoice_date, v.invoice_date, v.total_amt
FROM (
  VALUES
    -- (vendor_invoice_no, invoice_date = batch's last shipment date, total_amt = vendor's own summed batch total)
    ('d1b13f6d-10ad-4997-b38b-143b042c0aa6'::uuid, '00bcf3f8-cc58-4596-9767-addae3e664d4'::uuid, 'Courier /international shipping', 'FREIGHT INVOICE'::invoice_type, 'R2526J2644', '2025-10-07'::date, 10460.70::numeric),
    ('d1b13f6d-10ad-4997-b38b-143b042c0aa6'::uuid, '00bcf3f8-cc58-4596-9767-addae3e664d4'::uuid, 'Courier /international shipping', 'FREIGHT INVOICE'::invoice_type, 'R2526J2941', '2025-10-31'::date, 31457.62::numeric),
    ('d1b13f6d-10ad-4997-b38b-143b042c0aa6'::uuid, '00bcf3f8-cc58-4596-9767-addae3e664d4'::uuid, 'Courier /international shipping', 'FREIGHT INVOICE'::invoice_type, 'R2526J3141', '2025-11-11'::date, 31739.64::numeric),
    ('d1b13f6d-10ad-4997-b38b-143b042c0aa6'::uuid, '00bcf3f8-cc58-4596-9767-addae3e664d4'::uuid, 'Courier /international shipping', 'FREIGHT INVOICE'::invoice_type, 'R2526J3157', '2025-11-25'::date, 50643.24::numeric)
) AS v(company_id, party_id, party_type, invoice_type, vendor_invoice_no, invoice_date, total_amt)
WHERE NOT EXISTS (
  SELECT 1 FROM bill_pass_register bpr
  WHERE bpr.party_id = v.party_id AND bpr.vendor_invoice_no = v.vendor_invoice_no
);

-- Verify after running:
-- SELECT vendor_invoice_no, invoice_date, total_amt FROM bill_pass_register
-- WHERE party_id = '00bcf3f8-cc58-4596-9767-addae3e664d4' ORDER BY invoice_date;
-- Expected: 12 rows total (8 existing + 4 new), summing to ~313,943.24 in
-- total_amt (still short of the vendor's real 369,574.99 by the R2526J4435
-- mismatch above — that gap is the flagged row, not a new omission).
