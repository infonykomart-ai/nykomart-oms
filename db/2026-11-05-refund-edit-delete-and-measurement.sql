-- =============================================================================
-- 2026-11-05 — REFUND EDIT / UPDATE / DELETE  +  UNIVERSAL MEASUREMENT ENGINE
-- =============================================================================
--
-- Request (owner, verbatim intent): a refund entry can only be created today —
-- there is no way to correct or remove one afterwards; and Purchase/Orders
-- sizes are typed in CM / FT / INCH / MTR / MM with no shared conversion
-- engine, no mixed-unit (30 INCH × 5 FT) support, and no choice of the unit
-- the calculated area is shown in.
--
-- This patch adds ONLY the storage those two features need. No existing
-- column, row, total, view or report is rewritten:
--
--   order_refunds
--     + refund_qty / payment_mode / reference_no / remarks  (editable detail)
--     + updated_at / updated_by_employee_id               (edit history)
--     `created_at` is never touched; existing rows are backfilled with
--     updated_at = created_at so the first edit is traceable from the
--     original entry time, not from the migration date.
--
--   purchase_bills
--     + length_value/length_unit, width_value/width_unit  (as typed)
--     + area_value (numeric 18,6)                         (normalized result)
--     + area_display_unit                                 (chosen output unit)
--     + rate_input_value / rate_input_unit                (rate as quoted)
--     + measurement_precision                             (2 / 3 / 4 dp)
--     qty_unit's CHECK gains 'MM' for the sq-mm output, nothing else.
--     sq_feet / unit_rate keep their exact meaning — a measured line writes
--     the SAME two fields the manual path always wrote, just calculated by
--     the shared engine instead of by hand. total_sq_feet / total_amount /
--     g_total_plus_gst are re-created to multiply area_value when present
--     (precise) and sq_feet otherwise (manual rows) — every formula and every
--     reader stays the same, only the area input gains precision.
--     All measurement columns are NULLABLE: every historical bill stays NULL
--     and every existing report keeps reading it exactly as before.
--
--   company_measurement_settings (new, one row per company)
--     Defaults for dimension / area / rate / report units, decimal precision
--     and whether a transaction may override them. Absence of a row = engine
--     defaults (FT, SQ FT, 2 dp), so no backfill is needed.
--
-- MUST run AFTER:
--   db/2026-08-08-order-hold-cancel-refund.sql   (order_refunds)
--   db/2026-08-17-purchase-bills-qty-unit.sql    (qty_unit)
--   db/2026-08-27-purchase-bills-pcs-unit.sql    (PCS in qty_unit)
-- Everything here is idempotent: safe to run twice.
--
-- If NOT applied:
--   * refunds stay write-once (Edit/Delete buttons report the pending file);
--   * measured purchase lines keep saving the area exactly as the manual
--     path does (the new columns are simply absent). Nothing corrupts, but
--     the new dimension/unit UI cannot persist its inputs until this runs.
-- =============================================================================

BEGIN;

-- Received Chalan lines mirror purchase_bills.qty_unit (an auto-generated
-- chalan copies it), so they must accept MM as well.
ALTER TABLE received_chalan_items
  DROP CONSTRAINT IF EXISTS received_chalan_items_qty_unit_check;
ALTER TABLE received_chalan_items
  ADD CONSTRAINT received_chalan_items_qty_unit_check
  CHECK (qty_unit IN ('FT', 'MTR', 'INCH', 'YARD', 'CM', 'MM', 'PCS'));

-- ---------------------------------------------------------------- refunds ---

ALTER TABLE order_refunds
  ADD COLUMN IF NOT EXISTS refund_qty numeric(14,2)
    CHECK (refund_qty IS NULL OR refund_qty >= 0),
  ADD COLUMN IF NOT EXISTS payment_mode text,
  ADD COLUMN IF NOT EXISTS reference_no text,
  ADD COLUMN IF NOT EXISTS remarks text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_by_employee_id uuid
    REFERENCES employees(id) ON DELETE SET NULL;

-- Backfill once: the entry time IS the last-change time until someone edits.
UPDATE order_refunds SET updated_at = created_at WHERE updated_at IS NULL;

ALTER TABLE order_refunds ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE order_refunds ALTER COLUMN updated_at SET NOT NULL;

-- ------------------------------------------------------- purchase measurement

