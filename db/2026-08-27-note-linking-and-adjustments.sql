-- 2026-08-27 — Debit/Credit Note <-> bill linking + cross-invoice adjustments.
--
-- Four related asks, verbatim:
-- 1. "purchase bill ho ya kisi bhi party ka bill ho... credite note ya
--    debit note agar us invoice se related ho to vaha dikhna cahiye sath
--    hi link bhi hona chahiye" — a Debit/Credit Note related to a bill
--    should show + link wherever that bill is shown.
-- 2. "kisi bill me agar credit debit adjust karna pade kisi dusre
--    invoice me to vo bhi hona chahiye" — a note raised against one
--    invoice should be able to adjust a DIFFERENT invoice's payable too.
-- 3. "kisi order ke against me bhi agar credit debit note bana na pade to
--    vo bhi link ho" — same for a note raised against a sales order
--    (debit_notes.order_id / credit_notes.order_id already exist).
-- 4. "tabhi to PL sahi se aayega or calculation fourmule check kar lena
--    koi galt nahi hona chahiye" — these adjustments must flow into P&L
--    correctly (see the view changes below).
--
-- Design: debit_notes and credit_notes both get a new
-- bill_pass_register_id — the bill this note was RAISED against (shown
-- via a dropdown of that party's real bills on the entry form, replacing
-- reliance on the old free-text "Against Invoice/Bill No." field, which
-- stays for backward-compat display only).
--
-- Separately, a new bill_pass_register_adjustments table records where a
-- note's amount is actually APPLIED — deliberately NOT the same as "raised
-- against", because #2 above is explicitly a DIFFERENT invoice. One note
-- can apply (in full or in parts) against one or several bill_pass_register
-- rows. Every adjustment REDUCES the target row's payable (the overwhelming
-- real case here — a vendor debit note for a shortage/return/rate
-- correction always reduces what we owe that vendor; there's no UI need
-- today for the opposite direction).
--
-- bill_pass_register gets one new rollup column, adj_amt (trigger-
-- maintained SUM of adjustments targeting that row — never hand-typed).
-- to_be_pay/balance_due (GENERATED STORED columns) are dropped and
-- re-added with adj_amt folded in. The pre-existing credit_note_amt
-- column (manual, used today by Freight/Duty/Salary bill entry) is left
-- completely untouched — this is purely additive on top of it, so every
-- existing manual credit_note_amt entry keeps working exactly as before.

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Note -> bill "raised against" link
-- ---------------------------------------------------------------------
ALTER TABLE debit_notes
  ADD COLUMN bill_pass_register_id uuid REFERENCES bill_pass_register(id);
CREATE INDEX idx_debit_notes_bill_pass_register ON debit_notes(bill_pass_register_id);

ALTER TABLE credit_notes
  ADD COLUMN bill_pass_register_id uuid REFERENCES bill_pass_register(id);
CREATE INDEX idx_credit_notes_bill_pass_register ON credit_notes(bill_pass_register_id);

