-- 2026-08-18 — "aramex ka ladger hai to pahle match karo ki sahi hai kya phir
-- jo entry apne pass hai usme utr ref & payment date update karo phir
-- duplicate check karo phir batao kitna pending bach raha hai": user
-- uploaded Aramex's own account statement (EXPORT_20260818T165210.011.xlsx,
-- Account JAI10870, period 30-Sep-2024 to 31-Jul-2026, SAP-style export:
-- Document Type RV/DR = invoice/duty debit note, DZ = payment, DG = reversal).
-- Reconciled every line against bill_pass_register (party_id = Aramex,
-- 9b187176-e289-47cf-b55e-7d8673eb3025) — see
-- claude/aramex-ledger-reconciliation-2026-08-18.md in the project for the
-- full writeup.
--
-- Method: same as On Point Express (2026-08-18 earlier round) — match by
-- the vendor's own reference code (e.g. RJ2425006782). Aramex's rows store
-- this in EITHER bill_pass_register.vendor_invoice_no OR .invoice_no
-- depending on which historical import created the row ("Master Bill Pass
-- File" import vs "NYKO-PNB bank ledger" import), so both columns were
-- checked. Every payment in bill_pass_register_payments for this party was
-- entered with payment_mode='NEFT', reference_no=NULL, and a payment_date
-- that's really just the invoice/import date, not the real bank transfer
-- date — Aramex's own DZ (payment) lines aren't tagged to a specific
-- invoice either (same as On Point Express's "Amount Rcvds" lines), so
-- matching had to be done by DATE + SUM: several of our per-invoice
-- payment rows sharing one payment_date turned out to be one single real
-- NEFT transfer that was split across invoices internally — confirmed
-- exact-match (to the rupee) against one real Aramex DZ line in every case
-- below.
--
-- Result of matching (27 bill_pass_register rows total for this party):
--  - 24 bills confirmed correct (reference + amount match Aramex's own
--    ledger exactly).
--  - 1 TRUE DUPLICATE: vendor ref RJ2425006240 (Duty Charges for Nov-25,
--    Rs.1,958.67) exists as TWO separate bill_pass_register rows — one
--    under Nyko Mart (id 4538f19c-c47d-4893-8a69-1aa6aea4868c, entered via
--    vendor_invoice_no), one under Rug Ara (id
--    7d9da494-804d-449a-b93a-305b415a0780, entered via invoice_no from the
--    "Master Bill Pass File" import, remark "Payment note: Paid
--    27-Jan-2026 | Remark: PAID"). User confirmed by chat: keep the Nyko
--    Mart row, delete the Rug Ara row (Section 1 below). Its matching
--    payment row (0ed8188f-55b5-4623-8448-374dae78d7c7, Rs.1,958.67) is
--    deleted automatically via bill_pass_register_payments' ON DELETE
--    CASCADE — not a separate statement.
--  - 1 AMOUNT MISMATCH, NOT fixed here: Nyko Mart row
--    e89bbdfe-041b-4756-8317-17ce6d3b6d99 (vendor ref RJ2425004469,
--    remark "Imported from NYKO-PNB bank ledger (SR 10)") is recorded as
--    Rs.46,644.22 and marked fully paid. Aramex's own ledger shows this
--    invoice (RV, 07-Oct-2025) as Rs.96,644.22 — exactly Rs.50,000 more.
--    The Rs.46,644.22 DOES exactly match a real Aramex payment received
--    31-Oct-2025 (UTR PUNBN62025103155492378, see Section 2), so the
--    PAYMENT side is genuine — it's the BILL's own total_amt that looks
--    short by Rs.50,000 (likely the payment amount got entered as the
--    invoice amount during the bank-ledger import, rather than the real
--    invoice total). NOT corrected here — changing a bill's total_amt
--    on real, already-part-paid data needs your confirmation first. If
--    confirmed, the fix would be `UPDATE bill_pass_register SET
--    total_amt = 96644.22 WHERE id =
--    'e89bbdfe-041b-4756-8317-17ce6d3b6d99'` (this would raise its
--    balance_due from 0 to 50,000.00).
--  - 1 UNIDENTIFIED, NOT fixed here: Rug Ara row
--    cc7664c2-ba24-4c62-a3b3-62842bafb37a (invoice_no RJ2425007905,
--    Rs.41,848.85, remark "...[imported from Master Bill Pass File]")
--    does not correspond to ANY reference/amount anywhere in Aramex's own
--    ledger — grepped the full sheet, genuinely not there. Same posture
--    as On Point Express's R2526J4435: might be a mistyped reference, a
--    duplicate under a wrong ref, or from a different source entirely —
--    left as-is, flagged for manual review. This is currently Rug Ara's
--    ENTIRE outstanding Aramex balance (Rs.41,848.85) after the Section 1
--    delete below.
--  - 1 AMBIGUOUS payment match, NOT fixed here: bill RJ2425004810
--    (374b17de-ddca-454c-95ca-432cc6af2771, Rs.46,862.83) has a payment
--    row of the same amount, but Aramex's ledger shows TWO separate real
--    payments of exactly Rs.46,862.83 nine days apart (05-Nov-2025, UTR
--    PUNBN62025110556644305; and 28-Nov-2025, UTR
--    PUNBN62025112852404226) — since Aramex's own ledger doesn't tag
--    payments to invoices, there's no way to tell which of the two
--    actually paid this bill without your bank statement. Left
--    reference_no/payment_date unset on this one payment row rather than
--    guess; see the project doc for both candidates.
--
-- Section 2 below updates reference_no (real bank UTR) and payment_date
-- (real transfer date, not the invoice/import date it was defaulted to)
-- on the 20 payment rows that DO have one unambiguous real-money match —
-- every one confirmed to the rupee against Aramex's own DZ ledger lines,
-- several by matching a same-day SUM across multiple our-side rows
-- against one real NEFT transfer.
--
-- Idempotent — Section 1's DELETE targets one fixed id (harmless to
-- re-run, second run just deletes 0 rows); Section 2's UPDATEs all target
-- fixed payment ids with the same values either way.

-- ============================================================
-- SECTION 1 — delete the Rug Ara duplicate of RJ2425006240
-- (confirmed live via chat: "ye bil sirf nyko me rakho rugara se delet
-- karo"). Cascades to delete its payment row automatically.
-- ============================================================
DELETE FROM bill_pass_register
WHERE id = '7d9da494-804d-449a-b93a-305b415a0780'
  AND coalesce(vendor_invoice_no, invoice_no) = 'RJ2425006240'
  AND total_amt = 1958.67;

-- ============================================================
-- SECTION 2 — backfill real UTR reference + real payment date on
-- existing bill_pass_register_payments rows (currently NEFT / NULL ref /
-- payment_date defaulted to the invoice date).
-- ============================================================

-- RJ2425004631 — Aramex DZ 03-Nov-2025, UTR PUNBN62025110356035773
UPDATE bill_pass_register_payments
SET reference_no = 'PUNBN62025110356035773', payment_date = '2025-11-03'
WHERE id = '5010fd59-6f0e-4ccc-8ea8-fceb4571030a';

-- RJ2425004469 — Aramex DZ 31-Oct-2025, UTR PUNBN62025103155492378
-- (date already correct; only the UTR was missing)
UPDATE bill_pass_register_payments
SET reference_no = 'PUNBN62025103155492378'
WHERE id = '809f8312-e5a8-4b3e-82dd-6ce33e675123';

-- RJ2425005931 + RJ2425006240(Nyko copy) + RJ2425005611 + RJ2425005435 —
-- these 4 rows (all dated 2026-01-27) are one single real Aramex NEFT of
-- Rs.91,635.61 (1034.74+1958.67+11817.39+76824.81 = 91635.61 exactly),
-- UTR PUNBN62026012757104443. Date already correct; only UTR was missing.
UPDATE bill_pass_register_payments
SET reference_no = 'PUNBN62026012757104443'
WHERE id IN (
  '11437bbc-d4b3-4e5e-a6f3-f9b31a8bd57c',
  '327f6748-060a-42cc-8fc8-2768721e6daa',
  '6a53be42-2eca-4b81-ae79-5f64dbcaf8df',
  '219db751-be19-40bd-9de2-d11f3ffe0cdd'
);

-- RJ2425006782 + RJ2425007226 + RJ2425006685 — one real NEFT of
-- Rs.76,444.26 (2500.39+73224.51+719.36 = 76444.26 exactly), dated
-- 25-Feb-2026, UTR PUNBN62026022554913432. Date already correct.
UPDATE bill_pass_register_payments
SET reference_no = 'PUNBN62026022554913432'
WHERE id IN (
  '92e99ff5-f497-446f-a384-42b4c873036b',
  '8cc97f5a-5fa7-437a-9df4-45ae27eae561',
  '8944aa89-d9e9-4dd9-ae6f-8cb9ebe0a562'
);

-- RJ2425007035 — Aramex DZ 23-Mar-2026, UTR PUNBN62026032351743221
-- (date already correct; only the UTR was missing)
UPDATE bill_pass_register_payments
SET reference_no = 'PUNBN62026032351743221'
WHERE id = '9acc711c-582f-4497-8ab2-4ccf22baae9d';

-- RJ2425007931 + RJ2425007778 + RJ2425007697 + RJ2425007777 +
-- RJ2425007696 — one real NEFT of Rs.95,404.13
-- (47596.52+1060.73+5417.65+7963.32+33365.91 = 95404.13 exactly), dated
-- 18-May-2026, UTR PUNBN62026051855861124. Date already correct.
UPDATE bill_pass_register_payments
SET reference_no = 'PUNBN62026051855861124'
WHERE id IN (
  '2eb1fb38-0cc7-42e4-9bfc-c709cef41df0',
  '18c3a5a9-beb7-4a6a-85a0-f18f30eb090c',
  '2dd9319b-bdbb-4000-82b8-08e2f1a2ee7c',
  '0a58910b-2d65-42e7-8638-81703035e7f1',
  'a8d90005-7218-4a44-97f3-7763ef374c13'
);

-- RJ2425007430 part-1 — Aramex DZ 25-May-2026, UTR
-- PUNBN62026052356960618 (our system had this dated 23-May-2026, 2 days
-- off — corrected here too).
UPDATE bill_pass_register_payments
SET reference_no = 'PUNBN62026052356960618', payment_date = '2026-05-25'
WHERE id = '346982c8-cffc-41e3-bae1-26f886e5f0aa';

-- RJ2425007430 part-2 + RJ2425007578 + RJ2425007577 — one real NEFT of
-- Rs.68,543.49 (36610.82+11311.59+20621.08 = 68543.49 exactly), dated
-- 25-May-2026, UTR PUNBN62026052557274062. Date already correct.
UPDATE bill_pass_register_payments
SET reference_no = 'PUNBN62026052557274062'
WHERE id IN (
  '6bfbce03-2785-44a4-b164-4ef6e7f45310',
  '58090ac1-8a18-4be3-8b7f-dc38ad33b785',
  '6312dfcf-03cf-494c-9a18-e51f8cc30edd'
);

-- Verify after running:
-- select p.id, b.invoice_no, b.vendor_invoice_no, p.amount, p.payment_date,
--        p.reference_no
-- from bill_pass_register_payments p
-- join bill_pass_register b on b.id = p.bill_pass_register_id
-- where b.party_id = '9b187176-e289-47cf-b55e-7d8673eb3025'
-- order by p.payment_date;
-- Expected: 20 rows (Rug Ara duplicate's payment row is gone via cascade),
-- every row has a non-NULL reference_no starting with 'PUNBN...' except
-- 374b17de-ddca-454c-95ca-432cc6af2771's payment (left NULL — ambiguous,
-- see header comment).
