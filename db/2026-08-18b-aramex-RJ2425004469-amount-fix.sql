-- 2026-08-18 — user confirmed via chat: "RJ2425004469 ka acutual invoice
-- value 96644.22 hai typing mistake hua hai vo usko sahi karo". This is
-- the amount mismatch flagged in db/2026-08-18-aramex-ledger-
-- reconciliation.sql's header comment (bill e89bbdfe-041b-4756-8317-
-- 17ce6d3b6d99, Nyko Mart, ref RJ2425004469) — it was recorded at
-- Rs.46,644.22 (typo) instead of Aramex's own real invoice total of
-- Rs.96,644.22. total_paid stays at Rs.46,644.22 (that part was already
-- confirmed genuine — matches a real Aramex NEFT receipt dated
-- 31-Oct-2025, UTR PUNBN62025103155492378, already applied in the prior
-- file) — only the bill's own total_amt was wrong. balance_due
-- (generated column) will recompute itself from 0 to Rs.50,000.00.
--
-- Idempotent — targets one fixed id; re-running just re-sets the same
-- value.
UPDATE bill_pass_register
SET total_amt = 96644.22
WHERE id = 'e89bbdfe-041b-4756-8317-17ce6d3b6d99'
  AND coalesce(vendor_invoice_no, invoice_no) = 'RJ2425004469';

-- Verify after running:
-- select id, invoice_no, total_amt, total_paid, balance_due
-- from bill_pass_register where id = 'e89bbdfe-041b-4756-8317-17ce6d3b6d99';
-- Expected: total_amt 96644.22, total_paid 46644.22, balance_due 50000.00
