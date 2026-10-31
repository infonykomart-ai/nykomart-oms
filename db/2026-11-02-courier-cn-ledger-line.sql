-- 2026-11-02 — COURIER / DUTY BILL KA CREDIT NOTE LEDGER ME DEBIT LINE BANE
--
-- WHY
--   User: "creditnote ka ammout debit kyu nahi hua isme, ye kaha kaha problm
--   hai solve kar ke updated file do" (screenshot: Courier Bill 276437655,
--   gross ₹342842.63, CN CNINTRJ000042030 −₹26337.30). The ledger showed ONE
--   Credit of ₹342842.63 and no Debit for the CN, so the bill's payable — and
--   with it the party's balance — stayed overstated by the whole CN.
--
--   Root cause (fixed in the app, see documents/actions.ts): at "Send to
--   Finance" a courier/duty bill's own Credit Note was silently subtracted from
--   the amount typed there (or ignored for bills sent before the CN was
--   entered), and bill_pass_register.credit_note_amt was left at 0. Nothing
--   ever posted the CN as its own ledger line, and bills sent when the CN was
--   still 0 kept their gross for ever.
--
--   Going forward the ledger row carries the bill as issued — total_amt =
--   gross + round-offs, credit_note_amt = the courier's CN — which is exactly
--   what to_be_pay / balance_due already net, so Bill Payment, Ageing,
--   Outstanding, Party Summary and the Journal Voucher are all consistent, and
--   the Party Ledger prints "Credit Note <CN no> against <invoice>" as a Debit.
--
-- WHAT THIS DOES (one statement = one transaction, idempotent — safe to re-run)
--   Only for rows that still have credit_note_amt = 0 while their bill has a CN
--   (so nothing is ever applied twice):
--     • total already equals the bill's gross  → the CN was never applied:
--       set credit_note_amt/date. Payable correctly drops by the CN.
--     • total already equals gross − CN        → the CN had been netted into
--       the total: re-post total as gross and set the CN column. Net payable
--       is unchanged (gross − CN), it just becomes visible as a Debit line.
--     • anything else (a hand-typed amount that matches neither) → left
--       untouched and reported in the notice, so no reviewed figure is
--       overwritten. Fix individual bills from the Courier/Duty bill's
--       "↻ Re-sync Finance amount" button.
--
--   Amounts, payments, adjustments, notes and audit history are untouched;
--   only total_amt / credit_note_amt / credit_note_date on bill_pass_register.
--
-- HOW TO RUN
--   Paste this whole file and run it in one go. It is ONE statement (a DO
--   block) on purpose: a console that commits after every statement would drop
--   a temp table between statements (see db/2026-10-31e-...sql for that
--   failure). Everything is all-or-nothing, and the notice at the end reports
--   how many bills were fixed and how many need a look.

DO $cn_repair$
DECLARE
  n_gross integer := 0;
  n_net   integer := 0;
  n_skip  integer := 0;
BEGIN
  DROP TABLE IF EXISTS _cn_fix;

  -- Every Courier / Duty & Tax bill in the Finance ledger that has a CN on the
  -- bill but none on the ledger row, with the bill's own gross (arithmetic
  -- mirrors the "Send to Finance" default: gross + bill round-off + every
  -- AWB's round-off) and the shape its current total has.
  CREATE TEMP TABLE _cn_fix ON COMMIT DROP AS
  WITH src AS (
    SELECT b.id              AS bpr_id,
           b.total_amt       AS bpr_total,
           fb.credit_note_amt  AS cn,
           fb.credit_note_date AS cn_date,
           round((fb.gross_total_amt + fb.round_off_amt + coalesce(awb.ro, 0))::numeric, 2) AS gross
      FROM bill_pass_register b
      JOIN freight_bills fb ON fb.id = b.source_id
      LEFT JOIN LATERAL (
        SELECT sum(a.round_off_amt) AS ro
          FROM freight_bill_awb_assignments a
         WHERE a.freight_bill_id = fb.id
      ) awb ON true
     WHERE b.source = 'freight_bill'
       AND b.merged_into_bill_id IS NULL
       AND b.credit_note_amt = 0
       AND fb.credit_note_amt > 0

    UNION ALL

    SELECT b.id,
           b.total_amt,
           d.credit_note_amt,
           d.credit_note_date,
           round((coalesce(d.total_payable_amt, d.duty_tax_amt_inr + d.gst_18pct_amt)
                  + d.round_off_amt + coalesce(awbd.ro, 0))::numeric, 2)
      FROM bill_pass_register b
      JOIN duty_tax_bills d ON d.id = b.source_id
      LEFT JOIN LATERAL (
        SELECT sum(a.round_off_amt) AS ro
          FROM duty_bill_awb_assignments a
         WHERE a.duty_tax_bill_id = d.id
      ) awbd ON true
     WHERE b.source = 'duty_tax_bill'
       AND b.merged_into_bill_id IS NULL
       AND b.credit_note_amt = 0
       AND d.credit_note_amt > 0
  )
  SELECT s.*,
         CASE
           WHEN abs(s.bpr_total - s.gross) <= 0.05          THEN 'gross'
           WHEN abs(s.bpr_total - (s.gross - s.cn)) <= 0.05 THEN 'net'
           ELSE 'unknown'
         END AS shape
    FROM src s;

  -- 1) CN never applied (bill posted at its gross): just add the CN. This is
  --    the reported bug — payable drops by the CN here.
  UPDATE bill_pass_register b
     SET credit_note_amt  = f.cn,
         credit_note_date = f.cn_date
    FROM _cn_fix f
   WHERE b.id = f.bpr_id
     AND f.shape = 'gross';
  GET DIAGNOSTICS n_gross = ROW_COUNT;

  -- 2) CN had been netted into the total: re-post gross + CN so the ledger can
  --    show the Debit line. Net payable unchanged.
  UPDATE bill_pass_register b
     SET total_amt        = f.gross,
         credit_note_amt  = f.cn,
         credit_note_date = f.cn_date
    FROM _cn_fix f
   WHERE b.id = f.bpr_id
     AND f.shape = 'net';
  GET DIAGNOSTICS n_net = ROW_COUNT;

  SELECT count(*) INTO n_skip FROM _cn_fix WHERE shape = 'unknown';

  RAISE NOTICE 'CN posted: % bill(s) fixed (total was gross), % bill(s) re-posted as gross + CN (net unchanged), % left untouched (hand-typed amount)',
    n_gross, n_net, n_skip;
END
$cn_repair$;

-- Inspect what was left untouched (a hand-typed amount that matches neither the
-- bill's gross nor its net). Fix those one by one from the bill's own
-- "↻ Re-sync Finance amount" button.
--
-- SELECT b.vendor_invoice_no, b.total_amt, b.credit_note_amt, b.source,
--        fb.gross_total_amt, fb.credit_note_amt
--   FROM bill_pass_register b
--   JOIN freight_bills fb ON fb.id = b.source_id
--  WHERE b.source = 'freight_bill'
--    AND b.credit_note_amt = 0
--    AND fb.credit_note_amt > 0;
