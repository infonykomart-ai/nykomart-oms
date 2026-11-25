-- ============================================================================
-- 2026-11-24 — ETSY SEO GENERATOR: CONTENT HASHES FOR CACHE REUSE
-- ============================================================================
-- The ten-language generation run now performs keyword research once and then
-- generates the ten markets in parallel. To avoid spending AI credits on an
-- unchanged product, the source content is hashed and stored:
--
--   etsy_seo_projects.source_hash  — the hash of the English source that the
--                                   stored keyword rows belong to
--   etsy_seo_listings.source_hash  — the hash of the English source that
--                                   produced this localized listing
--
-- A listing whose hash matches the project's current hash is reused instead of
-- regenerated; keywords are reused when the project hash still matches. Both
-- columns are nullable: existing rows keep working and are simply regenerated
-- once. The application tolerates the columns being absent (it then never
-- caches), so this file is safe to run at any time.
--
-- Every statement is idempotent: safe to re-run.
-- ============================================================================

ALTER TABLE etsy_seo_projects ADD COLUMN IF NOT EXISTS source_hash text;
ALTER TABLE etsy_seo_listings ADD COLUMN IF NOT EXISTS source_hash text;

CREATE INDEX IF NOT EXISTS idx_etsy_seo_listings_source_hash
  ON etsy_seo_listings (project_id, source_hash);