ALTER TABLE purchase_bills
  ADD COLUMN IF NOT EXISTS length_value numeric(14,3)
    CHECK (length_value IS NULL OR length_value > 0),
  ADD COLUMN IF NOT EXISTS length_unit text
    CHECK (length_unit IS NULL OR length_unit IN ('MM', 'CM', 'MTR', 'INCH', 'FT')),
  ADD COLUMN IF NOT EXISTS width_value numeric(14,3)
    CHECK (width_value IS NULL OR width_value > 0),
  ADD COLUMN IF NOT EXISTS width_unit text
    CHECK (width_unit IS NULL OR width_unit IN ('MM', 'CM', 'MTR', 'INCH', 'FT')),
  ADD COLUMN IF NOT EXISTS area_value numeric(18,6)
    CHECK (area_value IS NULL OR area_value > 0),
  ADD COLUMN IF NOT EXISTS area_display_unit text
    CHECK (area_display_unit IS NULL OR area_display_unit IN ('SQ_MM', 'SQ_CM', 'SQ_MTR', 'SQ_INCH', 'SQ_FT')),
  ADD COLUMN IF NOT EXISTS rate_input_value numeric(14,2)
    CHECK (rate_input_value IS NULL OR rate_input_value >= 0),
  ADD COLUMN IF NOT EXISTS rate_input_unit text
    CHECK (rate_input_unit IS NULL OR rate_input_unit IN ('SQ_MM', 'SQ_CM', 'SQ_MTR', 'SQ_INCH', 'SQ_FT')),
  ADD COLUMN IF NOT EXISTS measurement_precision integer
    CHECK (measurement_precision IS NULL OR (measurement_precision >= 0 AND measurement_precision <= 6));

-- The three generated totals now multiply the PRECISE engine area when a line
-- was measured, falling back to sq_feet for every manual/historical row. They
-- have to be re-created because a generated expression cannot be altered in
-- place; every value is derived, so nothing is lost by the swap. total_sq_feet
-- gains 4dp so a sq-mtr area is not rounded to 2dp before the rate multiplies
-- it. Safe to re-run: the DROP is IF EXISTS and the ADD always follows it.
-- Five existing reporting views select g_total_plus_gst, so the column
-- cannot be dropped while they exist. None of them depends on another of the
-- five (verified), so their definitions are captured, the views are dropped,
-- the columns are re-created, and the views are recreated from the captured
-- text — no view definition is copied into this file, and no view is left
-- behind. A re-run simply repeats the capture/drop/recreate.
DO $$
DECLARE
  v record;
  v_sql text[] := ARRAY[]::text[];
  i integer;
BEGIN
  FOR v IN
    SELECT c.oid, c.relname, pg_get_viewdef(c.oid, true) AS def
    FROM pg_class c
    WHERE c.relkind = 'v'
      AND pg_get_viewdef(c.oid, true) ILIKE '%g_total_plus_gst%'
      -- Only leaf views: a view that depends on another captured view must be
      -- recreated after that one, and there are none today, so bailing out
      -- loudly here beats silently destroying the dependency order.
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        JOIN pg_class base ON base.oid = d.refobjid AND base.relkind = 'v'
        WHERE d.objid = c.oid AND base.oid <> c.oid
          AND pg_get_viewdef(base.oid, true) ILIKE '%g_total_plus_gst%'
      )
  LOOP
    v_sql := v_sql || (
      'CREATE OR REPLACE VIEW ' || quote_ident(v.relname) || ' AS ' || rtrim(v.def, ';')
    );
    EXECUTE 'DROP VIEW ' || quote_ident(v.relname);
  END LOOP;

  ALTER TABLE purchase_bills DROP COLUMN IF EXISTS g_total_plus_gst;
  ALTER TABLE purchase_bills DROP COLUMN IF EXISTS total_amount;
  ALTER TABLE purchase_bills DROP COLUMN IF EXISTS total_sq_feet;
  ALTER TABLE purchase_bills
    ADD COLUMN total_sq_feet numeric(14,4)
      GENERATED ALWAYS AS (qty * COALESCE(area_value, sq_feet)) STORED,
    ADD COLUMN total_amount numeric(14,2)
      GENERATED ALWAYS AS (qty * COALESCE(area_value, sq_feet) * unit_rate) STORED,
    ADD COLUMN g_total_plus_gst numeric(14,2)
      GENERATED ALWAYS AS (
        (qty * COALESCE(area_value, sq_feet) * unit_rate)
        + (qty * COALESCE(area_value, sq_feet) * unit_rate)
          * (CASE WHEN gst_rate_pct IS NOT NULL THEN gst_rate_pct * 2 ELSE 5 END / 100)
        + round_off_amt
      ) STORED;

  IF array_length(v_sql, 1) IS NOT NULL THEN
    FOR i IN 1..array_length(v_sql, 1) LOOP
      EXECUTE v_sql[i];
    END LOOP;
  END IF;
