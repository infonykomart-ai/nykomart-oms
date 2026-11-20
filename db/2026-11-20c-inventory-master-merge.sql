-- =============================================================================
-- 2026-11-20c — MASTER SKU MERGE (Phase B)
-- =============================================================================
-- Authorized administrators can merge duplicate Master SKUs. A merge never
-- deletes a Master SKU: the source is marked inactive with merged_into_id and
-- stays queryable forever, while every store mapping, variant link and
-- reservation moves to the target in ONE transaction.
--
-- Hard safety rules (enforced in the database, not only the UI):
--   • source and target must be different
--   • an already-merged source cannot be merged again
--   • both must be active and unmerged
--   • size label + colour must match (case/whitespace-normalised only)
--   • the master product material + construction must match, so physically
--     non-interchangeable products can never be merged just because someone
--     clicked the wrong row
--   • if both sides already have a variant row in the same product/size/colour,
--     the merge is refused instead of violating that variant's unique key
--
-- Additive and re-runnable. No existing Master SKU or mapping is changed until
-- an administrator actually calls the function.
-- =============================================================================

BEGIN;

ALTER TABLE inventory_master_variants
  ADD COLUMN IF NOT EXISTS merged_into_id uuid REFERENCES inventory_master_variants(id);
CREATE INDEX IF NOT EXISTS idx_inventory_master_variants_merged_into
  ON inventory_master_variants(merged_into_id) WHERE merged_into_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS inventory_master_merge_log (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_variant_id     uuid NOT NULL REFERENCES inventory_master_variants(id),
  target_variant_id     uuid NOT NULL REFERENCES inventory_master_variants(id),
  source_master_sku     citext NOT NULL,
  target_master_sku     citext NOT NULL,
  mappings_moved        integer NOT NULL DEFAULT 0,
  variants_moved        integer NOT NULL DEFAULT 0,
  reservations_moved    integer NOT NULL DEFAULT 0,
  reason                text,
  merged_by_employee_id uuid REFERENCES employees(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_master_merge_log_target
  ON inventory_master_merge_log(target_variant_id, created_at DESC);

ALTER TABLE inventory_master_merge_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_read ON inventory_master_merge_log;
CREATE POLICY inventory_read ON inventory_master_merge_log
  FOR SELECT TO authenticated USING (true);

CREATE OR REPLACE FUNCTION inventory_merge_master_variants(
  p_source_variant_id uuid,
  p_target_variant_id uuid,
  p_actor             uuid DEFAULT NULL,
  p_reason            text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_src             inventory_master_variants;
  v_tgt             inventory_master_variants;
  v_src_material    text;
  v_src_construction text;
  v_tgt_material    text;
  v_tgt_construction text;
  v_mappings        integer := 0;
  v_variants        integer := 0;
  v_reservations    integer := 0;
  v_normalised_size text;
BEGIN
  IF p_source_variant_id IS NULL OR p_target_variant_id IS NULL THEN
    RAISE EXCEPTION 'Choose both a source and a target Master SKU.';
  END IF;
  IF p_source_variant_id = p_target_variant_id THEN
    RAISE EXCEPTION 'Source and target Master SKU must be different.';
  END IF;

  SELECT * INTO v_src FROM inventory_master_variants WHERE id = p_source_variant_id FOR UPDATE;
  IF v_src.id IS NULL THEN RAISE EXCEPTION 'Source Master SKU not found.'; END IF;
  SELECT * INTO v_tgt FROM inventory_master_variants WHERE id = p_target_variant_id FOR UPDATE;
  IF v_tgt.id IS NULL THEN RAISE EXCEPTION 'Target Master SKU not found.'; END IF;

  IF v_src.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'Master SKU % is already merged into another Master SKU.', v_src.master_sku;
  END IF;
  IF v_tgt.merged_into_id IS NOT NULL THEN
    RAISE EXCEPTION 'Target Master SKU % is itself merged; choose the surviving Master SKU.', v_tgt.master_sku;
  END IF;
  IF NOT v_src.active OR NOT v_tgt.active THEN
    RAISE EXCEPTION 'Both Master SKUs must be active to merge.';
  END IF;

  -- Size/colour comparison is case/space insensitive ONLY. No unit conversion.
  IF lower(btrim(v_src.size_label)) <> lower(btrim(v_tgt.size_label))
     OR lower(btrim(coalesce(v_src.size_unit, ''))) <> lower(btrim(coalesce(v_tgt.size_unit, '')))
     OR lower(btrim(v_src.colour)) <> lower(btrim(v_tgt.colour)) THEN
    RAISE EXCEPTION 'These Master SKUs differ in size or colour. Merging them would mix non-interchangeable physical stock.';
  END IF;

  SELECT material, construction INTO v_src_material, v_src_construction
  FROM inventory_master_products WHERE id = v_src.master_product_id;
  SELECT material, construction INTO v_tgt_material, v_tgt_construction
  FROM inventory_master_products WHERE id = v_tgt.master_product_id;

  IF lower(btrim(coalesce(v_src_material, ''))) <> lower(btrim(coalesce(v_tgt_material, '')))
     OR lower(btrim(coalesce(v_src_construction, ''))) <> lower(btrim(coalesce(v_tgt_construction, ''))) THEN
    RAISE EXCEPTION 'The master products differ in material or construction. These are different physical products and cannot be merged.';
  END IF;

  -- Refuse instead of violating inventory_product_variants' unique key.
  IF EXISTS (
    SELECT 1
    FROM inventory_product_variants s
    JOIN inventory_product_variants t
      ON t.product_id = s.product_id
     AND t.size_label = s.size_label
     AND t.colour = s.colour
    WHERE s.master_variant_id = p_source_variant_id
      AND t.master_variant_id = p_target_variant_id
  ) THEN
    RAISE EXCEPTION 'Both Master SKUs already have a variant in the same product/size/colour. Resolve that duplicate variant first.';
  END IF;

  -- Mapping history is written BEFORE the rows move, so old -> new is auditable.
  INSERT INTO inventory_store_sku_map_history
    (map_id, company_id, store_id, store_sku, old_master_variant_id, new_master_variant_id, action, reason, changed_by_employee_id)
  SELECT m.id, m.company_id, m.store_id, m.store_sku, p_source_variant_id, p_target_variant_id,
         'MERGED', p_reason, p_actor
  FROM inventory_store_sku_map m
  WHERE m.master_variant_id = p_source_variant_id;

  WITH moved AS (
    UPDATE inventory_store_sku_map
    SET master_variant_id = p_target_variant_id, updated_at = now()
    WHERE master_variant_id = p_source_variant_id
    RETURNING 1
  )
  SELECT count(*) INTO v_mappings FROM moved;

  WITH moved AS (
    UPDATE inventory_product_variants
    SET master_variant_id = p_target_variant_id
    WHERE master_variant_id = p_source_variant_id
    RETURNING 1
  )
  SELECT count(*) INTO v_variants FROM moved;

  WITH moved AS (
    UPDATE inventory_reservations
    SET master_variant_id = p_target_variant_id
    WHERE master_variant_id = p_source_variant_id
    RETURNING 1
  )
  SELECT count(*) INTO v_reservations FROM moved;

  UPDATE inventory_master_variants
  SET active = false,
      merged_into_id = p_target_variant_id,
      updated_at = now()
  WHERE id = p_source_variant_id;

  INSERT INTO inventory_master_merge_log
    (source_variant_id, target_variant_id, source_master_sku, target_master_sku,
     mappings_moved, variants_moved, reservations_moved, reason, merged_by_employee_id)
  VALUES
    (p_source_variant_id, p_target_variant_id, v_src.master_sku, v_tgt.master_sku,
     v_mappings, v_variants, v_reservations, p_reason, p_actor);

  RETURN jsonb_build_object(
    'source_master_sku', v_src.master_sku,
    'target_master_sku', v_tgt.master_sku,
    'mappings_moved', v_mappings,
    'variants_moved', v_variants,
    'reservations_moved', v_reservations
  );
END;
$$;

COMMENT ON FUNCTION inventory_merge_master_variants(uuid, uuid, uuid, text) IS
  '2026-11-20c: atomically merges a duplicate Master SKU into the surviving one. '
  'Moves store mappings (with history), variant links and reservations, marks the '
  'source inactive with merged_into_id, and writes inventory_master_merge_log. '
  'Refuses size/colour/material/construction mismatches.';

COMMIT;

-- =============================================================================
-- VERIFICATION
-- =============================================================================
-- SELECT count(*) FROM inventory_master_variants WHERE merged_into_id IS NOT NULL;
-- SELECT * FROM inventory_master_merge_log ORDER BY created_at DESC LIMIT 20;
-- =============================================================================
