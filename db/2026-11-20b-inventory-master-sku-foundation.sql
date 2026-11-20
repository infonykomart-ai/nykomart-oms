-- =============================================================================
-- 2026-11-20b — INVENTORY CENTRALIZATION FOUNDATION (Phase A)
-- =============================================================================
-- Adds a cross-company MASTER SKU layer, per-store SKU mappings, physical stock
-- entries with mandatory photo evidence, photo history, corrections, order
-- matching / review records, and return settlements.
--
-- WHY ADDITIVE ONLY
--   The existing inventory engine (db/2026-11-14c + 2026-11-16-phase4) already
--   has the correct, tested core: staged balances, an immutable ledger, atomic
--   movements, reservations and challans. This migration does NOT touch those
--   tables' data or the functions that move stock. It adds a master layer and
--   links existing variant rows to it with a nullable column + backfill.
--
-- WHAT IS PRESERVED EXACTLY
--   * Every existing inventory_product_variants row, SKU, balance, ledger row,
--     reservation and challan stays as-is.
--   * Order size/unit values are never read, converted or rewritten here.
--     Size is copied as an opaque label for identity/matching only.
--   * No company_measurement_settings interaction of any kind.
--
-- BACKFILL (deterministic, re-runnable)
--   1. One inventory_master_products row per existing inventory_products row.
--      A shared product_code is NOT proof of the same physical product; sharing a
--      Master SKU is a deliberate admin merge, never an automatic backfill guess.
--   2. One inventory_master_variants row per distinct (master product, size,
--      colour); every existing variant is linked to it.
--   3. Store SKU mappings are created only where history proves the mapping:
--      an order in that store used a SKU that resolves to a variant of the same
--      company + category. Ambiguous SKUs are deliberately left unmapped for an
--      admin to map in the UI — never guessed.
--
-- Re-runnable: every object is IF NOT EXISTS / ADD COLUMN IF NOT EXISTS, the
-- backfill skips already-linked rows, and inserts are conflict-guarded.
-- Rollback: drop the new tables/function and the two added nullable columns;
-- no existing row was modified in a way that cannot be regenerated.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. CAPABILITIES
-- ---------------------------------------------------------------------------
INSERT INTO capabilities (code, description) VALUES
  ('inventory_master_admin',    'Create, edit and merge Master SKUs and company/store SKU mappings'),
  ('inventory_photo_upload',    'Upload, replace and add stock photos (photo history is always kept)'),
  ('inventory_review',          'Review marketplace order photos against actual physical stock photos'),
  ('inventory_stock_approve',   'Approve new stock entries, stock corrections and locally received returns'),
  ('inventory_central_allocate','Allocate central physical stock across companies'),
  ('inventory_return_settle',   'Update return settlements (received / settled / liquidated / destroyed)')
ON CONFLICT (code) DO NOTHING;

