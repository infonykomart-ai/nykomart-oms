-- =============================================================================
-- Phase 4 — ORDER ↔ STOCK LINK (2026-11-16)
--
-- Order entry records SKU + size as free text, not as an inventory variant id,
-- so phase 4 links the two by SKU (inventory_product_variants.sku is already
-- globally unique) inside the application. This file adds the two database
-- pieces that link needs:
--
--   1. inventory_purchase_requirements — a shortage raised when a confirmed
--      order cannot be covered by READY stock. This app has no purchase-order
--      table; requirements are the "what to buy" list, not a PO.
--   2. inventory_reserve_order() — reserves what is actually available and
--      writes the remainder into a requirement, atomically. inventory_reserve()
--      stays unchanged and still refuses to over-reserve: it is used by the
--      manual reservation screen where a hard failure is correct.
--   3. inventory_release_order() — releases every live reservation for an
--      order and cancels its open requirements (hold / cancel / return).
--
-- Additive and re-runnable. No existing table, function or data is altered.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. PURCHASE REQUIREMENTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_purchase_requirements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id),
  order_id      uuid REFERENCES orders(id) ON DELETE CASCADE,
  variant_id    uuid NOT NULL REFERENCES inventory_product_variants(id),
  required_pcs  numeric(14,3) NOT NULL CHECK (required_pcs > 0),
  purchased_pcs numeric(14,3) NOT NULL DEFAULT 0 CHECK (purchased_pcs >= 0),
  status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'FULFILLED', 'CANCELLED')),
  needed_by     date,
  remarks       text,
  created_by    uuid REFERENCES employees(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_requirements_company
  ON inventory_purchase_requirements(company_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_requirements_variant
  ON inventory_purchase_requirements(variant_id, status);
-- One open requirement per order + variant: re-confirming the same order tops
-- up the existing requirement instead of stacking duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_requirements_open
  ON inventory_purchase_requirements(order_id, variant_id)
  WHERE status = 'OPEN' AND order_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. RESERVE WHAT IS AVAILABLE, RECORD THE SHORTFALL
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inventory_reserve_order(
  p_order_id     uuid,
  p_variant_id   uuid,
  p_warehouse_id uuid,
  p_pcs          numeric,
  p_sqft         numeric DEFAULT 0,
  p_actor        uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company       uuid;
  v_balance_pcs   numeric(14,3);
  v_balance_sqft  numeric(16,3);
  v_reserved      numeric(14,3);
  v_reserved_sqft numeric(16,3);
  v_take          numeric(14,3);
  v_take_sqft     numeric(16,3);
  v_shortfall     numeric(14,3);
  v_reservation   uuid;
  v_requirement   uuid;
BEGIN
  IF p_pcs IS NULL OR p_pcs <= 0 THEN
    RAISE EXCEPTION 'Order quantity must be greater than zero.';
  END IF;

  SELECT company_id INTO v_company FROM orders WHERE id = p_order_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Order % not found.', p_order_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM inventory_product_variants v
    JOIN inventory_products p ON p.id = v.product_id
    WHERE v.id = p_variant_id AND p.company_id = v_company
  ) THEN
    RAISE EXCEPTION 'That SKU does not belong to this company.';
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

  v_take      := LEAST(p_pcs, GREATEST(v_balance_pcs - v_reserved, 0));
  v_take_sqft := LEAST(COALESCE(p_sqft, 0), GREATEST(v_balance_sqft - v_reserved_sqft, 0));
  v_shortfall := p_pcs - v_take;

  IF v_take > 0 THEN
    INSERT INTO inventory_reservations (company_id, order_id, variant_id, warehouse_id, pcs, sqft, created_by)
    VALUES (v_company, p_order_id, p_variant_id, p_warehouse_id, v_take, v_take_sqft, p_actor)
    ON CONFLICT (order_id, variant_id, warehouse_id) WHERE status = 'ACTIVE'
    DO UPDATE SET pcs  = inventory_reservations.pcs + EXCLUDED.pcs,
                  sqft = inventory_reservations.sqft + EXCLUDED.sqft,
                  updated_at = now()
    RETURNING id INTO v_reservation;
  ELSE
    SELECT id INTO v_reservation
    FROM inventory_reservations
    WHERE order_id = p_order_id AND variant_id = p_variant_id
      AND warehouse_id = p_warehouse_id AND status = 'ACTIVE';
  END IF;

  IF v_shortfall > 0 THEN
    INSERT INTO inventory_purchase_requirements (company_id, order_id, variant_id, required_pcs, created_by, remarks)
    VALUES (v_company, p_order_id, p_variant_id, v_shortfall, p_actor,
            'Raised when the order was confirmed without enough READY stock.')
    ON CONFLICT (order_id, variant_id) WHERE status = 'OPEN' AND order_id IS NOT NULL
    DO UPDATE SET required_pcs = inventory_purchase_requirements.required_pcs + EXCLUDED.required_pcs,
                  updated_at = now()
    RETURNING id INTO v_requirement;
  ELSE
    -- Stock now covers the whole order (e.g. a later inward), so an earlier
    -- shortage for this order + SKU is no longer a buying need.
    UPDATE inventory_purchase_requirements
    SET status = 'FULFILLED', updated_at = now()
    WHERE order_id = p_order_id AND variant_id = p_variant_id AND status = 'OPEN';
  END IF;

  INSERT INTO inventory_audit_logs (company_id, entity, entity_id, action, detail, actor_employee_id)
  VALUES (v_company, 'order', p_order_id, 'ORDER_STOCK_RESERVED',
          jsonb_build_object(
            'variant_id', p_variant_id,
            'warehouse_id', p_warehouse_id,
            'requested_pcs', p_pcs,
            'reserved_pcs', v_take,
            'shortfall_pcs', v_shortfall
          ), p_actor);

  RETURN jsonb_build_object(
    'reserved_pcs', v_take,
    'shortfall_pcs', v_shortfall,
    'reservation_id', v_reservation,
    'requirement_id', v_requirement,
    'available_before', GREATEST(v_balance_pcs - v_reserved, 0)
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. RELEASE AN ORDER'S STOCK (HOLD / CANCEL / RETURN)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inventory_release_order(
  p_order_id uuid,
  p_actor    uuid DEFAULT NULL,
  p_reason   text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_company   uuid;
  v_released  integer := 0;
  v_cancelled integer := 0;
BEGIN
  SELECT company_id INTO v_company FROM orders WHERE id = p_order_id;
  IF v_company IS NULL THEN
    RAISE EXCEPTION 'Order % not found.', p_order_id;
  END IF;

  WITH upd AS (
    UPDATE inventory_reservations
    SET status = 'RELEASED',
        release_reason = COALESCE(p_reason, 'Order is no longer confirmed'),
        updated_at = now()
    WHERE order_id = p_order_id AND status = 'ACTIVE'
    RETURNING 1
  )
  SELECT count(*) INTO v_released FROM upd;

  WITH upd AS (
    UPDATE inventory_purchase_requirements
    SET status = 'CANCELLED', updated_at = now()
    WHERE order_id = p_order_id AND status = 'OPEN'
    RETURNING 1
  )
  SELECT count(*) INTO v_cancelled FROM upd;

  IF v_released > 0 OR v_cancelled > 0 THEN
    INSERT INTO inventory_audit_logs (company_id, entity, entity_id, action, detail, actor_employee_id)
    VALUES (v_company, 'order', p_order_id, 'ORDER_STOCK_RELEASED',
            jsonb_build_object('released_reservations', v_released, 'cancelled_requirements', v_cancelled),
            p_actor);
  END IF;

  RETURN jsonb_build_object('released_reservations', v_released, 'cancelled_requirements', v_cancelled);
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. RLS + GRANTS (same convention as the inventory module migration)
-- ---------------------------------------------------------------------------
ALTER TABLE inventory_purchase_requirements ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_read ON inventory_purchase_requirements;
CREATE POLICY inventory_read ON inventory_purchase_requirements
  FOR SELECT TO authenticated USING (true);

GRANT SELECT ON inventory_purchase_requirements TO authenticated;
