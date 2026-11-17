-- ============================================================================
-- 2026-11-17 — ETSY MULTILINGUAL TRANSLATION & SEO MODULE
-- ============================================================================
-- One English source listing per SKU, and one independent translation record
-- per (product, language). The English source is never overwritten by a
-- translation save, and updating German must never touch French — that is
-- enforced by the UNIQUE (product_id, language_code) key plus per-language
-- upserts in the app (src/app/dashboard/etsy-translations/actions.ts).
--
-- Table names are prefixed `etsy_` (the spec's suggested `products` /
-- `product_translations` are too generic for this schema: `products` alone
-- would be ambiguous next to inventory_products and b2b_products).
--
-- Safe to re-run (IF NOT EXISTS / ON CONFLICT).
-- ============================================================================

CREATE TABLE IF NOT EXISTS etsy_products (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id              uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sku                     text NOT NULL,
  product_name            text,
  -- The ENGLISH source — protected: only the source editor writes these.
  original_title          text NOT NULL DEFAULT '',
  original_description    text NOT NULL DEFAULT '',
  original_tags           text NOT NULL DEFAULT '',
  -- Editable product facts the AI must never contradict.
  category                text,
  material                text,
  size                    text,
  colour                  text,
  technique               text,
  features                text,
  entered_by_employee_id  uuid REFERENCES employees(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_etsy_products_company ON etsy_products (company_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS etsy_product_translations (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id              uuid NOT NULL REFERENCES etsy_products(id) ON DELETE CASCADE,
  -- Denormalised for reporting/joins without a second hop; always derived
  -- from the product on write.
  company_id              uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sku                     text NOT NULL,
  language_code           text NOT NULL,          -- nl fr de it ja pl pt ru es sv
  language_name           text NOT NULL,          -- Dutch … Swedish
  translated_title        text NOT NULL DEFAULT '',
  translated_description  text NOT NULL DEFAULT '',
  translated_tags         text NOT NULL DEFAULT '', -- ONE line, comma separated
  title_character_count   integer NOT NULL DEFAULT 0,
  tag_count               integer NOT NULL DEFAULT 0,
  max_tag_length          integer NOT NULL DEFAULT 0,
  tag_validation_status   text NOT NULL DEFAULT 'PENDING',  -- PASS | FAIL
  validation_detail       jsonb,
  translation_status      text NOT NULL DEFAULT 'Draft',    -- Draft | Generated | Edited | Saved
  ai_model                text,
  edited_manually         boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  -- ONE translation per product per language; a save upserts on this key so
  -- another language's row can never be touched accidentally.
  UNIQUE (product_id, language_code)
);
CREATE INDEX IF NOT EXISTS idx_etsy_translations_product ON etsy_product_translations (product_id, language_code);

COMMENT ON TABLE etsy_products IS 'Etsy listing source (English) — the protected original the translations derive from.';
COMMENT ON TABLE etsy_product_translations IS 'One localized Etsy listing (title/description/13 tags) per product per language.';

-- ---------------------------------------------------------------------------
-- Capability + role grant. MD/Admin by default; widen later from
-- Roles & Permissions with no code change.
-- ---------------------------------------------------------------------------
INSERT INTO capabilities (code, description) VALUES
  ('etsy_translation', 'Create English Etsy listings, generate/edit/save the 10 localized titles, descriptions and tags')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'etsy_translation' FROM roles r WHERE r.name IN ('MD', 'Admin')
ON CONFLICT DO NOTHING;
