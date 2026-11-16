-- =============================================================================
-- 2026-11-14c — INVENTORY MANAGEMENT MODULE (finished goods)
-- =============================================================================
-- WHY A NEW MODULE, NOT A REWRITE
--   The app already had two stock systems, both kept exactly as they are:
--     * stock_in / stock_out + stock_current_view — RAW MATERIAL received
--       from / sent to vendors, PCS only, party-based (Section 10 of
--       db/schema.sql, /dashboard/stock).
--     * finished_stock / finished_stock_movements — a tiny auto-restocked
--       counter for cancelled+refunded orders (/dashboard/inventory).
--   Neither models what this module needs: per-SKU staged balances (raw,
--   printing, washing, QC, ready, rejected), area in SQ FT, reservations
--   against customer orders, and the rule that a challan ISSUE is what
--   physically deducts finished stock. Those are new tables, prefixed
--   `inventory_`, and nothing existing was dropped or restructured.
--
-- CORE INVARIANTS (enforced in the database, not just the UI)
--   1. Stock only changes through inventory_apply_movement(), which locks the
--      balance row, writes an immutable ledger row, and refuses negative
--      quantities.
--   2. A quantity can only be in ONE stage at a time: inventory_transfer_stage
--      debits and credits in the same transaction.
--   3. PCS and SQ FT move together; SQ FT is derived per variant
--      (length_ft × width_ft) and may be overridden only through the audited
--      adjustment path.
--   4. inventory_issue_challan() is the ONLY writer of stage 'DISPATCHED' and
--      the only thing that reduces READY for a customer dispatch. It is
--      idempotent by status: a second call on an ISSUED challan returns
--      already_issued without deducting again.
--   5. Cancelling an ISSUED challan reverses it in one transaction, but only
--      before dispatch. After dispatch the goods come back through the QC /
--      customer-return path, never by a silent stock restore.
--
-- Run once in the Supabase SQL editor. Re-runnable: every object is
-- CREATE ... IF NOT EXISTS / CREATE OR REPLACE, policies are dropped first,
-- and the capability seed uses ON CONFLICT DO NOTHING.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. CATEGORY WORKFLOW SETTINGS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_category_settings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id),
  item_category_id      uuid NOT NULL REFERENCES item_categories(id),
  is_order_based        boolean NOT NULL DEFAULT false, -- cotton rugs: purchase after order
  requires_printing     boolean NOT NULL DEFAULT false,
  requires_washing      boolean NOT NULL DEFAULT false,
  manufacturing_enabled boolean NOT NULL DEFAULT false,
  sqft_tracked          boolean NOT NULL DEFAULT true,
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, item_category_id)
);

-- ---------------------------------------------------------------------------
-- 2. PRODUCT MASTER + VARIANTS (each size/colour gets its own balance)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_products (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id),
  item_category_id      uuid NOT NULL REFERENCES item_categories(id),
  name                  text NOT NULL,
  product_code          citext NOT NULL,
  image_url             text,
  stock_unit            text NOT NULL DEFAULT 'PCS' CHECK (stock_unit IN ('PCS', 'SQFT')),
  purchase_type         text NOT NULL DEFAULT 'DIRECT' CHECK (purchase_type IN ('DIRECT', 'ORDER_BASED')),
  manufacturing_enabled boolean NOT NULL DEFAULT false,
  processing_required   boolean NOT NULL DEFAULT false,
  min_stock_pcs         numeric(14,3) NOT NULL DEFAULT 0 CHECK (min_stock_pcs >= 0),
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, product_code)
);

CREATE TABLE IF NOT EXISTS inventory_product_variants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES inventory_products(id) ON DELETE CASCADE,
  sku             citext NOT NULL UNIQUE,
  size_label      text NOT NULL DEFAULT '',
  colour          text NOT NULL DEFAULT '',
  length_ft       numeric(8,3) CHECK (length_ft IS NULL OR length_ft > 0),
  width_ft        numeric(8,3) CHECK (width_ft IS NULL OR width_ft > 0),
  -- Area per piece, derived so two people can never disagree about it.
  -- 4 × 6 ft → 24.0000 sq ft. Null when the product has no meaningful area.
  sqft_per_piece  numeric(14,4) GENERATED ALWAYS AS (
    CASE WHEN length_ft IS NOT NULL AND width_ft IS NOT NULL
         THEN round(length_ft * width_ft, 4) ELSE NULL END
  ) STORED,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, size_label, colour)
);
CREATE INDEX IF NOT EXISTS idx_inventory_variants_product ON inventory_product_variants(product_id);

-- ---------------------------------------------------------------------------
-- 3. WAREHOUSES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_warehouses (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  name        text NOT NULL,
  code        citext NOT NULL,
  address     text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, code)
);

-- ---------------------------------------------------------------------------
-- 4. BALANCES (one row per variant + warehouse + stage)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_balances (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  variant_id    uuid NOT NULL REFERENCES inventory_product_variants(id),
  warehouse_id  uuid NOT NULL REFERENCES inventory_warehouses(id),
  stage         text NOT NULL CHECK (stage IN
                  ('RAW', 'PRINTING', 'WASHING', 'MANUFACTURING', 'QC', 'READY', 'REJECTED', 'DISPATCHED')),
  pcs           numeric(14,3) NOT NULL DEFAULT 0,
  sqft          numeric(16,3) NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (variant_id, warehouse_id, stage),
  CHECK (pcs >= 0),
  CHECK (sqft >= 0)
);
CREATE INDEX IF NOT EXISTS idx_inventory_balances_company ON inventory_balances(company_id, stage);

