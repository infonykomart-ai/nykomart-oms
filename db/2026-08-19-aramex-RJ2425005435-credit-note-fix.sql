-- 2026-08-19: Aramex RJ2425005435 (Nyko Mart) — credit_note_amt typo fix
--
-- User asked us to check invoice "RJ2422900516" (Aramex's own credit-note
-- document number): "credit note hai 14,077.58 ka or 76824.81 ka payment
-- hua hai koi error ho to clear kar dena" — credit note is ₹14,077.58 and
-- a payment of ₹76,824.81 was made; clear any error.
--
-- Our row for freight invoice RJ2425005435 (Nyko Mart, id
-- 8e8f9d6b-3427-45e4-9188-4cb08eca9ce4) already carries
-- "Credit Note Ref: RJ2422900516" in its own remark, and the one payment
-- row against it (₹76,824.81, 27-Jan-2026, ref PUNBN62026012757104443) is
-- exactly right — but the stored credit_note_amt was ₹14,684.16, not
-- ₹14,077.58. balance_due is a generated column
-- (total_amt - credit_note_amt - total_paid), so that ₹606.58 typo alone
-- produced a spurious -₹606.58 "credit" instead of a clean ₹0.00 settled
-- bill:
--   total_amt 90,902.39 - credit_note_amt 14,684.16 - total_paid 76,824.81 = -606.58 (before)
--   total_amt 90,902.39 - credit_note_amt 14,077.58 - total_paid 76,824.81 =    0.00 (after)
--
-- Confirmed against Aramex's own ledger (EXPORT__20260818T165210.011.xlsx):
-- Document Type DG, Reference RJ2422900516, Document Date 2025-03-28,
-- Amount -14,077.58 exactly. (Aramex's own ledger tags that DG's text to a
-- much older invoice, RJ2422003340 (30-Sep-2024), which isn't in our system
-- at all — part of the already-flagged Sep-2024/Oct-2025 historical gap —
-- but the amount is unambiguous and matches the user's figure and our own
-- remark exactly, so applying it to RJ2425005435 per our own existing
-- remark is correct.)

UPDATE bill_pass_register
SET credit_note_amt = 14077.58
WHERE id = '8e8f9d6b-3427-45e4-9188-4cb08eca9ce4'
  AND coalesce(vendor_invoice_no, invoice_no) = 'RJ2425005435'
  AND credit_note_amt = 14684.16;
