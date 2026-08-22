-- 2026-08-20 — User decisions on the "flagged reconciliation" items left
-- open by claude/nykomart-payments-bank-ledger-reconciliation-round2-
-- 2026-08-19.md and claude/onpoint-express-ledger-reconciliation-
-- 2026-08-18.md. Every item below was an explicit user decision (asked via
-- AskUserQuestion), not a guess — see that round's chat for the exact
-- wording. Verified against live Supabase before writing this file
-- (2026-08-20), not assumed from the docs.
--
-- SURPRISE FINDING while verifying: three of the four flagged items turned
-- out to need NO write at all — they were already correct in the DB. This
-- file only touches what actually needed a change.
--
-- 1. ASHIK ALI (user: "ye Ruksar bano vala hai" — same party as
--    M/s RUKSAR BANO). Checked bill_pass_register: the AS-01/AS-02/AS-15/
--    AS-16/AS-17 bills are ALREADY party_id'd to M/s RUKSAR BANO
--    (aedd05c1-f813-4e15-852c-a915cfcc4963), and all 5 are fully paid
--    (total_paid = total_amt, balance_due = 0). These came from the
--    2026-08-17 Master Bill Pass File import, not the bank-ledger round —
--    "ASHIK ALI" is apparently just how the bank labels payments made out
--    on Ruksar Bano's behalf. NOTHING TO DO HERE — already correct.
--
-- 2. AG/26-27/7 (user: "ag computer se link hona chahiye" — current
--    attachment to A G Computer is correct) and SHIVAM/26-27/7821 (user:
--    "shivam vala ye sahi hai" — current attachment to Shivam Export
--    Fabrics is correct). Both already attached exactly as the user
--    confirmed. NOTHING TO DO HERE either.
--
-- 3. Other 4 uncertain name matches (user: "sab 4 match kar do") — New KR
--    Printer / Veera Industries / R.K. Stone Wash / Shree Shyam Packing.
--    Checked: all 4 bills already exist under the correct (party-master)
--    name, already paid. No re-linking needed. One thing NOT resolved by
--    this: New KR Printer's bank-ledger total (₹12,750, 2 rows) is ₹5,600
--    more than what's on file (₹7,150, 1 bill) — a genuinely new gap the
--    2026-08-19 round never checked for the uncertain-match vendors (its
--    amount-check step only covered the 13 confident matches). NOT fixed
--    here — no per-row bank data available this round to say what the
--    missing bill/payment actually is; flagged back to the user separately.
--
-- 4. SHARDA (user: "international vala rakho" — canonical name should be
--    the fuller one). Section A below renames the party master row.
--
-- 5. On Point Express (user: "dono gaps chalega — dono close kar do" —
--    accept and close both gaps):
--    a. R2526J4826 — bank paid ₹5,053.00 vs ₹4,738.00 on file (+₹315.00).
--       Section B raises total_amt to match what was actually paid.
--    b. R2526J2177 / R2526J2644 combined ₹62,460.00 NEFT (2025-10-31) —
--       R2526J2644's own bill (₹10,460.70) is on file but was showing as
--       UNPAID (total_paid=0) even though the money came in as part of
--       that NEFT. Section C records that payment. R2526J2177 itself has
--       NO bill on file at all, and there's still no source document
--       giving its actual amount — the ₹51,999.30 "remainder" is only an
--       arithmetic leftover (₹62,460.00 − ₹10,460.70), not a confirmed
--       invoice amount, so per the standing rule against guessing
--       reconciliation numbers, NO bill is created for it here. The user's
--       "close it" is treated as "stop chasing the missing document", not
--       as "invent a number" — flagged back to the user in the chat.
--
-- Dry-run tested against the local scratch Postgres (omstest) before
-- delivery.

BEGIN;

-- ============================================================
-- Section A — SHARDA RUGS -> SHARDA INTERNATIONAL RUGS (rename)
-- ============================================================
UPDATE parties
SET name = 'SHARDA INTERNATIONAL RUGS'
WHERE id = 'dd6f0e10-11a3-4f01-9736-7055b2c44c45'
  AND name = 'SHARDA RUGS'
  AND NOT EXISTS (
    SELECT 1 FROM parties WHERE name = 'SHARDA INTERNATIONAL RUGS' AND id <> 'dd6f0e10-11a3-4f01-9736-7055b2c44c45'
  );

-- ============================================================
-- Section B — On Point Express R2526J4826: accept +315.00 bank
-- overpayment, bring the bill's total_amt up to what was actually paid so
-- balance_due (generated: total_amt - credit_note_amt - total_paid) lands
-- back at 0 instead of showing -315.00.
-- ============================================================
UPDATE bill_pass_register
SET total_amt = 5053.00,
    remark = COALESCE(remark, '') ||
      ' | 2026-08-20: bank paid 5,053.00 vs 4,738.00 on file (+315.00) — accepted as reconciled per user decision, total_amt adjusted to match actual payment (see claude/nykomart-payments-bank-ledger-reconciliation-round2-2026-08-19.md).'
WHERE id = 'd5a66d1e-275a-40b4-8bdb-20a7edd74fa3'
  AND invoice_no = 'R2526J4826'
  AND total_amt = 4738.00;

-- ============================================================
-- Section C — On Point Express R2526J2644: record the payment that was
-- always part of the combined 62,460.00 NEFT (2025-10-31) but never
-- entered against this bill (was showing total_paid=0, balance_due=
-- 10,460.70 despite the money already being in). bill_pass_register.
-- total_paid is app-recomputed as SUM(amount) over bill_pass_register_
-- payments (not a DB trigger — see schema.sql's comment on that table),
-- so this file updates it manually the same way the 2026-08-19 Shivam
-- Enterprises fix did.
-- ============================================================
INSERT INTO bill_pass_register_payments (bill_pass_register_id, amount, payment_date, payment_mode, reference_no, remark)
SELECT '726f89c2-30c8-4512-a015-e5fc0bcad3ba', 10460.70, '2025-10-31', 'NEFT', NULL,
  'Part of combined Rs.62,460.00 NEFT (also covered R2526J2177) — split confirmed by user 2026-08-20; remainder Rs.51,999.30 has no bill on file for R2526J2177 (no source document) and was intentionally NOT created — see claude/nykomart-payments-bank-ledger-reconciliation-round2-2026-08-19.md.'
WHERE NOT EXISTS (
  SELECT 1 FROM bill_pass_register_payments
  WHERE bill_pass_register_id = '726f89c2-30c8-4512-a015-e5fc0bcad3ba'
    AND amount = 10460.70
    AND payment_date = '2025-10-31'
);

UPDATE bill_pass_register
SET total_paid = (
  SELECT COALESCE(SUM(amount), 0) FROM bill_pass_register_payments
  WHERE bill_pass_register_id = '726f89c2-30c8-4512-a015-e5fc0bcad3ba'
)
WHERE id = '726f89c2-30c8-4512-a015-e5fc0bcad3ba';

COMMIT;

-- Verification (run after commit):
-- select id, invoice_no, total_amt, total_paid, balance_due, remark from bill_pass_register
--   where id in ('d5a66d1e-275a-40b4-8bdb-20a7edd74fa3','726f89c2-30c8-4512-a015-e5fc0bcad3ba');
-- select name from parties where id = 'dd6f0e10-11a3-4f01-9736-7055b2c44c45';
