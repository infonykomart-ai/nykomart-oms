-- ============================================================================
-- 2026-11-18 — ETSY INTERNATIONAL SEO GENERATOR
-- ============================================================================
-- The spec's standalone table names (products, users, projects…) would clash
-- with this OMS's own tables, so everything here is prefixed `etsy_seo_` and
-- scoped by company_id — an OMS login already belongs to a company, and the
-- "user" in this schema is that employee (created_by_employee_id). API keys
-- live in etsy_seo_settings / etsy_seo_credentials encrypted with
-- src/lib/crypto/secret-box.ts (AES-256-GCM, ENCRYPTION_KEY) and are NEVER
-- returned by any API — only a masked status is.
--
-- Every statement is idempotent: safe to re-run.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Per-company AI configuration (the Settings screen writes this row).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS etsy_seo_settings (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
  primary_provider          text NOT NULL DEFAULT 'gemini',      -- gemini
  primary_model             text,                                 -- null = server default
  backup_enabled            boolean NOT NULL DEFAULT true,
  backup_provider           text NOT NULL DEFAULT 'openrouter',
  backup_model              text,
  -- 'ai' | 'ai+live' — 'ai+live' only claims verified metrics when a real
  -- research adapter (search API / uploaded file) actually supplied them.
  research_mode             text NOT NULL DEFAULT 'ai',
  output_mode               text NOT NULL DEFAULT 'all_languages',
  default_language_set      jsonb NOT NULL DEFAULT '["nl","fr","de","it","ja","pl","pt","ru","es","sv"]'::jsonb,
  -- Monthly soft cap in USD; 0 = no cap. Enforced before a generation call.
  monthly_budget_usd        numeric(10, 4) NOT NULL DEFAULT 0,
  updated_by_employee_id    uuid REFERENCES employees(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- Optional per-company provider credential. Absent → the server falls back to
-- its environment variable (GEMINI_API_KEY / OPENROUTER_API_KEY). Stored as
-- bytea ciphertext only; the plaintext never leaves the server process.
CREATE TABLE IF NOT EXISTS etsy_seo_credentials (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  provider            text NOT NULL,                  -- gemini | openrouter
  encrypted_api_key   bytea NOT NULL,
  status              text NOT NULL DEFAULT 'active', -- active | invalid
  last_checked_at     timestamptz,
  last_error          text,
  created_by_employee_id uuid REFERENCES employees(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, provider)
);

-- ---------------------------------------------------------------------------
-- Product + project. One row per English source listing / SEO project.
-- `product` holds every spec field in one JSON object: all of them are
-- optional, so a sparse form must never block generation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS etsy_seo_projects (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id            uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  sku                   text,
  project_name          text NOT NULL,
  category              text,
  -- English source, kept verbatim as the protected reference.
  original_title        text NOT NULL DEFAULT '',
  original_description  text NOT NULL DEFAULT '',
  original_tags         text NOT NULL DEFAULT '',
  product               jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- [{ url, storage_path, order, description }]
  images                jsonb NOT NULL DEFAULT '[]'::jsonb,
  status                text NOT NULL DEFAULT 'draft',      -- draft | generated | validated | failed
  generation_status     text NOT NULL DEFAULT 'idle',       -- idle | running | completed | failed | partial
  created_by_employee_id uuid REFERENCES employees(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_etsy_seo_projects_company ON etsy_seo_projects (company_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_etsy_seo_projects_company_sku
  ON etsy_seo_projects (company_id, lower(sku)) WHERE sku IS NOT NULL AND length(btrim(sku)) > 0;

-- ---------------------------------------------------------------------------
-- One localized listing per (project, language): exactly 10 per project once
-- generation completes. tags/alt_texts are JSON arrays so the 13-tag and
-- per-image alt-text rules can be enforced in the app and re-read losslessly.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS etsy_seo_listings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES etsy_seo_projects(id) ON DELETE CASCADE,
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  country             text NOT NULL,
  language_code       text NOT NULL,
  language_name       text NOT NULL,
  locale              text NOT NULL,
  title               text NOT NULL DEFAULT '',
  description         text NOT NULL DEFAULT '',
  tags                jsonb NOT NULL DEFAULT '[]'::jsonb,
  alt_texts           jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ image: 1, text: "..." }]
  seo_score           integer,
  validation_status   text NOT NULL DEFAULT 'pending',       -- pass | warning | fail | pending
  validation_report   jsonb,
  primary_keyword     text,
  secondary_keywords  jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider            text,
  model               text,
  backup_used         boolean NOT NULL DEFAULT false,
  version             integer NOT NULL DEFAULT 1,
  edited_manually     boolean NOT NULL DEFAULT false,
  created_by_employee_id uuid REFERENCES employees(id),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, language_code)
);
CREATE INDEX IF NOT EXISTS idx_etsy_seo_listings_project ON etsy_seo_listings (project_id, language_code);
CREATE INDEX IF NOT EXISTS idx_etsy_seo_listings_company_status ON etsy_seo_listings (company_id, validation_status);

-- Version history: every save/regeneration keeps the previous text so the UI
-- can compare versions and nothing a user typed is ever unrecoverable.
CREATE TABLE IF NOT EXISTS etsy_seo_listing_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id    uuid NOT NULL REFERENCES etsy_seo_listings(id) ON DELETE CASCADE,
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  version       integer NOT NULL,
  title         text NOT NULL DEFAULT '',
  description   text NOT NULL DEFAULT '',
  tags          jsonb NOT NULL DEFAULT '[]'::jsonb,
  alt_texts     jsonb NOT NULL DEFAULT '[]'::jsonb,
  seo_score     integer,
  reason        text,
  created_by_employee_id uuid REFERENCES employees(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, version)
);
CREATE INDEX IF NOT EXISTS idx_etsy_seo_versions_listing ON etsy_seo_listing_versions (listing_id, version DESC);

