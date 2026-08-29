-- 2026-08-29 (later, same day as the Debit Note rate-difference migration)
-- — "ab esa system credit note ,internal invoice ke liye bhi banao": same
-- Rate Difference Calculator as Debit Note (see
-- db/2026-08-29-debit-note-rate-difference.sql), now for Credit Note's
-- vendor-side ("Party") flow — per the user's own scoping ("credit note po
-- ke against me rahega ye vala, lekin agar kisi party ko bhi issue karna
-- pad gaya to uske hisab se sahi se banao"): the original PO/buyer-refund
-- flow (order_id/buyer_name/item_price/refund_amount) is untouched, this
-- only adds optional reference fields used when a party is selected.
--
-- Unlike debit_notes, credit_notes had NO qty column at all (it only ever
-- tracked a single item_price + a manual refund_amount) — so this adds all
-- three: qty, po_rate (agreed/PO rate), billed_rate (what was actually
-- billed/credited). All nullable and purely informational; refund_amount
-- stays the real manual/required total, same relationship debit_amount has
-- to po_rate/billed_rate on Debit Note.
--
-- Internal Invoice was asked about too, but left unchanged this round — it
-- already auto-computes amount = qty * rate as a generated column, so there
-- is no "manual entry hides the math" problem the way Debit Note/Credit
-- Note had; nothing to fix there.
--
-- Idempotent — safe to run again if it partially applied before.

ALTER TABLE credit_notes
  ADD COLUMN IF NOT EXISTS qty numeric(14,2),
  ADD COLUMN IF NOT EXISTS po_rate numeric(14,2),
  ADD COLUMN IF NOT EXISTS billed_rate numeric(14,2);

COMMENT ON COLUMN credit_notes.qty IS
  'Optional — quantity for the Rate Difference Calculator (vendor-side/Party credit notes only). Purely informational, not used elsewhere.';
COMMENT ON COLUMN credit_notes.po_rate IS
  'Optional — agreed/PO rate per unit, for the Rate Difference Calculator (vendor-side/Party credit notes). Reference only; refund_amount is still the real manual total.';
COMMENT ON COLUMN credit_notes.billed_rate IS
  'Optional — actual billed/credited rate per unit, for the Rate Difference Calculator (vendor-side/Party credit notes). Reference only; refund_amount is still the real manual total.';
