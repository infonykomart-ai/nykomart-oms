-- 2026-11-22b — Phase 3: `order_attachments` (typed close-up photo index).
--
-- WHY: an order already stores its photos in `orders.photo_url` (main) and
-- `orders.photo_urls text[]` (main first, then every Close-Up photo). Those
-- columns stay EXACTLY as they are — the print sheet, the order list
-- thumbnail and the WhatsApp "REF PHOTO" automation all read them, and
-- changing them would be a rebuild, not an upgrade.
--
-- What this file adds is a typed INDEX over the same URLs, so a Purchase
-- Order (or any future document) can ask "what are this order's close-up
-- photos?" without re-implementing the `photo_urls[2..]` convention, and so
-- an attachment can carry its own file name / order / timestamps.
--
-- This is NOT a second upload path and NOT a copy of the files:
--   • the Order page remains the only place a photo is uploaded or linked;
--   • the Order save path keeps `orders.photo_urls` authoritative and then
--     syncs this table to it (src/lib/orders/closeup-photos.ts);
--   • the read helper merges these rows with the order's own columns, so a
--     database without this file, and orders saved before it, still show
--     their close-ups.
--
-- BACKFILL: photo_urls[2..] -> closeup_photo, de-duplicated and guarded by
-- the unique index, so running this file twice inserts nothing twice.
--
-- Safe to re-run: every object is IF NOT EXISTS / ON CONFLICT DO NOTHING,
-- and no existing table, column, row or policy is modified.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS order_attachments;

BEGIN;

CREATE TABLE IF NOT EXISTS order_attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  -- Room for other attachment kinds (packing slip, QC photo, …) without
  -- another migration. Today only 'closeup_photo' is written.
  attachment_type text NOT NULL DEFAULT 'closeup_photo',
  file_url        text NOT NULL,
  file_name       text,
  sort_order      integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE order_attachments IS
  '2026-11-22b: typed index over an order''s photos. attachment_type=closeup_photo '
  'holds the order''s Close-Up photos (orders.photo_urls[2..]); orders.photo_url / '
  'photo_urls remain the authoritative list that the Order page writes. The Order '
  'page is the ONLY upload/link point — Purchase Orders read these rows and never '
  'write them. Deleting a photo on the Order page removes the URL from both places, '
  'so it disappears from every PO view by design (read-through, no snapshot).';

COMMENT ON COLUMN order_attachments.file_name IS
  'Display name derived from the URL''s last path segment when the photo was '
  'uploaded or linked; there is deliberately no caption/description column.';

-- The duplicate guard and the "backfill can run twice" guard, in one index.
CREATE UNIQUE INDEX IF NOT EXISTS order_attachments_order_url_key
  ON order_attachments (order_id, file_url);

-- The exact lookup every reader uses.
CREATE INDEX IF NOT EXISTS order_attachments_order_type_sort_idx
  ON order_attachments (order_id, attachment_type, sort_order);

-- Backfill: everything AFTER the main photo in orders.photo_urls.
-- The main photo is photo_urls[1]; close-ups are [2..]. A URL equal to the
-- saved main photo is skipped even when it also appears later in the list.
INSERT INTO order_attachments (order_id, attachment_type, file_url, file_name, sort_order)
SELECT
  o.id,
  'closeup_photo',
  btrim(u.url),
  nullif(regexp_replace(split_part(btrim(u.url), '?', 1), '^.*/', ''), ''),
  (u.ord - 2)::integer
FROM orders o
CROSS JOIN LATERAL unnest(COALESCE(o.photo_urls, ARRAY[]::text[])) WITH ORDINALITY AS u(url, ord)
WHERE u.ord > 1
  AND u.url IS NOT NULL
  AND btrim(u.url) <> ''
  AND (o.photo_url IS NULL OR btrim(u.url) <> btrim(o.photo_url))
ON CONFLICT (order_id, file_url) DO NOTHING;

-- Same RLS convention as every other operational table in this project:
-- app code uses the service-role client, and authenticated users may use the
-- table directly if they ever do.
ALTER TABLE order_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_attachments FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS allow_authenticated_all ON order_attachments;
CREATE POLICY allow_authenticated_all ON order_attachments
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

COMMIT;

-- ============================================================================
-- Verification (read-only; run after the migration)
-- ============================================================================
-- 1) Table + columns exist:
--    SELECT column_name, data_type, is_nullable
--      FROM information_schema.columns
--     WHERE table_name = 'order_attachments'
--     ORDER BY ordinal_position;
-- 2) Backfill count vs. orders that carry extra photos:
--    SELECT count(*) FILTER (WHERE attachment_type = 'closeup_photo') AS closeups,
--           count(DISTINCT order_id) AS orders_with_closeups
--      FROM order_attachments;
--    SELECT count(*) AS orders_with_extra_photos
--      FROM orders
--     WHERE array_length(COALESCE(photo_urls, ARRAY[]::text[]), 1) > 1;
-- 3) No duplicates (must return zero rows):
--    SELECT order_id, file_url, count(*) FROM order_attachments
--     GROUP BY 1, 2 HAVING count(*) > 1;
-- 4) Re-running the whole file must not add rows (run it twice, compare 2).