-- ---------------------------------------------------------------------
-- 2. Cross-invoice adjustment ledger
-- ---------------------------------------------------------------------
CREATE TABLE bill_pass_register_adjustments (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_pass_register_id      uuid NOT NULL REFERENCES bill_pass_register(id) ON DELETE CASCADE,  -- the invoice being reduced (may differ from the note's own "raised against" bill)
  debit_note_id                uuid REFERENCES debit_notes(id) ON DELETE CASCADE,
  credit_note_id                  uuid REFERENCES credit_notes(id) ON DELETE CASCADE,
  amount                             numeric(14,2) NOT NULL CHECK (amount > 0),
  remark                                text,
  created_by_employee_id                  uuid REFERENCES employees(id),
  created_at                                 timestamptz NOT NULL DEFAULT now(),
  CHECK ( (debit_note_id IS NOT NULL AND credit_note_id IS NULL)
       OR (debit_note_id IS NULL AND credit_note_id IS NOT NULL) )
);
CREATE INDEX idx_bpr_adjustments_target ON bill_pass_register_adjustments(bill_pass_register_id);
CREATE INDEX idx_bpr_adjustments_debit_note ON bill_pass_register_adjustments(debit_note_id);
CREATE INDEX idx_bpr_adjustments_credit_note ON bill_pass_register_adjustments(credit_note_id);

-- ---------------------------------------------------------------------
-- 3. bill_pass_register: new rollup column + regenerated to_be_pay/
--    balance_due. Drop the one dependent index first (Postgres won't
--    drop a column an index's predicate references), recreate it after.
-- ---------------------------------------------------------------------
DROP INDEX idx_bill_pass_company_due_date;

ALTER TABLE bill_pass_register
  ADD COLUMN adj_amt numeric(14,2) NOT NULL DEFAULT 0;  -- SUM of bill_pass_register_adjustments targeting this row — trigger-maintained, never hand-typed

ALTER TABLE bill_pass_register DROP COLUMN to_be_pay;
ALTER TABLE bill_pass_register DROP COLUMN balance_due;

ALTER TABLE bill_pass_register
  ADD COLUMN to_be_pay numeric(14,2) GENERATED ALWAYS AS (total_amt - credit_note_amt - adj_amt) STORED;
ALTER TABLE bill_pass_register
  ADD COLUMN balance_due numeric(14,2) GENERATED ALWAYS AS (total_amt - credit_note_amt - adj_amt - total_paid) STORED;

CREATE INDEX idx_bill_pass_company_due_date ON bill_pass_register(company_id, due_date) WHERE balance_due > 0;

-- ---------------------------------------------------------------------
-- 4. Trigger: keep bill_pass_register.adj_amt in sync with the
--    adjustments table on insert/update/delete, for every affected
--    target row (old + new, in case bill_pass_register_id itself is
--    ever changed on an existing adjustment — not exposed in the UI
--    today, but keeping the trigger correct for it costs nothing).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION trg_bpr_adjustments_sync() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_ids uuid[];
  v_id uuid;
BEGIN
  v_ids := ARRAY[]::uuid[];
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_ids := v_ids || NEW.bill_pass_register_id;
  END IF;
  IF TG_OP IN ('DELETE', 'UPDATE') THEN
    v_ids := v_ids || OLD.bill_pass_register_id;
  END IF;

  FOREACH v_id IN ARRAY v_ids LOOP
    UPDATE bill_pass_register
    SET adj_amt = COALESCE((SELECT SUM(amount) FROM bill_pass_register_adjustments WHERE bill_pass_register_id = v_id), 0)
    WHERE id = v_id;
  END LOOP;

  RETURN NULL;
END;
$$;

CREATE TRIGGER bpr_adjustments_sync_ins AFTER INSERT ON bill_pass_register_adjustments
  FOR EACH ROW EXECUTE FUNCTION trg_bpr_adjustments_sync();
CREATE TRIGGER bpr_adjustments_sync_upd AFTER UPDATE ON bill_pass_register_adjustments
  FOR EACH ROW EXECUTE FUNCTION trg_bpr_adjustments_sync();
CREATE TRIGGER bpr_adjustments_sync_del AFTER DELETE ON bill_pass_register_adjustments
  FOR EACH ROW EXECUTE FUNCTION trg_bpr_adjustments_sync();

-- ---------------------------------------------------------------------
-- 5. RLS on the new table — same blanket "authenticated can do anything,
--    anon gets nothing" policy every other table in this app already
--    has (db/2026-08-08-enable-rls.sql). service_role (Server Actions)
--    bypasses RLS regardless.
-- ---------------------------------------------------------------------
ALTER TABLE bill_pass_register_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE bill_pass_register_adjustments FORCE ROW LEVEL SECURITY;
CREATE POLICY allow_authenticated_all ON bill_pass_register_adjustments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------
-- 6. P&L views — fold purchase-side adjustments in, so a Debit Note
--    against a Purchase Bill correctly reduces purchase_expenses_inr
--    (increases profit) instead of being invisible to P&L, per ask #4.
--    Netting is additive on top of the existing purchase_bills.
--    g_total_plus_gst sum (NOT switched to reading bill_pass_register.
--    to_be_pay directly) — a purchase_bills row whose bill_pass_register
--    mirror-insert happened to fail (see savePurchaseBillCore's own
--    error handling) must still count its full gross expense; only the
--    adjustment portion, which by definition lives on bill_pass_register,
--    is netted in separately.
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW pl_dashboard_by_company_view AS
WITH order_refund_totals AS (
  SELECT order_id, SUM(refund_amount_inr) AS refund_total_inr
  FROM order_refunds
  GROUP BY order_id
),
order_agg AS (
  SELECT o.company_id,
    SUM(o.order_value_inr - COALESCE(ort.refund_total_inr, 0)) FILTER (WHERE o.status <> 'Cancelled')               AS total_sale_value_inr,
    SUM(COALESCE(cd.courier_expense_inr,0) + COALESCE(cd.duty_expense_inr,0)) FILTER (WHERE o.status <> 'Cancelled') AS order_expenses_inr
  FROM orders o
  LEFT JOIN order_courier_duty_expense_view cd ON cd.order_id = o.id
  LEFT JOIN order_refund_totals ort            ON ort.order_id = o.id
  GROUP BY o.company_id
),
purchase_agg AS (
  SELECT company_id, SUM(g_total_plus_gst) AS purchase_expenses_gross_inr
  FROM purchase_bills
  WHERE company_id IS NOT NULL
  GROUP BY company_id
),
-- 2026-08-27: Debit/Credit Note adjustments applied against a
-- source='purchase_bill' bill_pass_register row — these net OUT of
-- purchase expense (a debit note for a vendor shortage/return means we
-- really spent less than the bill's face value).
purchase_adjustments AS (
  SELECT bpr.company_id, SUM(a.amount) AS adjustment_total_inr
  FROM bill_pass_register_adjustments a
  JOIN bill_pass_register bpr ON bpr.id = a.bill_pass_register_id
  WHERE bpr.source = 'purchase_bill'
  GROUP BY bpr.company_id
),
historical_agg AS (
  -- pre-`orders`-table CSV backfill rows only — see comment above.
  SELECT company_id, SUM(total_value_inr) AS hist_sale_inr, SUM(total_expenses_inr) AS hist_expense_inr
  FROM sale_profit_ledger
  WHERE order_id IS NULL
  GROUP BY company_id
),
combined AS (
  SELECT
    c.id AS company_id, c.name AS company_name,
    COALESCE(oa.total_sale_value_inr,0) + COALESCE(ha.hist_sale_inr,0) AS total_sale_value_inr,
    COALESCE(oa.order_expenses_inr,0)
      + (COALESCE(pa.purchase_expenses_gross_inr,0) - COALESCE(padj.adjustment_total_inr,0))
      + COALESCE(ha.hist_expense_inr,0) AS total_expenses_inr
  FROM companies c
  LEFT JOIN order_agg oa            ON oa.company_id = c.id
  LEFT JOIN purchase_agg pa         ON pa.company_id = c.id
  LEFT JOIN purchase_adjustments padj ON padj.company_id = c.id
  LEFT JOIN historical_agg ha       ON ha.company_id = c.id
)
SELECT
  combined.company_id, company_name,
  total_sale_value_inr,
  total_expenses_inr,
  (total_sale_value_inr - total_expenses_inr)                          AS net_total_value,
  (total_sale_value_inr * 0.25)                                        AS portal_expenses_25pct,
  ((total_sale_value_inr - total_expenses_inr) - (total_sale_value_inr * 0.25)) AS net_earn,
  (((total_sale_value_inr - total_expenses_inr) - (total_sale_value_inr * 0.25)) / NULLIF(total_sale_value_inr, 0)) AS profit_pct,
  COALESCE(ie.total_internal_expenses_inr, 0) AS total_internal_expenses_inr,
  (((total_sale_value_inr - total_expenses_inr) - (total_sale_value_inr * 0.25)) - COALESCE(ie.total_internal_expenses_inr, 0)) AS net_earn_after_overhead
FROM combined
LEFT JOIN (
  SELECT company_id, SUM(amount_inr) AS total_internal_expenses_inr
  FROM internal_expenses GROUP BY company_id
) ie ON ie.company_id = combined.company_id;
COMMENT ON VIEW pl_dashboard_by_company_view IS
  '2026-08-20: rebuilt to be live off orders.order_value_inr + Courier/Duty reconciliation + purchase_bills '
  '(company-wide) instead of only the CSV-imported sale_profit_ledger — see db/2026-08-20-order-value-fix.sql. '
  'Pre-`orders`-table historical rows in sale_profit_ledger (order_id IS NULL) are still folded in so old '
  'history is not lost. 2026-08-27: purchase expense now nets out Debit/Credit Note adjustments applied '
  'against purchase bills (bill_pass_register_adjustments) — see db/2026-08-27-note-linking-and-adjustments.sql.';

-- Same purchase-adjustment netting for the month-wise P&L view, bucketed
-- by the TARGET bill's own invoice_date (the month that purchase expense
-- was originally booked in purchase_agg below) — not the note's own date,
-- so a Debit Note entered next month for last month's shortage still
-- corrects the month the expense actually belongs to.
CREATE OR REPLACE VIEW pl_dashboard_by_month_view AS
WITH months AS (
  SELECT DISTINCT date_trunc('month', order_date)::date AS month FROM orders WHERE status <> 'Cancelled'
  UNION
  SELECT DISTINCT date_trunc('month', vendor_invoice_date)::date AS month FROM purchase_bills WHERE vendor_invoice_date IS NOT NULL
  UNION
  SELECT DISTINCT date_trunc('month', invoice_date)::date AS month FROM sale_profit_ledger WHERE order_id IS NULL AND invoice_date IS NOT NULL
  UNION
  SELECT DISTINCT date_trunc('month', expense_date)::date AS month FROM internal_expenses
),
order_refund_totals AS (
  SELECT order_id, SUM(refund_amount_inr) AS refund_total_inr
  FROM order_refunds
  GROUP BY order_id
),
order_agg AS (
  SELECT date_trunc('month', o.order_date)::date AS month,
    SUM(o.order_value_inr - COALESCE(ort.refund_total_inr, 0))                                 AS sale_inr,
    SUM(COALESCE(cd.courier_expense_inr,0) + COALESCE(cd.duty_expense_inr,0))                  AS order_expense_inr
  FROM orders o
  LEFT JOIN order_courier_duty_expense_view cd ON cd.order_id = o.id
  LEFT JOIN order_refund_totals ort            ON ort.order_id = o.id
  WHERE o.status <> 'Cancelled'
  GROUP BY date_trunc('month', o.order_date)
),
purchase_agg AS (
  SELECT date_trunc('month', vendor_invoice_date)::date AS month, SUM(g_total_plus_gst) AS purchase_expense_gross_inr
  FROM purchase_bills
  WHERE vendor_invoice_date IS NOT NULL
  GROUP BY date_trunc('month', vendor_invoice_date)
),
purchase_adjustments AS (
  SELECT date_trunc('month', bpr.invoice_date)::date AS month, SUM(a.amount) AS adjustment_total_inr
  FROM bill_pass_register_adjustments a
  JOIN bill_pass_register bpr ON bpr.id = a.bill_pass_register_id
  WHERE bpr.source = 'purchase_bill' AND bpr.invoice_date IS NOT NULL
  GROUP BY date_trunc('month', bpr.invoice_date)
),
historical_agg AS (
  SELECT date_trunc('month', invoice_date)::date AS month,
    SUM(total_value_inr) AS hist_sale_inr, SUM(total_expenses_inr) AS hist_expense_inr
  FROM sale_profit_ledger
  WHERE order_id IS NULL AND invoice_date IS NOT NULL
  GROUP BY date_trunc('month', invoice_date)
),
expense_agg AS (
  SELECT date_trunc('month', expense_date)::date AS month, SUM(amount_inr) AS total_internal_expenses_inr
  FROM internal_expenses
  GROUP BY date_trunc('month', expense_date)
),
combined AS (
  SELECT
    m.month,
    COALESCE(oa.sale_inr, 0) + COALESCE(ha.hist_sale_inr, 0) AS total_sale_value_inr,
    COALESCE(oa.order_expense_inr, 0)
      + (COALESCE(pa.purchase_expense_gross_inr, 0) - COALESCE(padj.adjustment_total_inr, 0))
      + COALESCE(ha.hist_expense_inr, 0) AS total_expenses_inr
  FROM months m
  LEFT JOIN order_agg oa              ON oa.month = m.month
  LEFT JOIN purchase_agg pa           ON pa.month = m.month
  LEFT JOIN purchase_adjustments padj ON padj.month = m.month
  LEFT JOIN historical_agg ha         ON ha.month = m.month
)
SELECT
  c.month,
  c.total_sale_value_inr,
  c.total_expenses_inr,
  ((c.total_sale_value_inr - c.total_expenses_inr) - (c.total_sale_value_inr * 0.25)) AS net_earn,
  (((c.total_sale_value_inr - c.total_expenses_inr) - (c.total_sale_value_inr * 0.25)) / NULLIF(c.total_sale_value_inr, 0)) AS profit_pct,
  COALESCE(ea.total_internal_expenses_inr, 0) AS total_internal_expenses_inr,
  (((c.total_sale_value_inr - c.total_expenses_inr) - (c.total_sale_value_inr * 0.25)) - COALESCE(ea.total_internal_expenses_inr, 0)) AS net_earn_after_overhead
FROM combined c
LEFT JOIN expense_agg ea ON ea.month = c.month
ORDER BY c.month DESC;
COMMENT ON VIEW pl_dashboard_by_month_view IS
  'Old P&L Dashboard''s month-wise block (previously hardcoded to a trailing 24 months via SUMPRODUCT over '
  'YEAR()/MONTH()) — a view naturally covers all history; LIMIT 24 in the application query if only a '
  'trailing window should be shown. 2026-08-20: rebuilt to be live off orders.order_date/order_value_inr + '
  'Courier/Duty + purchase_bills instead of only sale_profit_ledger — see pl_dashboard_by_company_view''s '
  'comment and db/2026-08-20-order-value-fix.sql. 2026-08-27: purchase expense now nets out Debit/Credit '
  'Note adjustments applied against purchase bills, bucketed by the target bill''s own invoice month — see '
  'db/2026-08-27-note-linking-and-adjustments.sql.';

COMMIT;

-- Verify:
SELECT column_name FROM information_schema.columns WHERE table_name = 'debit_notes' AND column_name = 'bill_pass_register_id';
SELECT column_name FROM information_schema.columns WHERE table_name = 'credit_notes' AND column_name = 'bill_pass_register_id';
SELECT column_name, generation_expression FROM information_schema.columns WHERE table_name = 'bill_pass_register' AND column_name IN ('adj_amt','to_be_pay','balance_due');
SELECT tablename, policyname, roles FROM pg_policies WHERE schemaname = 'public' AND tablename = 'bill_pass_register_adjustments';