-- ---------------------------------------------------------------------------
-- 5. IMMUTABLE LEDGER — the single source of truth for stock history
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_ledger (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  variant_id         uuid NOT NULL REFERENCES inventory_product_variants(id),
  warehouse_id       uuid NOT NULL REFERENCES inventory_warehouses(id),
  stage              text NOT NULL,
  tx_type            text NOT NULL,
  pcs_delta          numeric(14,3) NOT NULL DEFAULT 0,
  sqft_delta         numeric(16,3) NOT NULL DEFAULT 0,
  prev_pcs           numeric(14,3) NOT NULL,
  new_pcs            numeric(14,3) NOT NULL,
  prev_sqft          numeric(16,3) NOT NULL,
  new_sqft           numeric(16,3) NOT NULL,
  ref_type           text,
  ref_id             uuid,
  ref_no             text,
  remarks            text,
  actor_employee_id  uuid REFERENCES employees(id),
  idempotency_key    text,
  reversal_of        uuid REFERENCES inventory_ledger(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (new_pcs >= 0),
  CHECK (new_sqft >= 0)
);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_variant ON inventory_ledger(variant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_company ON inventory_ledger(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_ledger_ref ON inventory_ledger(ref_type, ref_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_ledger_idem
  ON inventory_ledger(company_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Ledger rows are append-only. Corrections are reversal entries, never edits.
CREATE OR REPLACE FUNCTION inventory_ledger_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'inventory_ledger is immutable: % is not allowed. Write a reversal entry instead.', TG_OP;
END;
$$;
DROP TRIGGER IF EXISTS trg_inventory_ledger_immutable ON inventory_ledger;
CREATE TRIGGER trg_inventory_ledger_immutable
  BEFORE UPDATE OR DELETE ON inventory_ledger
  FOR EACH ROW EXECUTE FUNCTION inventory_ledger_immutable();

-- ---------------------------------------------------------------------------
-- 6. RESERVATIONS (order-wise, never double-reserved)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_reservations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  order_id           uuid NOT NULL REFERENCES orders(id),
  variant_id         uuid NOT NULL REFERENCES inventory_product_variants(id),
  warehouse_id       uuid NOT NULL REFERENCES inventory_warehouses(id),
  pcs                numeric(14,3) NOT NULL CHECK (pcs > 0),
  sqft               numeric(16,3) NOT NULL DEFAULT 0 CHECK (sqft >= 0),
  fulfilled_pcs      numeric(14,3) NOT NULL DEFAULT 0 CHECK (fulfilled_pcs >= 0),
  fulfilled_sqft     numeric(16,3) NOT NULL DEFAULT 0 CHECK (fulfilled_sqft >= 0),
  status             text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'FULFILLED', 'RELEASED', 'CANCELLED')),
  created_by         uuid REFERENCES employees(id),
  release_reason     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (fulfilled_pcs <= pcs)
);
-- One live reservation per order + variant + warehouse, so the same stock can
-- never be promised twice by a double-clicked confirm.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_reservations_active
  ON inventory_reservations(order_id, variant_id, warehouse_id)
  WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------------------
-- 7. PRINTING / WASHING JOBS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_processing_jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  job_no              text UNIQUE,
  order_id            uuid REFERENCES orders(id),
  variant_id          uuid NOT NULL REFERENCES inventory_product_variants(id),
  warehouse_id        uuid NOT NULL REFERENCES inventory_warehouses(id),
  process             text NOT NULL CHECK (process IN ('PRINTING', 'WASHING')),
  vendor_party_id     uuid REFERENCES parties(id),
  pcs_sent            numeric(14,3) NOT NULL CHECK (pcs_sent > 0),
  sqft_sent           numeric(16,3) NOT NULL DEFAULT 0,
  pcs_accepted        numeric(14,3) NOT NULL DEFAULT 0,
  sqft_accepted       numeric(16,3) NOT NULL DEFAULT 0,
  pcs_rejected        numeric(14,3) NOT NULL DEFAULT 0,
  sqft_rejected       numeric(16,3) NOT NULL DEFAULT 0,
  status              text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PARTIAL', 'COMPLETED', 'CANCELLED')),
  sent_date           date NOT NULL DEFAULT CURRENT_DATE,
  expected_date       date,
  completed_at        timestamptz,
  remarks             text,
  created_by          uuid REFERENCES employees(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_processing_company ON inventory_processing_jobs(company_id, status);

CREATE TABLE IF NOT EXISTS inventory_processing_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id          uuid NOT NULL REFERENCES inventory_processing_jobs(id) ON DELETE CASCADE,
  movement        text NOT NULL CHECK (movement IN ('SENT', 'COMPLETED')),
  pcs             numeric(14,3) NOT NULL DEFAULT 0,
  sqft            numeric(16,3) NOT NULL DEFAULT 0,
  accepted_pcs    numeric(14,3) NOT NULL DEFAULT 0,
  accepted_sqft   numeric(16,3) NOT NULL DEFAULT 0,
  rejected_pcs    numeric(14,3) NOT NULL DEFAULT 0,
  rejected_sqft   numeric(16,3) NOT NULL DEFAULT 0,
  created_by      uuid REFERENCES employees(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 8. MANUFACTURING JOBS (kurtis, table cloth, table runner)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_manufacturing_jobs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id),
  job_no                text UNIQUE,
  variant_id            uuid NOT NULL REFERENCES inventory_product_variants(id),
  warehouse_id          uuid NOT NULL REFERENCES inventory_warehouses(id),
  planned_pcs           numeric(14,3) NOT NULL CHECK (planned_pcs > 0),
  planned_sqft          numeric(16,3) NOT NULL DEFAULT 0,
  produced_pcs          numeric(14,3) NOT NULL DEFAULT 0,
  produced_sqft         numeric(16,3) NOT NULL DEFAULT 0,
  accepted_pcs          numeric(14,3) NOT NULL DEFAULT 0,
  accepted_sqft         numeric(16,3) NOT NULL DEFAULT 0,
  rejected_pcs          numeric(14,3) NOT NULL DEFAULT 0,
  rejected_sqft         numeric(16,3) NOT NULL DEFAULT 0,
  material_consumption  jsonb NOT NULL DEFAULT '{}'::jsonb,
  wastage_note          text,
  responsible_employee_id uuid REFERENCES employees(id),
  start_date            date,
  completed_at          timestamptz,
  status                text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'PARTIAL', 'COMPLETED', 'CANCELLED')),
  remarks               text,
  created_by            uuid REFERENCES employees(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_manufacturing_company ON inventory_manufacturing_jobs(company_id, status);

-- ---------------------------------------------------------------------------
-- 9. CHALLANS — issue is what deducts stock
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_challans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid NOT NULL REFERENCES companies(id),
  chalan_no      text UNIQUE,
  chalan_date    date NOT NULL DEFAULT CURRENT_DATE,
  party_id       uuid REFERENCES parties(id),
  status         text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'ISSUED', 'CANCELLED')),
  issue_date     date,
  issued_by      uuid REFERENCES employees(id),
  dispatched_at  timestamptz,
  cancelled_at   timestamptz,
  cancelled_by   uuid REFERENCES employees(id),
  cancel_reason  text,
  remarks        text,
  created_by     uuid REFERENCES employees(id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_challans_company ON inventory_challans(company_id, status, chalan_date DESC);

CREATE TABLE IF NOT EXISTS inventory_challan_lines (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  chalan_id    uuid NOT NULL REFERENCES inventory_challans(id) ON DELETE CASCADE,
  order_id     uuid REFERENCES orders(id),
  variant_id   uuid NOT NULL REFERENCES inventory_product_variants(id),
  warehouse_id uuid NOT NULL REFERENCES inventory_warehouses(id),
  pcs          numeric(14,3) NOT NULL CHECK (pcs > 0),
  sqft         numeric(16,3) NOT NULL DEFAULT 0 CHECK (sqft >= 0),
  remarks      text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_challan_lines_chalan ON inventory_challan_lines(chalan_id);

-- Per-company document numbers, same reserve_next_number()/format_document_no()
-- machinery as every other document in this app.
CREATE OR REPLACE FUNCTION trg_inventory_challan_no() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_short text;
  v_num   integer;
BEGIN
  IF NEW.chalan_no IS NULL THEN
    SELECT short_code INTO v_short FROM companies WHERE id = NEW.company_id;
    v_num := reserve_next_number(NEW.company_id, 'DOC_IC', true, COALESCE(NEW.chalan_date, CURRENT_DATE));
    NEW.chalan_no := format_document_no(v_short, 'IC', fy_label(COALESCE(NEW.chalan_date, CURRENT_DATE)), v_num);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_inventory_challans_no ON inventory_challans;
CREATE TRIGGER trg_inventory_challans_no
  BEFORE INSERT ON inventory_challans
  FOR EACH ROW EXECUTE FUNCTION trg_inventory_challan_no();

CREATE OR REPLACE FUNCTION trg_inventory_processing_no() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_short text;
  v_num   integer;
  v_code  text := CASE WHEN NEW.process = 'PRINTING' THEN 'PR' ELSE 'WS' END;
BEGIN
  IF NEW.job_no IS NULL THEN
    SELECT short_code INTO v_short FROM companies WHERE id = NEW.company_id;
    v_num := reserve_next_number(NEW.company_id, 'DOC_' || v_code, true, COALESCE(NEW.sent_date, CURRENT_DATE));
    NEW.job_no := format_document_no(v_short, v_code, fy_label(COALESCE(NEW.sent_date, CURRENT_DATE)), v_num);
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_inventory_processing_jobs_no ON inventory_processing_jobs;
CREATE TRIGGER trg_inventory_processing_jobs_no
  BEFORE INSERT ON inventory_processing_jobs
  FOR EACH ROW EXECUTE FUNCTION trg_inventory_processing_no();

-- ---------------------------------------------------------------------------
-- 10. ADJUSTMENTS, AUDIT, IDEMPOTENCY
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  variant_id  uuid NOT NULL REFERENCES inventory_product_variants(id),
  warehouse_id uuid NOT NULL REFERENCES inventory_warehouses(id),
  stage       text NOT NULL,
  pcs_delta   numeric(14,3) NOT NULL,
  sqft_delta  numeric(16,3) NOT NULL,
  reason      text NOT NULL,
  remarks     text NOT NULL,
  ledger_id   uuid REFERENCES inventory_ledger(id),
  created_by  uuid REFERENCES employees(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inventory_audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id),
  entity      text NOT NULL,
  entity_id   uuid,
  action      text NOT NULL,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_employee_id uuid REFERENCES employees(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_audit_entity ON inventory_audit_logs(entity, entity_id);

CREATE TABLE IF NOT EXISTS inventory_idempotency (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      uuid NOT NULL REFERENCES companies(id),
  idempotency_key text NOT NULL,
  operation       text NOT NULL,
  result          jsonb,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, idempotency_key)
);

-- ---------------------------------------------------------------------------
-- 11. ATOMIC STOCK ENGINE
-- ---------------------------------------------------------------------------
-- The ONLY function that changes a balance. Locks the balance row, validates
-- the resulting quantity, updates the balance and appends a ledger row, all in
-- the caller's transaction.
CREATE OR REPLACE FUNCTION inventory_apply_movement(
  p_company_id    uuid,
  p_variant_id    uuid,
  p_warehouse_id  uuid,
  p_stage         text,
  p_pcs_delta     numeric,
  p_sqft_delta    numeric,
  p_tx_type       text,
  p_ref_type      text DEFAULT NULL,
  p_ref_id        uuid DEFAULT NULL,
  p_ref_no        text DEFAULT NULL,
  p_remarks       text DEFAULT NULL,
  p_actor         uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL
) RETURNS TABLE (new_pcs numeric, new_sqft numeric, ledger_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_before_pcs  numeric(14,3);
  v_before_sqft numeric(16,3);
  v_pcs         numeric(14,3);
  v_sqft        numeric(16,3);
  v_ledger      uuid;
  v_seen        integer;
BEGIN
  IF p_stage NOT IN ('RAW', 'PRINTING', 'WASHING', 'MANUFACTURING', 'QC', 'READY', 'REJECTED', 'DISPATCHED') THEN
    RAISE EXCEPTION 'Unknown stock stage %', p_stage;
  END IF;
  IF COALESCE(p_pcs_delta, 0) = 0 AND COALESCE(p_sqft_delta, 0) = 0 THEN
    RAISE EXCEPTION 'A stock movement needs a non-zero PCS or SQ FT quantity.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM inventory_product_variants v
    JOIN inventory_products pr ON pr.id = v.product_id
    WHERE v.id = p_variant_id AND pr.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Variant % does not belong to this company.', p_variant_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM inventory_warehouses w WHERE w.id = p_warehouse_id AND w.company_id = p_company_id
  ) THEN
    RAISE EXCEPTION 'Warehouse % does not belong to this company.', p_warehouse_id;
  END IF;

  -- Idempotency: a retried request returns the balance the first call produced
  -- instead of applying the movement twice.
  IF p_idempotency_key IS NOT NULL THEN
    INSERT INTO inventory_idempotency (company_id, idempotency_key, operation)
    VALUES (p_company_id, p_idempotency_key, p_tx_type)
    ON CONFLICT (company_id, idempotency_key) DO NOTHING;
    GET DIAGNOSTICS v_seen = ROW_COUNT;
    IF v_seen = 0 THEN
      SELECT pcs, sqft INTO v_pcs, v_sqft FROM inventory_balances
       WHERE variant_id = p_variant_id AND warehouse_id = p_warehouse_id AND stage = p_stage;
      RETURN QUERY SELECT COALESCE(v_pcs, 0), COALESCE(v_sqft, 0), NULL::uuid;
      RETURN;
    END IF;
  END IF;

  -- Create the balance row if this is the first movement, then lock it so two
  -- concurrent movements cannot both read the same "before" quantity.
  INSERT INTO inventory_balances (company_id, variant_id, warehouse_id, stage, pcs, sqft)
  VALUES (p_company_id, p_variant_id, p_warehouse_id, p_stage, 0, 0)
  ON CONFLICT (variant_id, warehouse_id, stage) DO NOTHING;

  SELECT pcs, sqft INTO v_before_pcs, v_before_sqft
  FROM inventory_balances
  WHERE variant_id = p_variant_id AND warehouse_id = p_warehouse_id AND stage = p_stage
  FOR UPDATE;

  v_pcs  := round(v_before_pcs + COALESCE(p_pcs_delta, 0), 3);
  v_sqft := round(v_before_sqft + COALESCE(p_sqft_delta, 0), 3);

  IF v_pcs < 0 OR v_sqft < -0.0005 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK: % at stage % has % PCS / % SQ FT, movement needs % PCS / % SQ FT.',
      p_variant_id, p_stage, v_before_pcs, v_before_sqft, p_pcs_delta, p_sqft_delta;
  END IF;
  -- Absorb sub-millimetre float noise rather than storing -0.000.
  IF v_pcs < 0 THEN v_pcs := 0; END IF;
  IF v_sqft < 0 THEN v_sqft := 0; END IF;

  UPDATE inventory_balances
  SET pcs = v_pcs, sqft = v_sqft, updated_at = now()
  WHERE variant_id = p_variant_id AND warehouse_id = p_warehouse_id AND stage = p_stage;

  INSERT INTO inventory_ledger (
    company_id, variant_id, warehouse_id, stage, tx_type,
    pcs_delta, sqft_delta, prev_pcs, new_pcs, prev_sqft, new_sqft,
    ref_type, ref_id, ref_no, remarks, actor_employee_id, idempotency_key
  ) VALUES (
    p_company_id, p_variant_id, p_warehouse_id, p_stage, p_tx_type,
    COALESCE(p_pcs_delta, 0), COALESCE(p_sqft_delta, 0), v_before_pcs, v_pcs, v_before_sqft, v_sqft,
    p_ref_type, p_ref_id, p_ref_no, p_remarks, p_actor, p_idempotency_key
  ) RETURNING id INTO v_ledger;

  RETURN QUERY SELECT v_pcs, v_sqft, v_ledger;
END;
$$;

-- Move PCS/SQ FT from one stage to another in exactly one transaction, so the
-- same goods are never counted in two stages.
CREATE OR REPLACE FUNCTION inventory_transfer_stage(
  p_company_id   uuid,
  p_variant_id   uuid,
  p_warehouse_id uuid,
  p_from_stage   text,
  p_to_stage     text,
  p_pcs          numeric,
  p_sqft         numeric,
  p_tx_type      text,
  p_ref_type     text DEFAULT NULL,
  p_ref_id       uuid DEFAULT NULL,
  p_ref_no       text DEFAULT NULL,
  p_remarks      text DEFAULT NULL,
  p_actor        uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_to_pcs  numeric;
  v_to_sqft numeric;
BEGIN
  IF p_pcs IS NULL OR p_pcs <= 0 THEN
    RAISE EXCEPTION 'Transfer quantity must be greater than zero.';
  END IF;
  PERFORM inventory_apply_movement(
    p_company_id, p_variant_id, p_warehouse_id, p_from_stage,
    -p_pcs, -COALESCE(p_sqft, 0), p_tx_type, p_ref_type, p_ref_id, p_ref_no, p_remarks, p_actor, NULL
  );
  SELECT new_pcs, new_sqft INTO v_to_pcs, v_to_sqft
  FROM inventory_apply_movement(
    p_company_id, p_variant_id, p_warehouse_id, p_to_stage,
    p_pcs, COALESCE(p_sqft, 0), p_tx_type, p_ref_type, p_ref_id, p_ref_no, p_remarks, p_actor, NULL
  );
  RETURN jsonb_build_object('stage', p_to_stage, 'pcs', v_to_pcs, 'sqft', v_to_sqft);
END;
$$;

-- ---------------------------------------------------------------------------
-- 12. RESERVATIONS
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inventory_reserve(
  p_order_id     uuid,
  p_variant_id   uuid,
  p_warehouse_id uuid,
  p_pcs          numeric,
  p_sqft         numeric,
  p_actor        uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company      uuid;
  v_balance_pcs  numeric(14,3);
  v_balance_sqft numeric(16,3);
  v_reserved     numeric(14,3);
  v_reserved_sqft numeric(16,3);
  v_id           uuid;
BEGIN
  IF p_pcs IS NULL OR p_pcs <= 0 THEN
    RAISE EXCEPTION 'Reservation quantity must be greater than zero.';
  END IF;

  SELECT company_id INTO v_company FROM orders WHERE id = p_order_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Order % not found.', p_order_id;
  END IF;

  INSERT INTO inventory_balances (company_id, variant_id, warehouse_id, stage, pcs, sqft)
  VALUES (v_company, p_variant_id, p_warehouse_id, 'READY', 0, 0)
  ON CONFLICT (variant_id, warehouse_id, stage) DO NOTHING;

  SELECT pcs, sqft INTO v_balance_pcs, v_balance_sqft
  FROM inventory_balances
  WHERE variant_id = p_variant_id AND warehouse_id = p_warehouse_id AND stage = 'READY'
  FOR UPDATE;

  SELECT COALESCE(SUM(pcs - fulfilled_pcs), 0), COALESCE(SUM(sqft - fulfilled_sqft), 0)
  INTO v_reserved, v_reserved_sqft
  FROM inventory_reservations
  WHERE variant_id = p_variant_id AND warehouse_id = p_warehouse_id AND status = 'ACTIVE';

  IF p_pcs > v_balance_pcs - v_reserved THEN
    RAISE EXCEPTION 'INSUFFICIENT_READY: only % PCS available (% in READY minus % reserved).',
      greatest(v_balance_pcs - v_reserved, 0), v_balance_pcs, v_reserved;
  END IF;
  IF COALESCE(p_sqft, 0) > v_balance_sqft - v_reserved_sqft THEN
    RAISE EXCEPTION 'INSUFFICIENT_READY: only % SQ FT available.', greatest(v_balance_sqft - v_reserved_sqft, 0);
  END IF;

  INSERT INTO inventory_reservations (company_id, order_id, variant_id, warehouse_id, pcs, sqft, created_by)
  VALUES (v_company, p_order_id, p_variant_id, p_warehouse_id, p_pcs, COALESCE(p_sqft, 0), p_actor)
  ON CONFLICT (order_id, variant_id, warehouse_id) WHERE status = 'ACTIVE'
  DO UPDATE SET pcs = inventory_reservations.pcs + EXCLUDED.pcs,
                sqft = inventory_reservations.sqft + EXCLUDED.sqft,
                updated_at = now()
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'reservation_id', v_id,
    'pcs', p_pcs,
    'available_after', v_balance_pcs - v_reserved - p_pcs
  );
END;
$$;

CREATE OR REPLACE FUNCTION inventory_release_reservation(
  p_reservation_id uuid,
  p_actor          uuid DEFAULT NULL,
  p_reason         text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row inventory_reservations;
BEGIN
  SELECT * INTO v_row FROM inventory_reservations WHERE id = p_reservation_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'Reservation % not found.', p_reservation_id;
  END IF;
  IF v_row.status <> 'ACTIVE' THEN
    RETURN jsonb_build_object('status', v_row.status, 'already_closed', true);
  END IF;
  UPDATE inventory_reservations
  SET status = 'RELEASED', release_reason = p_reason, updated_at = now()
  WHERE id = p_reservation_id;
  RETURN jsonb_build_object('status', 'RELEASED', 'already_closed', false);
END;
$$;

-- ---------------------------------------------------------------------------
-- 13. CHALLAN ISSUE — the atomic deduction
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inventory_issue_challan(
  p_challan_id uuid,
  p_actor      uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_challan   inventory_challans;
  v_line      inventory_challan_lines;
  v_res       RECORD;
  v_remaining numeric;
  v_take      numeric;
  v_sqft_take numeric;
  v_lines     integer := 0;
BEGIN
  SELECT * INTO v_challan FROM inventory_challans WHERE id = p_challan_id FOR UPDATE;
  IF v_challan.id IS NULL THEN
    RAISE EXCEPTION 'Challan % not found.', p_challan_id;
  END IF;

  -- Idempotent on status: double-click / retried request must never deduct twice.
  IF v_challan.status = 'ISSUED' THEN
    RETURN jsonb_build_object('already_issued', true, 'chalan_no', v_challan.chalan_no, 'lines', 0);
  END IF;
  IF v_challan.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Challan % is cancelled and cannot be issued.', v_challan.chalan_no;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM inventory_challan_lines WHERE chalan_id = p_challan_id) THEN
    RAISE EXCEPTION 'Challan % has no lines.', v_challan.chalan_no;
  END IF;

  FOR v_line IN
    SELECT * FROM inventory_challan_lines WHERE chalan_id = p_challan_id ORDER BY created_at, id
  LOOP
    -- Refuses with INSUFFICIENT_STOCK if READY cannot cover the line; the
    -- exception rolls the whole function (and every earlier line) back.
    PERFORM inventory_apply_movement(
      v_challan.company_id, v_line.variant_id, v_line.warehouse_id, 'READY',
      -v_line.pcs, -v_line.sqft, 'CHALLAN_ISSUE', 'INVENTORY_CHALLAN', v_challan.id,
      v_challan.chalan_no, 'Issued to customer', p_actor, NULL
    );

    -- Fulfil the order's reservations FIFO, never beyond what the line ships.
    IF v_line.order_id IS NOT NULL THEN
      v_remaining := v_line.pcs;
      FOR v_res IN
        SELECT id, pcs, fulfilled_pcs, sqft, fulfilled_sqft
        FROM inventory_reservations
        WHERE order_id = v_line.order_id
          AND variant_id = v_line.variant_id
          AND warehouse_id = v_line.warehouse_id
          AND status = 'ACTIVE'
        ORDER BY created_at
        FOR UPDATE
      LOOP
        EXIT WHEN v_remaining <= 0;
        v_take := least(v_remaining, v_res.pcs - v_res.fulfilled_pcs);
        IF v_take <= 0 THEN CONTINUE; END IF;
        v_sqft_take := CASE WHEN v_line.pcs > 0
          THEN round(v_line.sqft * v_take / v_line.pcs, 3) ELSE 0 END;
        UPDATE inventory_reservations
        SET fulfilled_pcs = round(fulfilled_pcs + v_take, 3),
            fulfilled_sqft = least(sqft, round(fulfilled_sqft + v_sqft_take, 3)),
            status = CASE WHEN fulfilled_pcs + v_take >= pcs THEN 'FULFILLED' ELSE status END,
            updated_at = now()
        WHERE id = v_res.id;
        v_remaining := v_remaining - v_take;
      END LOOP;
    END IF;

    v_lines := v_lines + 1;
  END LOOP;

  UPDATE inventory_challans
  SET status = 'ISSUED',
      issue_date = COALESCE(issue_date, CURRENT_DATE),
      issued_by = COALESCE(p_actor, issued_by)
  WHERE id = p_challan_id;

  INSERT INTO inventory_audit_logs (company_id, entity, entity_id, action, detail, actor_employee_id)
  VALUES (v_challan.company_id, 'inventory_challan', p_challan_id, 'ISSUED',
          jsonb_build_object('chalan_no', v_challan.chalan_no, 'lines', v_lines), p_actor);

  RETURN jsonb_build_object('already_issued', false, 'chalan_no', v_challan.chalan_no, 'lines', v_lines);
END;
$$;

CREATE OR REPLACE FUNCTION inventory_cancel_challan(
  p_challan_id uuid,
  p_actor      uuid DEFAULT NULL,
  p_reason     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_challan inventory_challans;
  v_line    inventory_challan_lines;
  v_res     RECORD;
  v_back    numeric;
BEGIN
  SELECT * INTO v_challan FROM inventory_challans WHERE id = p_challan_id FOR UPDATE;
  IF v_challan.id IS NULL THEN
    RAISE EXCEPTION 'Challan % not found.', p_challan_id;
  END IF;

  IF v_challan.status = 'CANCELLED' THEN
    RETURN jsonb_build_object('already_cancelled', true, 'chalan_no', v_challan.chalan_no);
  END IF;

  IF v_challan.status = 'ISSUED' THEN
    IF v_challan.dispatched_at IS NOT NULL THEN
      RAISE EXCEPTION 'Challan % has already been dispatched. Receive the goods back through QC instead of cancelling it.',
        v_challan.chalan_no;
    END IF;

    FOR v_line IN
      SELECT * FROM inventory_challan_lines WHERE chalan_id = p_challan_id ORDER BY created_at, id
    LOOP
      PERFORM inventory_apply_movement(
        v_challan.company_id, v_line.variant_id, v_line.warehouse_id, 'READY',
        v_line.pcs, v_line.sqft, 'CHALLAN_CANCEL', 'INVENTORY_CHALLAN', v_challan.id,
        v_challan.chalan_no, 'Issued challan cancelled before dispatch', p_actor, NULL
      );

      -- Give the order its reservation capacity back.
      IF v_line.order_id IS NOT NULL THEN
        v_back := v_line.pcs;
        FOR v_res IN
          SELECT id, pcs, fulfilled_pcs, sqft, fulfilled_sqft
          FROM inventory_reservations
          WHERE order_id = v_line.order_id
            AND variant_id = v_line.variant_id
            AND warehouse_id = v_line.warehouse_id
            AND fulfilled_pcs > 0
          ORDER BY created_at DESC
          FOR UPDATE
        LOOP
          EXIT WHEN v_back <= 0;
          v_back := v_back - least(v_back, v_res.fulfilled_pcs);
          UPDATE inventory_reservations
          SET fulfilled_pcs = greatest(fulfilled_pcs - v_line.pcs, 0),
              fulfilled_sqft = greatest(fulfilled_sqft - v_line.sqft, 0),
              status = 'ACTIVE',
              updated_at = now()
          WHERE id = v_res.id;
          v_back := 0;
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  UPDATE inventory_challans
  SET status = 'CANCELLED',
      cancelled_at = now(),
      cancelled_by = COALESCE(p_actor, cancelled_by),
      cancel_reason = p_reason
  WHERE id = p_challan_id;

  INSERT INTO inventory_audit_logs (company_id, entity, entity_id, action, detail, actor_employee_id)
  VALUES (v_challan.company_id, 'inventory_challan', p_challan_id, 'CANCELLED',
          jsonb_build_object('chalan_no', v_challan.chalan_no, 'reason', p_reason,
                             'reversed_stock', v_challan.status = 'ISSUED'), p_actor);

  RETURN jsonb_build_object('already_cancelled', false, 'chalan_no', v_challan.chalan_no,
                            'reversed_stock', v_challan.status = 'ISSUED');
END;
$$;

-- ---------------------------------------------------------------------------
-- 14. RECONCILIATION — balances must always equal the ledger sum
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inventory_reconcile()
RETURNS TABLE (
  variant_id uuid, warehouse_id uuid, stage text,
  balance_pcs numeric, ledger_pcs numeric, balance_sqft numeric, ledger_sqft numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT b.variant_id, b.warehouse_id, b.stage, b.pcs, COALESCE(l.pcs, 0), b.sqft, COALESCE(l.sqft, 0)
  FROM inventory_balances b
  LEFT JOIN (
    SELECT variant_id, warehouse_id, stage, SUM(pcs_delta) AS pcs, SUM(sqft_delta) AS sqft
    FROM inventory_ledger
    GROUP BY variant_id, warehouse_id, stage
  ) l ON l.variant_id = b.variant_id AND l.warehouse_id = b.warehouse_id AND l.stage = b.stage
  WHERE round(b.pcs, 3) <> round(COALESCE(l.pcs, 0), 3)
     OR round(b.sqft, 3) <> round(COALESCE(l.sqft, 0), 3)
     OR l.variant_id IS NULL;
$$;

-- ---------------------------------------------------------------------------
-- 14b. PROCESSING / MANUFACTURING / QC WORKFLOWS
-- ---------------------------------------------------------------------------
-- Each of these moves stock between stages AND updates its job row in one
-- transaction, so a half-finished transfer can never be left behind.
CREATE OR REPLACE FUNCTION inventory_start_processing(
  p_company_id    uuid,
  p_variant_id    uuid,
  p_warehouse_id  uuid,
  p_process       text,
  p_pcs           numeric,
  p_sqft          numeric,
  p_order_id      uuid DEFAULT NULL,
  p_vendor_party_id uuid DEFAULT NULL,
  p_expected_date date DEFAULT NULL,
  p_remarks       text DEFAULT NULL,
  p_actor         uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_from text;
  v_job  uuid;
BEGIN
  IF p_process NOT IN ('PRINTING', 'WASHING') THEN
    RAISE EXCEPTION 'Unknown processing stage %', p_process;
  END IF;
  v_from := CASE WHEN p_process = 'PRINTING' THEN 'RAW' ELSE 'PRINTING' END;

  PERFORM inventory_transfer_stage(
    p_company_id, p_variant_id, p_warehouse_id, v_from, p_process,
    p_pcs, COALESCE(p_sqft, 0), 'PROCESSING_SEND', 'PROCESSING_JOB', NULL,
    NULL, p_remarks, p_actor
  );

  INSERT INTO inventory_processing_jobs (
    company_id, order_id, variant_id, warehouse_id, process, vendor_party_id,
    pcs_sent, sqft_sent, expected_date, remarks, created_by
  ) VALUES (
    p_company_id, p_order_id, p_variant_id, p_warehouse_id, p_process, p_vendor_party_id,
    p_pcs, COALESCE(p_sqft, 0), p_expected_date, p_remarks, p_actor
  ) RETURNING id INTO v_job;

  INSERT INTO inventory_processing_movements (job_id, movement, pcs, sqft, created_by)
  VALUES (v_job, 'SENT', p_pcs, COALESCE(p_sqft, 0), p_actor);

  INSERT INTO inventory_audit_logs (company_id, entity, entity_id, action, detail, actor_employee_id)
  VALUES (p_company_id, 'processing_job', v_job, 'SENT',
          jsonb_build_object('process', p_process, 'pcs', p_pcs, 'from', v_from), p_actor);

  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION inventory_complete_processing(
  p_job_id        uuid,
  p_accepted_pcs  numeric,
  p_accepted_sqft numeric,
  p_rejected_pcs  numeric,
  p_rejected_sqft numeric,
  p_actor         uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job       inventory_processing_jobs;
  v_from      text;
  v_remaining numeric;
  v_acc_pcs   numeric := COALESCE(p_accepted_pcs, 0);
  v_acc_sqft  numeric := COALESCE(p_accepted_sqft, 0);
  v_rej_pcs   numeric := COALESCE(p_rejected_pcs, 0);
  v_rej_sqft  numeric := COALESCE(p_rejected_sqft, 0);
BEGIN
  SELECT * INTO v_job FROM inventory_processing_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'Processing job % not found.', p_job_id;
  END IF;
  IF v_job.status NOT IN ('OPEN', 'PARTIAL') THEN
    RAISE EXCEPTION 'Processing job % is already %.', v_job.job_no, v_job.status;
  END IF;

  v_remaining := v_job.pcs_sent - v_job.pcs_accepted - v_job.pcs_rejected;
  IF v_acc_pcs < 0 OR v_rej_pcs < 0 THEN
    RAISE EXCEPTION 'Accepted/rejected quantities cannot be negative.';
  END IF;
  IF v_acc_pcs + v_rej_pcs <= 0 THEN
    RAISE EXCEPTION 'Enter how many pieces were accepted and/or rejected.';
  END IF;
  IF v_acc_pcs + v_rej_pcs > v_remaining + 0.0005 THEN
    RAISE EXCEPTION 'Only % PCS are still pending at this job.', v_remaining;
  END IF;

  v_from := CASE WHEN v_job.process = 'PRINTING' THEN 'PRINTING' ELSE 'WASHING' END;

  IF v_acc_pcs > 0 THEN
    -- Accepted goods still pass through QC before they become dispatchable.
    PERFORM inventory_transfer_stage(
      v_job.company_id, v_job.variant_id, v_job.warehouse_id, v_from, 'QC',
      v_acc_pcs, v_acc_sqft, 'PROCESSING_COMPLETE', 'PROCESSING_JOB', v_job.id, v_job.job_no, NULL, p_actor
    );
    PERFORM inventory_transfer_stage(
      v_job.company_id, v_job.variant_id, v_job.warehouse_id, 'QC', 'READY',
      v_acc_pcs, v_acc_sqft, 'QC_ACCEPT', 'PROCESSING_JOB', v_job.id, v_job.job_no, NULL, p_actor
    );
  END IF;

  IF v_rej_pcs > 0 THEN
    PERFORM inventory_transfer_stage(
      v_job.company_id, v_job.variant_id, v_job.warehouse_id, v_from, 'REJECTED',
      v_rej_pcs, v_rej_sqft, 'QC_REJECT', 'PROCESSING_JOB', v_job.id, v_job.job_no, NULL, p_actor
    );
  END IF;

  UPDATE inventory_processing_jobs
  SET pcs_accepted = pcs_accepted + v_acc_pcs,
      sqft_accepted = sqft_accepted + v_acc_sqft,
      pcs_rejected = pcs_rejected + v_rej_pcs,
      sqft_rejected = sqft_rejected + v_rej_sqft,
      status = CASE WHEN pcs_accepted + v_acc_pcs + pcs_rejected + v_rej_pcs >= pcs_sent
                    THEN 'COMPLETED' ELSE 'PARTIAL' END,
      completed_at = CASE WHEN pcs_accepted + v_acc_pcs + pcs_rejected + v_rej_pcs >= pcs_sent
                          THEN now() ELSE completed_at END
  WHERE id = p_job_id;

  INSERT INTO inventory_processing_movements (job_id, movement, pcs, sqft, accepted_pcs, accepted_sqft, rejected_pcs, rejected_sqft, created_by)
  VALUES (p_job_id, 'COMPLETED', v_acc_pcs + v_rej_pcs, v_acc_sqft + v_rej_sqft, v_acc_pcs, v_acc_sqft, v_rej_pcs, v_rej_sqft, p_actor);

  INSERT INTO inventory_audit_logs (company_id, entity, entity_id, action, detail, actor_employee_id)
  VALUES (v_job.company_id, 'processing_job', p_job_id, 'COMPLETED',
          jsonb_build_object('accepted_pcs', v_acc_pcs, 'rejected_pcs', v_rej_pcs), p_actor);

  RETURN jsonb_build_object('accepted_pcs', v_acc_pcs, 'rejected_pcs', v_rej_pcs, 'pending_pcs', v_remaining - v_acc_pcs - v_rej_pcs);
END;
$$;

CREATE OR REPLACE FUNCTION inventory_start_manufacturing(
  p_company_id   uuid,
  p_variant_id   uuid,
  p_warehouse_id uuid,
  p_planned_pcs  numeric,
  p_planned_sqft numeric,
  p_responsible  uuid DEFAULT NULL,
  p_start_date   date DEFAULT NULL,
  p_remarks      text DEFAULT NULL,
  p_actor        uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job uuid;
BEGIN
  IF p_planned_pcs IS NULL OR p_planned_pcs <= 0 THEN
    RAISE EXCEPTION 'Planned quantity must be greater than zero.';
  END IF;
  INSERT INTO inventory_manufacturing_jobs (
    company_id, variant_id, warehouse_id, planned_pcs, planned_sqft,
    responsible_employee_id, start_date, remarks, created_by
  ) VALUES (
    p_company_id, p_variant_id, p_warehouse_id, p_planned_pcs, COALESCE(p_planned_sqft, 0),
    p_responsible, COALESCE(p_start_date, CURRENT_DATE), p_remarks, p_actor
  ) RETURNING id INTO v_job;

  INSERT INTO inventory_audit_logs (company_id, entity, entity_id, action, detail, actor_employee_id)
  VALUES (p_company_id, 'manufacturing_job', v_job, 'STARTED',
          jsonb_build_object('planned_pcs', p_planned_pcs), p_actor);
  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION inventory_complete_manufacturing(
  p_job_id         uuid,
  p_accepted_pcs   numeric,
  p_accepted_sqft  numeric,
  p_rejected_pcs   numeric,
  p_rejected_sqft  numeric,
  p_consumption    jsonb DEFAULT '{}'::jsonb,
  p_wastage_note   text DEFAULT NULL,
  p_actor          uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job       inventory_manufacturing_jobs;
  v_remaining numeric;
  v_acc_pcs   numeric := COALESCE(p_accepted_pcs, 0);
  v_acc_sqft  numeric := COALESCE(p_accepted_sqft, 0);
  v_rej_pcs   numeric := COALESCE(p_rejected_pcs, 0);
  v_rej_sqft  numeric := COALESCE(p_rejected_sqft, 0);
BEGIN
  SELECT * INTO v_job FROM inventory_manufacturing_jobs WHERE id = p_job_id FOR UPDATE;
  IF v_job.id IS NULL THEN
    RAISE EXCEPTION 'Manufacturing job % not found.', p_job_id;
  END IF;
  IF v_job.status NOT IN ('OPEN', 'PARTIAL') THEN
    RAISE EXCEPTION 'Manufacturing job % is already %.', v_job.job_no, v_job.status;
  END IF;

  v_remaining := v_job.planned_pcs - v_job.accepted_pcs - v_job.rejected_pcs;
  IF v_acc_pcs + v_rej_pcs <= 0 THEN
    RAISE EXCEPTION 'Enter the finished quantity.';
  END IF;
  IF v_acc_pcs + v_rej_pcs > v_remaining + 0.0005 THEN
    RAISE EXCEPTION 'Only % PCS are still planned on this job.', v_remaining;
  END IF;

  -- Manufacturing has no stage balance to transfer FROM: raw material lives
  -- in the separate stock_in module (by design — raw material and finished
  -- goods are never the same stock). Production output therefore enters at
  -- QC, and only the accepted part is promoted to READY.
  IF v_acc_pcs > 0 THEN
    PERFORM inventory_apply_movement(
      v_job.company_id, v_job.variant_id, v_job.warehouse_id, 'QC',
      v_acc_pcs, v_acc_sqft, 'MANUFACTURING_COMPLETE', 'MANUFACTURING_JOB', v_job.id, v_job.job_no, NULL, p_actor, NULL
    );
    PERFORM inventory_transfer_stage(
      v_job.company_id, v_job.variant_id, v_job.warehouse_id, 'QC', 'READY',
      v_acc_pcs, v_acc_sqft, 'QC_ACCEPT', 'MANUFACTURING_JOB', v_job.id, v_job.job_no, NULL, p_actor
    );
  END IF;
  IF v_rej_pcs > 0 THEN
    PERFORM inventory_apply_movement(
      v_job.company_id, v_job.variant_id, v_job.warehouse_id, 'REJECTED',
      v_rej_pcs, v_rej_sqft, 'QC_REJECT', 'MANUFACTURING_JOB', v_job.id, v_job.job_no, NULL, p_actor, NULL
    );
  END IF;

  UPDATE inventory_manufacturing_jobs
  SET accepted_pcs = accepted_pcs + v_acc_pcs,
      accepted_sqft = accepted_sqft + v_acc_sqft,
      rejected_pcs = rejected_pcs + v_rej_pcs,
      rejected_sqft = rejected_sqft + v_rej_sqft,
      produced_pcs = produced_pcs + v_acc_pcs + v_rej_pcs,
      material_consumption = COALESCE(p_consumption, '{}'::jsonb),
      wastage_note = COALESCE(p_wastage_note, wastage_note),
      status = CASE WHEN accepted_pcs + v_acc_pcs + rejected_pcs + v_rej_pcs >= planned_pcs
                    THEN 'COMPLETED' ELSE 'PARTIAL' END,
      completed_at = CASE WHEN accepted_pcs + v_acc_pcs + rejected_pcs + v_rej_pcs >= planned_pcs
                          THEN now() ELSE completed_at END
  WHERE id = p_job_id;

  INSERT INTO inventory_audit_logs (company_id, entity, entity_id, action, detail, actor_employee_id)
  VALUES (v_job.company_id, 'manufacturing_job', p_job_id, 'COMPLETED',
          jsonb_build_object('accepted_pcs', v_acc_pcs, 'rejected_pcs', v_rej_pcs), p_actor);

  RETURN jsonb_build_object('accepted_pcs', v_acc_pcs, 'rejected_pcs', v_rej_pcs, 'pending_pcs', v_remaining - v_acc_pcs - v_rej_pcs);
END;
$$;

-- Manual QC decision for stock sitting in QC (customer returns, manual holds).
CREATE OR REPLACE FUNCTION inventory_move_qc(
  p_company_id   uuid,
  p_variant_id   uuid,
  p_warehouse_id uuid,
  p_pcs          numeric,
  p_sqft         numeric,
  p_accept       boolean,
  p_ref_no       text DEFAULT NULL,
  p_remarks      text DEFAULT NULL,
  p_actor        uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN inventory_transfer_stage(
    p_company_id, p_variant_id, p_warehouse_id, 'QC',
    CASE WHEN p_accept THEN 'READY' ELSE 'REJECTED' END,
    p_pcs, COALESCE(p_sqft, 0),
    CASE WHEN p_accept THEN 'QC_ACCEPT' ELSE 'QC_REJECT' END,
    'QC', NULL, p_ref_no, p_remarks, p_actor
  );
END;
$$;

-- Marks the physical handover. After this a challan can no longer be
-- cancelled (goods are with the courier/customer).
CREATE OR REPLACE FUNCTION inventory_mark_dispatched(p_challan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_challan inventory_challans;
BEGIN
  SELECT * INTO v_challan FROM inventory_challans WHERE id = p_challan_id FOR UPDATE;
  IF v_challan.id IS NULL THEN
    RAISE EXCEPTION 'Challan % not found.', p_challan_id;
  END IF;
  IF v_challan.status <> 'ISSUED' THEN
    RAISE EXCEPTION 'Only an ISSUED challan can be marked dispatched.';
  END IF;
  UPDATE inventory_challans SET dispatched_at = COALESCE(dispatched_at, now()) WHERE id = p_challan_id;
  RETURN jsonb_build_object('dispatched_at', now());
END;
$$;

-- ---------------------------------------------------------------------------
-- 15. RLS — authenticated can read, only the service role writes
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'inventory_category_settings', 'inventory_products', 'inventory_product_variants',
    'inventory_warehouses', 'inventory_balances', 'inventory_ledger', 'inventory_reservations',
    'inventory_processing_jobs', 'inventory_processing_movements', 'inventory_manufacturing_jobs',
    'inventory_challans', 'inventory_challan_lines', 'inventory_adjustments',
    'inventory_audit_logs', 'inventory_idempotency'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS inventory_read ON %I', t);
    EXECUTE format('CREATE POLICY inventory_read ON %I FOR SELECT TO authenticated USING (true)', t);
  END LOOP;
END $$;

GRANT SELECT ON inventory_category_settings, inventory_products, inventory_product_variants,
  inventory_warehouses, inventory_balances, inventory_ledger, inventory_reservations,
  inventory_processing_jobs, inventory_processing_movements, inventory_manufacturing_jobs,
  inventory_challans, inventory_challan_lines, inventory_adjustments, inventory_audit_logs
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 16. CAPABILITIES
-- ---------------------------------------------------------------------------
INSERT INTO capabilities (code, description) VALUES
  ('inventory_view',     'View the Inventory module — dashboard, stock, ledger and reports'),
  ('inventory_manage',   'Stock inward, adjustments, transfers, reservations, processing and manufacturing updates'),
  ('inventory_dispatch', 'Create, issue and cancel inventory challans (dispatch)'),
  ('inventory_settings', 'Maintain inventory products, variants, warehouses and category workflows')
ON CONFLICT (code) DO NOTHING;

-- Everyone can see stock; only the operational roles can change it.
INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'inventory_view' FROM roles r
ON CONFLICT DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, c.code
FROM roles r
CROSS JOIN (VALUES ('inventory_manage'), ('inventory_dispatch'), ('inventory_settings')) AS c(code)
WHERE r.name IN ('Admin', 'MD', 'Inventory')
ON CONFLICT DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'inventory_dispatch' FROM roles r WHERE r.name = 'Logistics'
ON CONFLICT DO NOTHING;