-- ---------------------------------------------------------------------------
-- Keyword research. `verified` is the honest flag: true ONLY when a research
-- adapter returned the metric. AI-only suggestions store verified=false and
-- the UI renders "AI Suggested – Search Volume Not Verified".
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS etsy_seo_keywords (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES etsy_seo_projects(id) ON DELETE CASCADE,
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  country         text NOT NULL,
  language_code   text NOT NULL,
  keyword         text NOT NULL,
  keyword_type    text NOT NULL,          -- primary | secondary | long_tail | buyer_intent | product | material | style | room | seasonal | competitor
  source          text NOT NULL,          -- ai | user_file | search_api | etsy_autocomplete | …
  verified        boolean NOT NULL DEFAULT false,
  search_volume   integer,                -- null when not measured
  competition     numeric(6, 3),          -- null when not measured
  trend_data      jsonb,
  confidence      text NOT NULL DEFAULT 'unknown',  -- high | medium | low | unknown
  source_url      text,
  researched_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_etsy_seo_keywords_project ON etsy_seo_keywords (project_id, language_code, keyword_type);
CREATE INDEX IF NOT EXISTS idx_etsy_seo_keywords_company ON etsy_seo_keywords (company_id, researched_at DESC);

-- ---------------------------------------------------------------------------
-- Competitor research (user-supplied / public info only).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS etsy_seo_competitors (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id          uuid NOT NULL REFERENCES etsy_seo_projects(id) ON DELETE CASCADE,
  company_id          uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  competitor_url      text,
  competitor_title    text,
  competitor_keywords jsonb NOT NULL DEFAULT '[]'::jsonb,
  analysis            jsonb,
  source              text NOT NULL DEFAULT 'user_provided',
  researched_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_etsy_seo_competitors_project ON etsy_seo_competitors (project_id, researched_at DESC);

-- ---------------------------------------------------------------------------
-- Generation jobs + AI usage. A ten-language run is recorded here so progress
-- survives a page reload and a retry knows which languages already succeeded.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS etsy_seo_jobs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid NOT NULL REFERENCES etsy_seo_projects(id) ON DELETE CASCADE,
  company_id      uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'running',   -- running | completed | failed | partial
  current_step    text,
  progress        integer NOT NULL DEFAULT 0,
  languages_total integer NOT NULL DEFAULT 10,
  languages_done  integer NOT NULL DEFAULT 0,
  retry_count     integer NOT NULL DEFAULT 0,
  error_message   text,
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz
);
CREATE INDEX IF NOT EXISTS idx_etsy_seo_jobs_project ON etsy_seo_jobs (project_id, started_at DESC);

CREATE TABLE IF NOT EXISTS etsy_seo_usage_logs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id        uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id        uuid REFERENCES etsy_seo_projects(id) ON DELETE SET NULL,
  employee_id       uuid REFERENCES employees(id),
  provider          text NOT NULL,
  model             text NOT NULL,
  operation         text NOT NULL,          -- listing | title | tags | description | alt_text | research | competitor
  language_code     text,
  input_tokens      integer,
  output_tokens     integer,
  estimated_cost_usd numeric(12, 6),
  latency_ms        integer,
  status            text NOT NULL,          -- success | error | fallback
  error_message     text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_etsy_seo_usage_company_created ON etsy_seo_usage_logs (company_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_etsy_seo_usage_project ON etsy_seo_usage_logs (project_id, created_at DESC);

-- Category catalogue (Admin can add new ones; the form reads this).
CREATE TABLE IF NOT EXISTS etsy_seo_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, name)
);

