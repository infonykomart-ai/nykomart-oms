-- =============================================================================
-- 2026-11-20d — MASTER SKU PHOTOS
-- =============================================================================
-- Answers "Master SKU banne ke baad uski photo kahan add hogi?" — until now the
-- only photo table (inventory_entry_photos) hangs off a PHYSICAL STOCK ENTRY,
-- so a Master SKU could not carry a reference photo before stock arrived.
--
-- This adds a photo album on the Master SKU itself:
--   * one row per uploaded photo, attached to inventory_master_variants
--   * the newest active photo is the variant's reference photo
--   * photos are NEVER overwritten — a replacement deactivates the old row and
--     links it through replaced_photo_id (same rule as stock-entry photos)
--   * files live in the SAME private `inventory-photos` bucket (2026-11-20b)
--     under masters/<variant_id>/ and are only served through the app's
--     authenticated proxy route — no public URL is stored or exposed
--
-- Additive only: no existing table, row or photo is touched. Re-runnable.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS inventory_master_variant_photos (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  master_variant_id       uuid NOT NULL REFERENCES inventory_master_variants(id) ON DELETE CASCADE,
  -- Object path inside the private `inventory-photos` bucket. Never a public URL.
  image_path              text NOT NULL,
  image_type              text NOT NULL DEFAULT 'PRODUCT_MAIN'
                            CHECK (image_type IN (
                              'PRODUCT_MAIN', 'DESIGN_DETAIL', 'COLOUR_REFERENCE',
                              'SIZE_MEASUREMENT', 'QUALITY_CHECK', 'PACKAGING')),
  file_name               text,
  mime_type               text CHECK (mime_type IS NULL OR mime_type IN ('image/jpeg', 'image/jpg', 'image/png', 'image/webp')),
  size_bytes              bigint CHECK (size_bytes IS NULL OR size_bytes >= 0),
  is_active               boolean NOT NULL DEFAULT true,
  replaced_photo_id       uuid REFERENCES inventory_master_variant_photos(id) ON DELETE SET NULL,
  update_reason           text,
  uploaded_by_employee_id uuid REFERENCES employees(id),
  uploaded_at             timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE inventory_master_variant_photos IS
  '2026-11-20d: the Master SKU''s own photo album (reference photos of the '
  'physical variant). Distinct from inventory_entry_photos, which is evidence '
  'attached to one physical stock receipt. Old photos are never overwritten: a '
  'replacement deactivates the old row and links it via replaced_photo_id.';

CREATE INDEX IF NOT EXISTS idx_inventory_master_variant_photos_variant
  ON inventory_master_variant_photos(master_variant_id, uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_master_variant_photos_active
  ON inventory_master_variant_photos(master_variant_id, is_active);

ALTER TABLE inventory_master_variant_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_read ON inventory_master_variant_photos;
CREATE POLICY inventory_read ON inventory_master_variant_photos
  FOR SELECT TO authenticated USING (true);

-- Private bucket already created by 2026-11-20b; repeated here so this file can
-- be run on its own. Guarded because storage.buckets only exists on Supabase.
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
-- 1) Every photo points at a live Master SKU:
--    SELECT count(*) FROM inventory_master_variant_photos p
--      LEFT JOIN inventory_master_variants v ON v.id = p.master_variant_id
--     WHERE v.id IS NULL;
-- 2) At most one active replacement chain per variant is not enforced (history
--    is intentional) — check the active album instead:
--    SELECT master_variant_id, count(*) FROM inventory_master_variant_photos
--     WHERE is_active GROUP BY master_variant_id ORDER BY 2 DESC LIMIT 20;
-- 3) Existing stock-entry photos are untouched:
--    SELECT count(*) FROM inventory_entry_photos;
-- =============================================================================
