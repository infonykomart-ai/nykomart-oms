-- 2026-08-18 — data repair for "why to cannot update": editing AF/145's
-- Purchase Bill (Casa Arra / Aaradhya Fabrics) was working correctly on
-- purchase_bills itself, but the mirrored Finance-ledger row in
-- bill_pass_register (the one Bill Payment and the new Party Ledger read
-- from) was never re-synced on edit — a bug in updatePurchaseBill, now
-- fixed in code (src/app/dashboard/documents/actions.ts). This file is the
-- one-time repair for rows that already went stale before that code fix
-- landed.
--
-- Root cause (2 bugs, both now fixed in code):
--  1. The Finance-ledger mirror was created using purchase_bills.total_amount
--     (the PRE-GST base) instead of g_total_plus_gst (base + GST +
--     round_off_amt, the real amount owed to the vendor) — understated
--     every GST-bearing Purchase Bill's Finance-ledger total by the GST
--     amount.
--  2. Editing a Purchase Bill (updatePurchaseBill) never touched the
--     mirror row at all, so any correction made via Edit (fixing a typo'd
--     qty/rate, adding GST, etc.) silently never reached Bill Payment /
--     Party Ledger — this is exactly why AF/145 kept showing a huge
--     stale balance (₹1,18,667.58) no matter how many times it was
--     edited and re-saved.
--
-- This UPDATE re-syncs every bill_pass_register row sourced from a
-- purchase_bills row to that bill's CURRENT g_total_plus_gst. Checked live
-- before writing this: only ONE row is currently out of sync (AF/145,
-- 118667.58 -> 37978.29, total_paid is 0 so this only corrects the
-- outstanding balance shown, doesn't touch any payment history). Safe to
-- run again — the WHERE clause makes a second run a no-op.

UPDATE bill_pass_register bpr
SET total_amt = pb.g_total_plus_gst
FROM purchase_bills pb
WHERE bpr.source = 'purchase_bill'
  AND bpr.source_id = pb.id
  AND bpr.total_amt IS DISTINCT FROM pb.g_total_plus_gst;