-- ---------------------------------------------------------------------------
-- Row Level Security — defence in depth. The app itself queries with the
-- service-role key AFTER requireCapability('etsy_seo_generator') and scopes
-- every query by company_id, so RLS is not the only gate; it exists so a
-- leaked anon key cannot read another company's listing copy or credentials.
-- ---------------------------------------------------------------------------
ALTER TABLE etsy_seo_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE etsy_seo_credentials    ENABLE ROW LEVEL SECURITY;
ALTER TABLE etsy_seo_projects       ENABLE ROW LEVEL SECURITY;
ALTER TABLE etsy_seo_listings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE etsy_seo_listing_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE etsy_seo_keywords       ENABLE ROW LEVEL SECURITY;
ALTER TABLE etsy_seo_competitors    ENABLE ROW LEVEL SECURITY;
ALTER TABLE etsy_seo_jobs           ENABLE ROW LEVEL SECURITY;
ALTER TABLE etsy_seo_usage_logs     ENABLE ROW LEVEL SECURITY;
ALTER TABLE etsy_seo_categories     ENABLE ROW LEVEL SECURITY;

-- Helper: the signed-in auth user's employee row must belong to the row's
-- company (home company or an explicit company access grant).
CREATE OR REPLACE FUNCTION etsy_seo_can_read_company(target uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
      FROM employees e
     WHERE e.auth_user_id = auth.uid()
       AND e.active IS DISTINCT FROM false
       AND (
         e.company_id = target
         OR EXISTS (SELECT 1 FROM employee_company_access a WHERE a.employee_id = e.id AND a.company_id = target)
       )
  );
$$;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'etsy_seo_settings','etsy_seo_projects','etsy_seo_listings','etsy_seo_listing_versions',
    'etsy_seo_keywords','etsy_seo_competitors','etsy_seo_jobs','etsy_seo_usage_logs','etsy_seo_categories'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_company_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR SELECT USING (etsy_seo_can_read_company(company_id))',
      t || '_company_read', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_company_write', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I FOR ALL USING (etsy_seo_can_read_company(company_id)) WITH CHECK (etsy_seo_can_read_company(company_id))',
      t || '_company_write', t);
  END LOOP;
END $$;

-- Credentials: read policy is company-scoped but the app never selects the
-- ciphertext for a client; only service role decrypts it server-side.
DROP POLICY IF EXISTS etsy_seo_credentials_company_read ON etsy_seo_credentials;
CREATE POLICY etsy_seo_credentials_company_read ON etsy_seo_credentials
  FOR SELECT USING (etsy_seo_can_read_company(company_id));
DROP POLICY IF EXISTS etsy_seo_credentials_company_write ON etsy_seo_credentials;
CREATE POLICY etsy_seo_credentials_company_write ON etsy_seo_credentials
  FOR ALL USING (etsy_seo_can_read_company(company_id))
  WITH CHECK (etsy_seo_can_read_company(company_id));

-- ---------------------------------------------------------------------------
-- Capability + role grant (MD/Admin by default; widen from Roles & Permissions).
-- ---------------------------------------------------------------------------
INSERT INTO capabilities (code, description) VALUES
  ('etsy_seo_generator', 'Etsy International SEO Generator — research, generate, validate and export 10 localized listings')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_capabilities (role_id, capability_code)
SELECT r.id, 'etsy_seo_generator' FROM roles r WHERE r.name IN ('MD', 'Admin')
ON CONFLICT DO NOTHING;

-- Seed the spec's default categories once per company that already has data.
INSERT INTO etsy_seo_categories (company_id, name)
SELECT c.id, cat.name
  FROM companies c
  CROSS JOIN (VALUES
    ('Cotton Rugs'), ('Block Printed Cotton Rugs'), ('Kantha Rugs'), ('Jute Rugs'),
    ('Hand Braided Jute Rugs'), ('Handwoven Jute Rugs'), ('Cotton Dhurries'),
    ('Handmade Tufted Wool Rugs'), ('Hand Knotted Rugs'), ('Table Runners'),
    ('Custom Rugs'), ('Other')
  ) AS cat(name)
ON CONFLICT (company_id, name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Image storage. Product photos are uploaded from the New Project step; the
-- bucket is public-read because the AI vision call needs to fetch the photo by
-- URL. (Uploads themselves always go through the capability-checked action.)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  INSERT INTO storage.buckets (id, name, public)
  VALUES ('etsy-product-images', 'etsy-product-images', true)
  ON CONFLICT (id) DO NOTHING;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not create storage bucket etsy-product-images (%): create it manually as a public bucket.', SQLERRM;
END $$;