END $$;

-- qty_unit: add MM (sq mm output) to the existing union. DROP+ADD is the
-- only portable way to widen a CHECK without guessing its auto-generated
-- name on every environment.
ALTER TABLE purchase_bills DROP CONSTRAINT IF EXISTS purchase_bills_qty_unit_check;
ALTER TABLE purchase_bills
  ADD CONSTRAINT purchase_bills_qty_unit_check
  CHECK (qty_unit IN ('FT', 'MTR', 'INCH', 'YARD', 'CM', 'MM', 'PCS'));

-- ------------------------------------------------- measurement preferences ---

CREATE TABLE IF NOT EXISTS company_measurement_settings (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  default_dimension_unit    text NOT NULL DEFAULT 'FT'
                              CHECK (default_dimension_unit IN ('MM', 'CM', 'MTR', 'INCH', 'FT')),
  default_area_unit         text NOT NULL DEFAULT 'SQ_FT'
                              CHECK (default_area_unit IN ('SQ_MM', 'SQ_CM', 'SQ_MTR', 'SQ_INCH', 'SQ_FT')),
  default_rate_unit         text NOT NULL DEFAULT 'SQ_FT'
                              CHECK (default_rate_unit IN ('SQ_MM', 'SQ_CM', 'SQ_MTR', 'SQ_INCH', 'SQ_FT')),
  decimal_precision         integer NOT NULL DEFAULT 2
                              CHECK (decimal_precision >= 0 AND decimal_precision <= 6),
  allow_per_transaction_unit boolean NOT NULL DEFAULT true,
  default_report_unit       text NOT NULL DEFAULT 'SQ_FT'
                              CHECK (default_report_unit IN ('SQ_MM', 'SQ_CM', 'SQ_MTR', 'SQ_INCH', 'SQ_FT')),
  updated_by_employee_id    uuid REFERENCES employees(id) ON DELETE SET NULL,
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------- atomic refund writes ---
-- A refund edit touches order_refunds + its credit note; a delete touches the
-- refund, the credit note, finished stock and its movement. Two functions so
-- each mutation is one transaction. The app checks capability, the refund cap
-- and currency conversion; the values passed in are already final.

CREATE OR REPLACE FUNCTION apply_order_refund_update(
  p_refund_id uuid,
  p_employee_id uuid,
  p_amount numeric,
  p_currency varchar,
  p_date date,
  p_reason text,
  p_qty numeric,
  p_payment_mode text,
  p_reference_no text,
  p_remarks text,
  p_basis numeric,
  p_order_value numeric,
  p_shipping numeric,
  p_duty numeric,
  p_inr numeric,
  p_usd numeric,
  p_refund_type refund_type
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_cn_id uuid;
BEGIN
  UPDATE order_refunds SET
    refund_amount = p_amount,
    refund_currency = p_currency,
    refund_date = p_date,
    reason = p_reason,
    refund_qty = p_qty,
    payment_mode = p_payment_mode,
    reference_no = p_reference_no,
    remarks = p_remarks,
    refund_basis_percent = p_basis,
    order_value_refund_amount = coalesce(p_order_value, 0),
    shipping_refund_amount = coalesce(p_shipping, 0),
    duty_refund_amount = coalesce(p_duty, 0),
    refund_amount_inr = p_inr,
    refund_amount_usd = p_usd,
    updated_at = now(),
    updated_by_employee_id = p_employee_id
  WHERE id = p_refund_id
  RETURNING order_id, credit_note_id INTO v_order_id, v_cn_id;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Refund % not found', p_refund_id;
  END IF;

  IF v_cn_id IS NOT NULL THEN
    UPDATE credit_notes SET
      credit_note_date = p_date,
      refund_amount = p_amount,
      refund_amt_usd = CASE WHEN p_currency = 'USD' THEN p_amount ELSE NULL END,
      refund_amt_inr = CASE WHEN p_currency = 'INR' THEN p_amount ELSE NULL END,
      refund_type = p_refund_type,
      remark = p_reason
    WHERE id = v_cn_id AND order_id = v_order_id;
  END IF;

  RETURN v_order_id;
END;
$$;

CREATE OR REPLACE FUNCTION apply_order_refund_delete(
  p_refund_id uuid,
  p_employee_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_refund order_refunds%ROWTYPE;
  v_order orders%ROWTYPE;
  v_cn_in_use integer := 0;
  v_restock numeric := 0;
  v_net_restocked numeric := 0;
  v_reverse numeric := 0;
  v_stock_id uuid;
  v_cn_id uuid;
BEGIN
  SELECT * INTO v_refund FROM order_refunds WHERE id = p_refund_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Refund not found.');
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = v_refund.order_id;

  IF v_refund.credit_note_id IS NOT NULL THEN
    SELECT
      (SELECT count(*) FROM bill_pass_register WHERE credit_note_id = v_refund.credit_note_id)
      + (SELECT count(*) FROM bill_pass_register_adjustments WHERE credit_note_id = v_refund.credit_note_id)
      + (SELECT count(*) FROM refunds WHERE credit_note_id = v_refund.credit_note_id)
    INTO v_cn_in_use;
    IF v_cn_in_use > 0 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'This refund''s credit note is already linked in the finance ledger. Remove that linkage first, then delete the refund.'
      );
    END IF;
  END IF;

  SELECT coalesce(sum(qty), 0) INTO v_restock FROM purchase_bills WHERE order_id = v_order.id;
  IF v_restock <= 0 THEN
    v_restock := coalesce(v_order.qty, 0);
  END IF;
  SELECT coalesce(sum(
           CASE
             WHEN reason = 'auto_restock_return_refund' THEN qty_change
             WHEN reason = 'auto_restock_reversal_refund_deleted' THEN -qty_change
             ELSE 0
           END), 0)
    INTO v_net_restocked
    FROM finished_stock_movements
   WHERE order_id = v_order.id;
  v_reverse := least(greatest(v_net_restocked, 0), v_restock);

  IF v_reverse > 0 THEN
    SELECT id INTO v_stock_id FROM finished_stock
     WHERE item_category_id = v_order.item_category_id
       AND sku_label = coalesce(v_order.sku_label, '')
       AND size_label = coalesce(v_order.size_label, '')
     LIMIT 1;
    IF v_stock_id IS NOT NULL THEN
      UPDATE finished_stock
         SET qty = greatest(qty - v_reverse::integer, 0), updated_at = now()
       WHERE id = v_stock_id;
    END IF;
    INSERT INTO finished_stock_movements
      (item_category_id, sku_label, size_label, qty_change, reason, order_id, entry_by_employee_id)
    VALUES
      (v_order.item_category_id, coalesce(v_order.sku_label, ''), coalesce(v_order.size_label, ''),
       -v_reverse::integer, 'auto_restock_reversal_refund_deleted', v_order.id, p_employee_id);
  END IF;

  UPDATE return_requests SET applied_refund_id = NULL WHERE applied_refund_id = p_refund_id;

  v_cn_id := v_refund.credit_note_id;
  IF v_cn_id IS NOT NULL THEN
    DELETE FROM credit_notes WHERE id = v_cn_id;
  END IF;
  DELETE FROM order_refunds WHERE id = p_refund_id;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'order_ref_no', v_order.ref_no,
    'reversed_qty', v_reverse,
    'credit_note_id', v_cn_id
  );
END;
$$;

REVOKE ALL ON FUNCTION apply_order_refund_update(uuid, uuid, numeric, varchar, date, text, numeric, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, refund_type) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION apply_order_refund_delete(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION apply_order_refund_update(uuid, uuid, numeric, varchar, date, text, numeric, text, text, text, numeric, numeric, numeric, numeric, numeric, numeric, refund_type) TO service_role;
GRANT EXECUTE ON FUNCTION apply_order_refund_delete(uuid, uuid) TO service_role;

COMMIT;
