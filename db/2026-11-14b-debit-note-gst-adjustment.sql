-- =============================================================================
-- 2026-11-14b — DEBIT NOTE: BILL ADJUSTMENT MUST INCLUDE GST
-- =============================================================================
-- Reported: "WHEN DEBIT NOTE MAKE 4140 EXCLUDING GST AND DEBIT NOTE VALUE IS
-- 4347 INCLUDING 5% GST, BUT PAYMENT ADJUST VALUE IS WITHOUT GST AMOUNT 4140".
--
-- WHY IT HAPPENED
--   debit_notes.debit_amount is the PRE-GST figure. The document's total is the
--   generated total_amount = debit_amount * 1.05 + round_off_amt.
--   A Debit Note reduces a vendor bill through bill_pass_register_adjustments,
--   whose rows are summed by a trigger into bill_pass_register.adj_amt, and
--   balance_due is generated as total_amt - credit_note_amt - adj_amt - paid.
--   The application used to insert the pre-GST amount into those rows, so a
--   4,140 note (+207 GST = 4,347) credited only 4,140 and left 207 payable.
--
-- WHAT THIS PATCH DOES
--   Application fix (src/app/dashboard/documents/actions.ts) makes every new
--   debit-note adjustment GST-inclusive, and keeps existing adjustments in step
--   when a note is edited.
--
--   This file repairs rows already written with the bug. It touches ONLY the
--   unambiguous signature: all adjustment rows of one note add up to that
--   note's PRE-GST debit_amount (within one paise) while the note's
--   total_amount is different. Rows that add up to anything else — a
--   deliberate partial adjustment, or an already-correct GST-inclusive set —
--   are left untouched. For multi-invoice notes the split is rescaled
--   proportionally with the rounding remainder on the last row, so the parts
--   net to exactly the note's total.
--
-- Run ONCE in the Supabase SQL editor. Idempotent: after the fix the
-- predicate no longer matches.
-- =============================================================================

DO $$
DECLARE
  note        RECORD;
  adj         RECORD;
  note_total  numeric;
  adj_total   numeric;
  seen        integer;
  remaining   numeric;
  scaled      numeric;
BEGIN
  FOR note IN
    SELECT dn.id,
           dn.debit_amount,
           dn.total_amount,
           COUNT(a.id)                    AS row_count,
           COALESCE(SUM(a.amount), 0)     AS adj_total
    FROM debit_notes dn
    JOIN bill_pass_register_adjustments a ON a.debit_note_id = dn.id
    GROUP BY dn.id, dn.debit_amount, dn.total_amount
    HAVING COUNT(a.id) > 0
       AND dn.total_amount > 0
       AND ABS(COALESCE(SUM(a.amount), 0) - dn.debit_amount) < 0.01
       AND ABS(COALESCE(SUM(a.amount), 0) - dn.total_amount) >= 0.01
  LOOP
    note_total := ROUND(note.total_amount, 2);
    adj_total  := ROUND(note.adj_total, 2);
    CONTINUE WHEN adj_total <= 0;

    seen := 0;
    remaining := note_total;

    FOR adj IN
      SELECT id, amount
      FROM bill_pass_register_adjustments
      WHERE debit_note_id = note.id
      ORDER BY created_at, id
    LOOP
      seen := seen + 1;
      IF seen = note.row_count THEN
        scaled := ROUND(remaining, 2);
      ELSE
        scaled := ROUND(ROUND(adj.amount, 2) * note_total / adj_total, 2);
        remaining := ROUND(remaining - scaled, 2);
      END IF;

      IF scaled > 0 THEN
        UPDATE bill_pass_register_adjustments SET amount = scaled WHERE id = adj.id;
      END IF;
    END LOOP;
  END LOOP;
END $$;

-- After running, this should return no rows: every debit-note adjustment now
-- totals its note's GST-inclusive value.
--   SELECT dn.debit_note_no, dn.debit_amount, dn.total_amount,
--          SUM(a.amount) AS adjusted
--   FROM debit_notes dn
--   JOIN bill_pass_register_adjustments a ON a.debit_note_id = dn.id
--   GROUP BY dn.id, dn.debit_note_no, dn.debit_amount, dn.total_amount
--   HAVING ABS(SUM(a.amount) - dn.debit_amount) < 0.01
--      AND ABS(SUM(a.amount) - dn.total_amount) >= 0.01;
