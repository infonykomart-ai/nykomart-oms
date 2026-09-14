-- 2026-09-14 — "nyko mart me fedex ka ladger chek kiya fedex ke jitne ke
-- bill apne pass credit match huye sahi hai, apn ne bill ke against me
-- payment kiya vo bhi sahi se match ho raha hai. lekin phir bhi match nahi
-- ho raha. credit note adjust karne vala fourmula ki vajh se to nahi ho
-- raha kahi galt tarike se to nahi bana diya."
--
-- THE STRUCTURAL RISK this surfaces: a courier (or duty) credit note can
-- land in the payable ledger through TWO independent doors —
--   Door A: typed into freight_bills/duty_tax_bills.credit_note_amt at
--           entry time. When the bill is then sent to Finance, the Send
--           form's DEFAULT total is gross − CN (freight-bill-section.tsx),
--           so the CN is already baked into bill_pass_register.total_amt.
--   Door B: applied afterwards as a bill_pass_register_adjustments row
--           (Documents → Credit Note "adjust against invoice", or the Bill
--           Payment 🧾 panel), which reduces the bill via adj_amt.
-- If the SAME courier CN was entered BOTH ways, the bill's payable is
-- reduced TWICE (once inside total_amt, once via adj_amt) — payments then
-- legitimately don't "match" the expected remaining balance.
--
-- This view makes every such case visible in one query. It is
-- READ-ONLY/diagnostic: it changes no data, so it is safe to run/keep.
-- It joins each finance-ledger courier/duty bill to its source document
-- and computes:
--   cn_in_total   — CN baked into total_amt at send time
--                   (source gross − ledger total_amt, clamped ≥ 0)
--   cn_adjusted   — CN applied via adjustments (adj_amt rows)
--   double_applied_flag — TRUE when both doors carry an amount for the
--                   same bill. THE mismatch candidates.
--
-- Idempotent: CREATE OR REPLACE VIEW.

CREATE OR REPLACE VIEW courier_cn_audit_view AS
SELECT
  bpr.id                                   AS bill_pass_register_id,
  bpr.company_id,
  bpr.party_id,
  bpr.vendor_invoice_no,
  bpr.invoice_type,
  bpr.source,
  bpr.source_id,
  bpr.total_amt                            AS ledger_total_amt,
  fb.gross_total_amt                       AS source_gross_amt,
  dtb.gross_total_amt                      AS duty_gross_amt,
  COALESCE(fb.credit_note_amt, 0)          AS source_cn_amt,
  -- CN baked into total_amt at send time (door A): what the source gross
  -- MINUS the ledger total implies was netted off up front.
  GREATEST(
    COALESCE(fb.gross_total_amt, dtb.gross_total_amt, 0)
      - bpr.total_amt, 0)                  AS cn_in_total,
  -- CN applied via adjustments (door B): the trigger-maintained sum.
  bpr.adj_amt                              AS cn_adjusted,
  bpr.credit_note_amt                      AS manual_cn_amt,
  bpr.total_paid,
  bpr.balance_due,
  -- THE flag: both doors non-zero on the same bill = reduced twice.
  (bpr.adj_amt > 0
    AND COALESCE(fb.gross_total_amt, dtb.gross_total_amt, 0) > bpr.total_amt) AS double_applied_flag
FROM bill_pass_register bpr
LEFT JOIN freight_bills fb  ON bpr.source = 'freight_bill'  AND bpr.source_id = fb.id
LEFT JOIN duty_tax_bills dtb ON bpr.source = 'duty_tax_bill' AND bpr.source_id = dtb.id
WHERE bpr.invoice_type IN ('FREIGHT INVOICE', 'DUTY TAX');

-- How to use (Supabase SQL Editor):
--   * Every double-applied candidate:
--       SELECT * FROM courier_cn_audit_view WHERE double_applied_flag;
--   * Per-party CN math summary (the "FedEx ledger" cross-check):
--       SELECT party_id,
--              SUM(cn_in_total)   AS cn_inside_totals,
--              SUM(cn_adjusted)   AS cn_via_adjustments,
--              SUM(manual_cn_amt) AS cn_manual_column,
--              SUM(total_paid)    AS paid,
--              SUM(balance_due)   AS still_owing
--       FROM courier_cn_audit_view GROUP BY party_id;
