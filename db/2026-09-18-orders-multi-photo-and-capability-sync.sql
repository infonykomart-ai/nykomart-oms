-- 2026-09-18 — two pending items in one file (both idempotent, both safe to
-- re-run):
--
--   1) "order me agar ek se jyada photo or dalni pade to kese manage hoyegi
--      link se dalegi" — multiple photos per order as LINKS. New
--      orders.photo_urls text[] holds the FULL list; the existing
--      orders.photo_url column keeps its exact meaning as photo #1 (it
--      already feeds the list thumbnail, the print sheet, and the
--      WhatsApp share), so nothing old breaks. App layer: the edit form
--      gets "+ Add Photo" rows; the detail/print view shows every photo.
--
--   2) "roles & permission me jo capability update kyu nahi hoti vo apne
--      aap section ke according update honi chahiye na" — the
--      capabilities table is seeded once by db/schema.sql's INSERT, so
--      every capability later added to the app's CAPABILITY_INFO registry
--      (src/lib/capability-info.ts) never appeared in the Roles &
--      Permissions matrix. Fix: sync_capabilities(p_codes, p_descriptions)
--      upserts the app's live registry into the table (with current
--      descriptions) WITHOUT touching any role_capabilities grant, and
--      the app calls it automatically on the permissions page load —
--      deploy-first, SQL-never.
--
-- Re-runnable: every statement is IF NOT EXISTS / conditional / idempotent.

BEGIN;

-- ============================================================================
-- 1) orders.photo_urls — the full multi-photo link list
-- ============================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS photo_urls text[];

COMMENT ON COLUMN orders.photo_urls IS
  '2026-09-18: ALL photo links for the order (multi-photo support). photo_url stays '
  'the canonical FIRST photo — it already feeds the list thumbnail, print sheet, and '
  'WhatsApp share. App convention: photo_urls = [photo_url, extra2, extra3, ...] with '
  'nulls/empties trimmed, so backfills only need to wrap photo_url.';

-- Idempotent backfill — every order with a photo_url but an empty
-- photo_urls gets the single-element array. Re-runs only touch rows the
-- previous run missed (nothing overwrites a list the app already maintains).
UPDATE orders
SET    photo_urls = ARRAY[photo_url]
WHERE  photo_url IS NOT NULL
  AND (photo_urls IS NULL OR array_length(photo_urls, 1) IS NULL);

CREATE INDEX IF NOT EXISTS orders_photo_urls_gin_idx ON orders USING GIN (photo_urls);

-- ============================================================================
-- 2) sync_capabilities — capability auto-sync from the app registry
-- ============================================================================
-- Postgres's CREATE OR REPLACE FUNCTION creates the function when it
-- doesn't exist too, so this file works on both a fresh schema load and the
-- live production database.
--
--   • p_codes + p_descriptions: parallel arrays — one description per code
--     (app wording wins so the matrix shows current text, not a stale
--     schema.sql description). NULL/empty entries are skipped.
--   • Zero-arg call: no-op returning 0 (schema.sql's own INSERT remains the
--     fresh-database bootstrap; the zero-arg form is kept only so ad-hoc
--     callers can't error).
--   • Grants in role_capabilities are NEVER touched here — removing a
--     capability from the app does not silently revoke roles; the matrix
--     simply stops offering it.

CREATE OR REPLACE FUNCTION sync_capabilities(
  p_codes        text[] DEFAULT NULL,
  p_descriptions text[] DEFAULT NULL
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_processed integer := 0;
  v_code      text;
  v_desc      text;
  i           int;
BEGIN
  IF p_codes IS NULL THEN
    RETURN 0;
  END IF;

  FOR i IN 1 .. array_length(p_codes, 1) LOOP
    v_code := btrim(coalesce(p_codes[i], ''));
    CONTINUE WHEN v_code = '';

    v_desc := NULL;
    IF p_descriptions IS NOT NULL AND i <= coalesce(array_length(p_descriptions, 1), 0) THEN
      v_desc := coalesce(btrim(p_descriptions[i]), '');
      v_desc := NULLIF(v_desc, '');
    END IF;

    INSERT INTO capabilities (code, description)
    VALUES (v_code, v_desc)
    ON CONFLICT (code) DO UPDATE
      SET description = COALESCE(EXCLUDED.description, capabilities.description);

    v_processed := v_processed + 1;
  END LOOP;

  RETURN v_processed;
END;
$$;

COMMENT ON FUNCTION sync_capabilities(text[], text[]) IS
  '2026-09-18: upserts the app''s live CAPABILITY_INFO registry '
  '(src/lib/capability-info.ts) into capabilities with current descriptions, so new '
  'app sections appear in the Roles & Permissions matrix automatically after a '
  'deploy. Grants in role_capabilities are never touched. Zero-arg call is a no-op '
  '(fresh-database bootstrap stays db/schema.sql''s INSERT).';

COMMIT;

-- ============================================================================
-- Verification:
-- ============================================================================
-- 1) Backfill coverage (should be 0 after the UPDATE, i.e. no photo lost):
--    SELECT count(*) FROM orders WHERE photo_url IS NOT NULL
--      AND (photo_urls IS NULL OR array_length(photo_urls, 1) IS NULL);
-- 2) Sync works (returns the number of codes processed, then reverts):
--    BEGIN;
--    SELECT sync_capabilities(ARRAY['order_entry','test_cap'], ARRAY['desc1', NULL]);
--    SELECT code, description FROM capabilities WHERE code IN ('order_entry','test_cap');
--    ROLLBACK;