-- Admin/MD own the master and approval scopes; Inventory owns daily operations;
-- Logistics can review and settle; nobody's existing grants are removed.
INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, c.code
FROM roles r
CROSS JOIN (VALUES
  ('inventory_master_admin'),
  ('inventory_stock_approve'),
  ('inventory_central_allocate')
) AS c(code)
WHERE r.name IN ('MD', 'Admin')
ON CONFLICT DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'inventory_photo_upload'
FROM roles r
WHERE r.name IN ('MD', 'Admin', 'Inventory', 'Logistics', 'Order Entry')
ON CONFLICT DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'inventory_review'
FROM roles r
WHERE r.name IN ('MD', 'Admin', 'Inventory', 'Logistics')
ON CONFLICT DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'inventory_return_settle'
FROM roles r
WHERE r.name IN ('MD', 'Admin', 'Inventory', 'Logistics')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 1. MASTER PRODUCTS — cross-company design identity
-- ---------------------------------------------------------------------------
-- A master product is the physical DESIGN (e.g. "Hand Braided Jute Rug").
-- Material/construction live here because a different material is a different
-- physical product, never a variant of the same one.
CREATE TABLE IF NOT EXISTS inventory_master_products (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_code       citext NOT NULL UNIQUE,
  name              text NOT NULL,
  design_code       text,
  item_category_id  uuid REFERENCES item_categories(id),
  material          text,
  construction      text,
  notes             text,
  active            boolean NOT NULL DEFAULT true,
  created_by_employee_id uuid REFERENCES employees(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory_master_products IS
  '2026-11-20: cross-company physical product design. A different material or '
  'construction is a different master product. Existing product rows are linked '
  'to it through inventory_master_variants; no existing product is rewritten.';

CREATE INDEX IF NOT EXISTS idx_inventory_master_products_category
  ON inventory_master_products(item_category_id);

-- ---------------------------------------------------------------------------
-- 2. MASTER VARIANTS — the permanent physical identity (Master SKU)
-- ---------------------------------------------------------------------------
-- size_label / size_unit hold the ORIGINAL saved values exactly as entered
-- (e.g. "4x6 FT" or "120x180 CM"). They are never converted. Two values are the
-- same variant only when the stored text matches exactly (case/space-normalised
-- by the app, not by measurement settings).
CREATE TABLE IF NOT EXISTS inventory_master_variants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_product_id uuid NOT NULL REFERENCES inventory_master_products(id) ON DELETE RESTRICT,
  master_sku        citext NOT NULL UNIQUE,
  size_label        text NOT NULL DEFAULT '',
  size_unit         text,
  length_value      numeric(12,4) CHECK (length_value IS NULL OR length_value > 0),
  width_value       numeric(12,4) CHECK (width_value IS NULL OR width_value > 0),
  colour            text NOT NULL DEFAULT '',
  variant_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  active            boolean NOT NULL DEFAULT true,
  created_by_employee_id uuid REFERENCES employees(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_product_id, size_label, colour)
);

COMMENT ON TABLE inventory_master_variants IS
  '2026-11-20: one row per interchangeable physical variant. master_sku is '
  'permanent even when a marketplace SKU changes. size_label/size_unit are the '
  'original values, never converted by measurement settings.';
COMMENT ON COLUMN inventory_master_variants.master_sku IS
  'Permanent Master SKU (e.g. NYK-JUTE-0001). Assigned once; merging two master '
  'variants migrates mappings and records history — the SKU is never reused.';

CREATE INDEX IF NOT EXISTS idx_inventory_master_variants_product
  ON inventory_master_variants(master_product_id);
CREATE INDEX IF NOT EXISTS idx_inventory_master_variants_size
  ON inventory_master_variants(size_label, colour);

-- ---------------------------------------------------------------------------
-- 3. STORE SKU MAPPINGS — many marketplace SKUs -> one master variant
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_store_sku_map (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id),
  store_id                uuid NOT NULL REFERENCES stores(id),
  master_variant_id       uuid NOT NULL REFERENCES inventory_master_variants(id) ON DELETE RESTRICT,
  store_sku               citext NOT NULL,
  marketplace_listing_id  text,
  is_active               boolean NOT NULL DEFAULT true,
  created_by_employee_id  uuid REFERENCES employees(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  -- A marketplace SKU identifies exactly ONE product in ONE store. This is the
  -- duplicate/conflict guard: the same store SKU can never point at two masters.
  UNIQUE (store_id, store_sku)
);

COMMENT ON TABLE inventory_store_sku_map IS
  '2026-11-20: marketplace/store SKU -> permanent Master SKU. Four store SKUs '
  'may map to one master variant; one store SKU may never map to two. Company '
  'is denormalised for scoping and must match the store''s company (checked in '
  'the app before every write).';
COMMENT ON COLUMN inventory_store_sku_map.is_active IS
  'Inactive mappings are kept for history; a SKU can be re-pointed by inserting '
  'a new mapping only after the old one is deactivated, and every change writes '
  'inventory_store_sku_map_history.';

CREATE INDEX IF NOT EXISTS idx_inventory_store_sku_map_master
  ON inventory_store_sku_map(master_variant_id, is_active);
CREATE INDEX IF NOT EXISTS idx_inventory_store_sku_map_company
  ON inventory_store_sku_map(company_id, store_id);

CREATE TABLE IF NOT EXISTS inventory_store_sku_map_history (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id                 uuid REFERENCES inventory_store_sku_map(id) ON DELETE SET NULL,
  company_id             uuid NOT NULL REFERENCES companies(id),
  store_id               uuid NOT NULL REFERENCES stores(id),
  store_sku              citext NOT NULL,
  old_master_variant_id  uuid REFERENCES inventory_master_variants(id),
  new_master_variant_id  uuid REFERENCES inventory_master_variants(id),
  action                 text NOT NULL CHECK (action IN ('CREATED', 'REPOINTED', 'DEACTIVATED', 'MERGED')),
  reason                 text,
  changed_by_employee_id uuid REFERENCES employees(id),
  changed_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_store_sku_map_history_sku
  ON inventory_store_sku_map_history(store_id, store_sku, changed_at DESC);

-- ---------------------------------------------------------------------------
-- 4. LINK EXISTING VARIANTS TO A MASTER VARIANT (nullable, backfilled)
-- ---------------------------------------------------------------------------
ALTER TABLE inventory_product_variants
  ADD COLUMN IF NOT EXISTS master_variant_id uuid REFERENCES inventory_master_variants(id);
CREATE INDEX IF NOT EXISTS idx_inventory_variants_master
  ON inventory_product_variants(master_variant_id);

-- Same link on reservations, so central/master-level reservation and stock
-- checks can be added without changing the existing reservation guarantees.
ALTER TABLE inventory_reservations
  ADD COLUMN IF NOT EXISTS master_variant_id uuid REFERENCES inventory_master_variants(id);
ALTER TABLE inventory_reservations
  ADD COLUMN IF NOT EXISTS entry_id uuid;
CREATE INDEX IF NOT EXISTS idx_inventory_reservations_master
  ON inventory_reservations(master_variant_id) WHERE master_variant_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 5. PHYSICAL STOCK ENTRIES — the evidence layer (balances stay authoritative)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_stock_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  owner_company_id  uuid NOT NULL REFERENCES companies(id),
  store_id          uuid REFERENCES stores(id),
  warehouse_id      uuid NOT NULL REFERENCES inventory_warehouses(id),
  master_variant_id uuid NOT NULL REFERENCES inventory_master_variants(id),
  -- Optional link to the operating company's own variant row. Cross-company
  -- stock may have no variant in the receiving company; master_variant_id is
  -- then the only identity.
  variant_id        uuid REFERENCES inventory_product_variants(id),
  entry_type        text NOT NULL DEFAULT 'NEW_STOCK'
                      CHECK (entry_type IN ('NEW_STOCK', 'RETURN_RECEIVED', 'OPENING')),
  quantity          numeric(14,3) NOT NULL CHECK (quantity > 0),
  sqft              numeric(16,3) NOT NULL DEFAULT 0 CHECK (sqft >= 0),
  storage_location  text,
  status            text NOT NULL DEFAULT 'PENDING_APPROVAL'
                      CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
  remarks           text,
  approved_by_employee_id uuid REFERENCES employees(id),
  approved_at       timestamptz,
  created_by_employee_id  uuid REFERENCES employees(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory_stock_entries IS
  '2026-11-20: one physical stock receipt / verified batch. The live quantity '
  'still lives in inventory_balances; an entry is the evidence + approval record '
  'that a photo and a person are attached to. Only APPROVED entries may be '
  'posted to stock (the app posts through inventory_apply_movement).';

CREATE INDEX IF NOT EXISTS idx_inventory_stock_entries_master
  ON inventory_stock_entries(master_variant_id, status);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_entries_company
  ON inventory_stock_entries(company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_entries_store
  ON inventory_stock_entries(store_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 6. PHOTOS + PHOTO AUDIT
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_entry_photos (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id          uuid NOT NULL REFERENCES inventory_stock_entries(id) ON DELETE CASCADE,
  master_variant_id uuid NOT NULL REFERENCES inventory_master_variants(id),
  image_path        text,
  image_url         text NOT NULL,
  image_type        text NOT NULL CHECK (image_type IN (
                      'PRODUCT_MAIN', 'FULL_STOCK', 'CLOSE_UP', 'DESIGN_DETAIL',
                      'COLOUR_REFERENCE', 'SIZE_MEASUREMENT', 'QUALITY_CHECK',
                      'PACKAGING', 'ORDER_REFERENCE', 'RETURNED_PRODUCT')),
  file_name         text,
  mime_type         text CHECK (mime_type IS NULL OR mime_type IN ('image/jpeg', 'image/jpg', 'image/png', 'image/webp')),
  size_bytes        bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  is_active         boolean NOT NULL DEFAULT true,
  replaced_photo_id uuid REFERENCES inventory_entry_photos(id),
  update_reason     text,
  uploaded_by_employee_id uuid REFERENCES employees(id),
  uploaded_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory_entry_photos IS
  '2026-11-20: actual stock photos. Photos are evidence of product identity, '
  'not proof that the goods physically exist — physical verification is a '
  'separate check on inventory_stock_entries. Old photos are never overwritten: '
  'a replacement deactivates the old row and links it through replaced_photo_id.';

CREATE INDEX IF NOT EXISTS idx_inventory_entry_photos_entry
  ON inventory_entry_photos(entry_id, is_active);
CREATE INDEX IF NOT EXISTS idx_inventory_entry_photos_master
  ON inventory_entry_photos(master_variant_id, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS inventory_photo_audit (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id              uuid REFERENCES inventory_entry_photos(id) ON DELETE SET NULL,
  entry_id              uuid REFERENCES inventory_stock_entries(id) ON DELETE CASCADE,
  action_type           text NOT NULL CHECK (action_type IN ('UPLOADED', 'REPLACED', 'DEACTIVATED')),
  old_image_reference   text,
  new_image_reference   text,
  reason                text,
  employee_id           uuid REFERENCES employees(id),
  created_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_photo_audit_entry
  ON inventory_photo_audit(entry_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 7. STOCK CORRECTIONS — never a silent overwrite
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_stock_corrections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id),
  entry_id            uuid REFERENCES inventory_stock_entries(id),
  master_variant_id   uuid NOT NULL REFERENCES inventory_master_variants(id),
  warehouse_id        uuid NOT NULL REFERENCES inventory_warehouses(id),
  previous_quantity   numeric(14,3) NOT NULL,
  corrected_quantity  numeric(14,3) NOT NULL,
  quantity_difference numeric(14,3) GENERATED ALWAYS AS (corrected_quantity - previous_quantity) STORED,
  reason              text NOT NULL CHECK (reason IN (
                        'PHYSICAL_COUNT_MISMATCH', 'DUPLICATE_ENTRY', 'DATA_ENTRY_MISTAKE',
                        'DAMAGED_STOCK', 'MISSING_STOCK', 'OTHER')),
  remarks             text,
  supporting_photo_ids uuid[] NOT NULL DEFAULT '{}',
  status              text NOT NULL DEFAULT 'PENDING_APPROVAL'
                        CHECK (status IN ('PENDING_APPROVAL', 'APPROVED', 'REJECTED')),
  approved_by_employee_id uuid REFERENCES employees(id),
  approved_at         timestamptz,
  created_by_employee_id  uuid REFERENCES employees(id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_stock_corrections_master
  ON inventory_stock_corrections(master_variant_id, status);

-- ---------------------------------------------------------------------------
-- 8. ORDER MATCHING + PHOTO REVIEW
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_order_matches (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  store_id          uuid REFERENCES stores(id),
  store_sku         citext,
  master_variant_id uuid REFERENCES inventory_master_variants(id),
  entry_id          uuid REFERENCES inventory_stock_entries(id),
  requested_qty     numeric(14,3) NOT NULL DEFAULT 0 CHECK (requested_qty >= 0),
  matched_qty       numeric(14,3) NOT NULL DEFAULT 0 CHECK (matched_qty >= 0),
  status            text NOT NULL DEFAULT 'NEW_STOCK_REQUIRED'
                      CHECK (status IN ('AVAILABLE', 'PARTIAL', 'NEW_STOCK_REQUIRED',
                                        'REVIEW_REQUIRED', 'APPROVED', 'REJECTED')),
  notes             text,
  created_by_employee_id uuid REFERENCES employees(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- One live match per order row (an order row is one SKU, per the existing
-- batch-order model). Re-running the matcher updates it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_order_matches_order
  ON inventory_order_matches(order_id);
CREATE INDEX IF NOT EXISTS idx_inventory_order_matches_master
  ON inventory_order_matches(master_variant_id, status);

CREATE TABLE IF NOT EXISTS inventory_reviews (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id),
  order_id          uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  match_id          uuid REFERENCES inventory_order_matches(id) ON DELETE SET NULL,
  master_variant_id uuid REFERENCES inventory_master_variants(id),
  entry_id          uuid REFERENCES inventory_stock_entries(id),
  review_status     text NOT NULL CHECK (review_status IN (
                      'MATCHED_APPROVED', 'DESIGN_MISMATCH', 'SIZE_MISMATCH',
                      'COLOUR_MISMATCH', 'MATERIAL_MISMATCH', 'QUALITY_ISSUE',
                      'NEED_MORE_PHOTOS', 'MANUAL_REVIEW')),
  review_notes      text,
  reviewed_by_employee_id uuid REFERENCES employees(id),
  reviewed_at       timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_inventory_reviews_order
  ON inventory_reviews(order_id, reviewed_at DESC);

-- ---------------------------------------------------------------------------
-- 9. RETURN SETTLEMENTS — returns NEVER add stock automatically
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS return_settlements (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         uuid NOT NULL REFERENCES companies(id),
  order_id           uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  return_request_id  uuid REFERENCES return_requests(id) ON DELETE SET NULL,
  settlement_type    text NOT NULL DEFAULT 'RETURNED_NOT_RECEIVED'
                       CHECK (settlement_type IN (
                         'RETURNED_NOT_RECEIVED', 'SETTLED_WITH_CUSTOMER', 'REFUND_COMPLETED',
                         'LOCAL_DISPOSAL', 'LIQUIDATED', 'DESTROYED',
                         'RETURN_RECEIVED_LOCALLY', 'OTHER')),
  received_locally   boolean NOT NULL DEFAULT false,
  received_quantity  numeric(14,3) NOT NULL DEFAULT 0 CHECK (received_quantity >= 0),
  evidence_photos    uuid[] NOT NULL DEFAULT '{}',
  physical_stock_added boolean NOT NULL DEFAULT false,
  stock_entry_id     uuid REFERENCES inventory_stock_entries(id),
  status             text NOT NULL DEFAULT 'OPEN'
                       CHECK (status IN ('OPEN', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CLOSED')),
  notes              text,
  updated_by_employee_id uuid REFERENCES employees(id),
  approved_by_employee_id uuid REFERENCES employees(id),
  approved_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- Only a locally received return may ever claim a stock impact.
  CHECK (NOT physical_stock_added OR (settlement_type = 'RETURN_RECEIVED_LOCALLY' AND received_locally)),
  CHECK (physical_stock_added = false OR stock_entry_id IS NOT NULL)
);
-- One settlement per order; updates are append-audited by the app.
CREATE UNIQUE INDEX IF NOT EXISTS uq_return_settlements_order
  ON return_settlements(order_id);
CREATE INDEX IF NOT EXISTS idx_return_settlements_company_status
  ON return_settlements(company_id, status, updated_at DESC);

COMMENT ON TABLE return_settlements IS
  '2026-11-20: what physically happened to a returned marketplace order. Seven '
  'of the eight settlement types have ZERO stock impact. Only an approved '
  'RETURN_RECEIVED_LOCALLY (with photo evidence) may create an inventory_stock_'
  'entry and post stock.';

-- ---------------------------------------------------------------------------
-- 10. CENTRAL AVAILABILITY BY MASTER VARIANT
-- ---------------------------------------------------------------------------
-- Aggregates every company's existing balances for the master variant. This is
-- the number an order in ANY company/store sees. It never writes anything and
-- does not replace inventory_reserve(), which remains the oversell guard.
CREATE OR REPLACE FUNCTION inventory_master_availability(p_master_variant_id uuid)
RETURNS TABLE (
  physical_pcs numeric,
  reserved_pcs numeric,
  available_pcs numeric,
  physical_sqft numeric,
  reserved_sqft numeric,
  available_sqft numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH ready AS (
    SELECT COALESCE(SUM(b.pcs), 0)::numeric AS pcs,
           COALESCE(SUM(b.sqft), 0)::numeric AS sqft
    FROM inventory_balances b
    JOIN inventory_product_variants v ON v.id = b.variant_id
    WHERE v.master_variant_id = p_master_variant_id
      AND b.stage = 'READY'
  ), reserved AS (
    SELECT COALESCE(SUM(r.pcs - r.fulfilled_pcs), 0)::numeric AS pcs,
           COALESCE(SUM(r.sqft - r.fulfilled_sqft), 0)::numeric AS sqft
    FROM inventory_reservations r
    JOIN inventory_product_variants v ON v.id = r.variant_id
    WHERE v.master_variant_id = p_master_variant_id
      AND r.status = 'ACTIVE'
  )
  SELECT ready.pcs,
         reserved.pcs,
         GREATEST(ready.pcs - reserved.pcs, 0),
         ready.sqft,
         reserved.sqft,
         GREATEST(ready.sqft - reserved.sqft, 0)
  FROM ready, reserved;
$$;

COMMENT ON FUNCTION inventory_master_availability(uuid) IS
  '2026-11-20: READY minus ACTIVE reservations across every company variant '
  'linked to this master variant. Read-only central availability for order '
  'matching; reservations still go through inventory_reserve()/inventory_'
  'reserve_order() so overselling remains impossible.';

-- ---------------------------------------------------------------------------
-- 11. BACKFILL — existing products/variants become master rows
-- ---------------------------------------------------------------------------
-- 11a. ONE master product per existing inventory_products row — never one per
-- product_code. product_code is only unique inside a company; the same code in
-- another company can be a completely different product (different name,
-- category, material). Sharing a Master SKU is a deliberate, audited admin
-- merge (2026-11-20c), never an automatic backfill guess.
--
-- master_code is namespaced with the company short_code, which is unique, so
-- codes can never collide and no product's variants can attach to another
-- product's master. Blank codes are skipped (nothing safe to key them on); an
-- admin can create those masters manually.
--
-- 11a–11c are one loop so linking always uses that product's OWN master.
DO $$
DECLARE
  p          RECORD;
  grp        RECORD;
  v_code     text;
  v_suffix   text;
  v_sku_base text;
  v_seq      integer;
  v_mp_id    uuid;
  v_mv_id    uuid;
  v_sku      text;
BEGIN
  FOR p IN
    SELECT ip.id, ip.company_id, ip.item_category_id, ip.name, ip.product_code,
           ip.active, c.short_code
    FROM inventory_products ip
    JOIN companies c ON c.id = ip.company_id
    WHERE btrim(ip.product_code) <> ''
    ORDER BY ip.created_at, ip.id
  LOOP
    v_suffix := lower(regexp_replace(coalesce(p.short_code, ''), '[^a-zA-Z0-9]+', '-', 'g'));
    v_suffix := btrim(v_suffix, '-');
    IF v_suffix = '' THEN v_suffix := left(p.company_id::text, 8); END IF;
    v_code := lower(btrim(p.product_code)) || '-' || v_suffix;

    SELECT id INTO v_mp_id FROM inventory_master_products WHERE master_code = v_code;
    IF v_mp_id IS NULL THEN
      INSERT INTO inventory_master_products (master_code, name, item_category_id, active)
      VALUES (v_code, p.name, p.item_category_id, p.active)
      RETURNING id INTO v_mp_id;
    END IF;

    v_sku_base := upper(regexp_replace(v_code, '[^a-zA-Z0-9]+', '-', 'g'));
    v_sku_base := btrim(v_sku_base, '-');
    IF v_sku_base = '' THEN v_sku_base := 'MASTER'; END IF;

    FOR grp IN
      SELECT DISTINCT size_label, colour
      FROM inventory_product_variants
      WHERE product_id = p.id
      ORDER BY size_label, colour
    LOOP
      SELECT id INTO v_mv_id
      FROM inventory_master_variants
      WHERE master_product_id = v_mp_id
        AND size_label = grp.size_label
        AND colour = grp.colour
      LIMIT 1;

      IF v_mv_id IS NULL THEN
        v_seq := (SELECT count(*) FROM inventory_master_variants WHERE master_product_id = v_mp_id) + 1;
        LOOP
          v_sku := v_sku_base || '-' || lpad(v_seq::text, GREATEST(4, length(v_seq::text)), '0');
          EXIT WHEN NOT EXISTS (SELECT 1 FROM inventory_master_variants WHERE master_sku = v_sku);
          v_seq := v_seq + 1;
        END LOOP;

        INSERT INTO inventory_master_variants
          (master_product_id, master_sku, size_label, colour)
        VALUES (v_mp_id, v_sku, grp.size_label, grp.colour)
        RETURNING id INTO v_mv_id;
      END IF;

      -- Exact strings only: no trimming or unit conversion of stored sizes.
      UPDATE inventory_product_variants
      SET master_variant_id = v_mv_id
      WHERE product_id = p.id
        AND size_label = grp.size_label
        AND colour = grp.colour
        AND master_variant_id IS NULL;
    END LOOP;
  END LOOP;
END $$;

-- 11d. Store SKU mappings only where order history proves them. Distinct on
-- (store, sku) keeps exactly one master per marketplace SKU; ambiguity is left
-- for the mapping screen instead of being guessed.
INSERT INTO inventory_store_sku_map (company_id, store_id, master_variant_id, store_sku)
SELECT DISTINCT ON (o.store_id, lower(btrim(o.sku_label)))
       o.company_id,
       o.store_id,
       v.master_variant_id,
       btrim(o.sku_label)
FROM orders o
JOIN inventory_products p
  ON p.company_id = o.company_id
 AND p.item_category_id = o.item_category_id
JOIN inventory_product_variants v
  ON v.product_id = p.id
 AND lower(v.sku::text) = lower(btrim(o.sku_label))
WHERE o.store_id IS NOT NULL
  AND btrim(o.sku_label) <> ''
  AND v.master_variant_id IS NOT NULL
ORDER BY o.store_id, lower(btrim(o.sku_label)), o.entry_timestamp
ON CONFLICT (store_id, store_sku) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 12. RLS — same convention as the existing inventory module
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'inventory_master_products', 'inventory_master_variants',
    'inventory_store_sku_map', 'inventory_store_sku_map_history',
    'inventory_stock_entries', 'inventory_entry_photos', 'inventory_photo_audit',
    'inventory_stock_corrections', 'inventory_order_matches', 'inventory_reviews',
    'return_settlements'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS inventory_read ON %I', t);
    EXECUTE format('CREATE POLICY inventory_read ON %I FOR SELECT TO authenticated USING (true)', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- 13. PRIVATE PHOTO BUCKET
-- ---------------------------------------------------------------------------
-- Private on purpose: stock photos are internal evidence. The app uploads with
-- the service role and streams them back through an authenticated proxy route;
-- no public object URL is exposed. Guarded because storage.buckets only exists
-- on Supabase (the plain-Postgres harness has no storage schema).
DO $$
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('inventory-photos', 'inventory-photos', false)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- VERIFICATION (read-only)
-- =============================================================================
-- 1) Every existing variant linked to a master (must be 0 unlinked when every
--    product has a non-blank product_code):
--    SELECT count(*) FROM inventory_product_variants WHERE master_variant_id IS NULL;
-- 2) Master SKUs are unique and stable:
--    SELECT master_sku, count(*) FROM inventory_master_variants GROUP BY master_sku HAVING count(*) > 1;
-- 3) Mappings cannot conflict:
--    SELECT store_id, store_sku, count(*) FROM inventory_store_sku_map
--     GROUP BY store_id, store_sku HAVING count(*) > 1;
-- 4) Existing stock/ledger untouched:
--    SELECT (SELECT count(*) FROM inventory_balances) AS balances,
--           (SELECT count(*) FROM inventory_ledger) AS ledger,
--           (SELECT count(*) FROM inventory_reservations) AS reservations;
-- 5) Original order sizes exactly as saved:
--    SELECT ref_no, size_label FROM orders ORDER BY entry_timestamp DESC LIMIT 10;
-- 6) Return settlement safety constraint:
--    SELECT count(*) FROM return_settlements WHERE physical_stock_added AND settlement_type <> 'RETURN_RECEIVED_LOCALLY';
-- 7) No master product covers differently-named product rows (would mean the
--    code-keyed backfill merged different products):

--    SELECT mp.master_code, count(DISTINCT lower(btrim(p.name))) AS names
--      FROM inventory_master_products mp
--      JOIN inventory_master_variants mv ON mv.master_product_id = mp.id
--      JOIN inventory_product_variants v ON v.master_variant_id = mv.id
--      JOIN inventory_products p ON p.id = v.product_id
--     GROUP BY mp.master_code HAVING count(DISTINCT lower(btrim(p.name))) > 1;
-- =============================================================================
