-- =============================================================================
-- 2026-11-03 — VENDOR AGREEMENTS (Agreement Generator, versions, signatures,
--              sharing history, configurable letterhead)
-- =============================================================================
--
-- HOW TO RUN: paste this whole file into the Supabase SQL editor ONCE
-- (deliver-not-execute rule — nothing in the repo runs it for you). The app
-- code is migration-tolerant: /dashboard/agreements shows a "migration
-- pending" banner and refuses to create documents until the tables exist,
-- instead of failing with a raw Postgres error.
--
-- The same DDL is folded into db/schema.sql (the cumulative source of truth
-- CI applies to a throwaway database), EXCEPT the storage-bucket block at the
-- bottom: `storage.buckets` only exists on Supabase, not in the plain
-- Postgres CI cluster, so the bucket lives only in this dated file.
--
-- WHAT THIS ADDS
--   agreement_letterhead_settings  — per-company official letterhead config
--   agreement_templates            — template version + legal-review gate
--   agreement_documents            — one row per agreement (unique ref no)
--   agreement_vendor_details       — the vendor-details form snapshot
--   agreement_document_versions    — every generated PDF, immutable
--   agreement_sharing_logs         — WhatsApp / email / download attempts
--   agreement_signature_records    — scanned uploads + provider signatures
--   agreement_history              — append-only audit trail
--   agreement_access_links         — hashed, expiring vendor access tokens
--   agreement_number_counters      — atomic NKM-AGR-YYYY-NNNNNN numbering
--
-- SECURITY MODEL (matches the rest of this OMS): every table is RLS-enabled
-- AND forced with NO policies, so anon/authenticated keys can read nothing;
-- all access goes through capability-gated Server Actions using the
-- service-role client (see src/app/dashboard/agreements/actions.ts). Vendors
-- are NOT Supabase users — they reach only their own document through an
-- opaque, expiring token (agreement_access_links) that the server verifies
-- and audits on every use. PDFs live in a PRIVATE storage bucket and are
-- streamed through the app; no public URL is ever generated.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Letterhead configuration (one row per company; missing row = defaults from
-- companies + company_profiles, i.e. nothing is invented)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agreement_letterhead_settings (
  company_id          uuid PRIMARY KEY REFERENCES companies(id),
  logo_url            text,
  legal_name          text,          -- company legal name printed on documents
  address             text,          -- registered business address
  email               text,
  website             text,
  phone               text,
  gstin               text,          -- only what the admin enters; never guessed
  footer_text         text,          -- e.g. "Confidential Document ..."
  signature_url       text,          -- authorised-signatory image (private bucket path/URL)
  brand_color         text NOT NULL DEFAULT '#0f172a',
  accent_color        text NOT NULL DEFAULT '#b45309',
  font_family         text NOT NULL DEFAULT 'Helvetica'
                        CHECK (font_family IN ('Helvetica', 'Times-Roman', 'Courier')),
  updated_by          uuid REFERENCES employees(id),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Template registry. The AGREEMENT TEXT lives in version control
-- (src/lib/agreements/templates.ts) — this table decides which template
-- version is allowed to be used for new documents, and records who legally
-- reviewed it. status must be 'active' before a new agreement can be created
-- from it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agreement_templates (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                text NOT NULL UNIQUE,
  title               text NOT NULL,
  version             integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status              text NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'legal_review', 'active', 'retired')),
  legally_reviewed_by text,
  legally_reviewed_on date,
  activated_at        timestamptz,
  retired_at          timestamptz,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Atomic agreement numbers: NKM-AGR-2026-000001
-- Row-level lock on the year's counter, so two simultaneous creations can
-- never receive the same number; ref_no is also UNIQUE on the documents table
-- as a second line of defence.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agreement_number_counters (
  year       integer PRIMARY KEY,
  last_value integer NOT NULL DEFAULT 0
);

CREATE OR REPLACE FUNCTION next_agreement_ref(p_year integer) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_next integer;
BEGIN
  INSERT INTO agreement_number_counters(year, last_value)
  VALUES (p_year, 1)
  ON CONFLICT (year) DO UPDATE SET last_value = agreement_number_counters.last_value + 1
  RETURNING last_value INTO v_next;

  RETURN format('NKM-AGR-%s-%s', p_year, lpad(v_next::text, 6, '0'));
END;
$$;

-- ---------------------------------------------------------------------------
-- Documents
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agreement_documents (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_no                 text NOT NULL UNIQUE,
  company_id             uuid NOT NULL REFERENCES companies(id),
  vendor_party_id        uuid REFERENCES parties(id),
  vendor_name_snapshot   text NOT NULL,
  template_slug          text NOT NULL,
  template_version       integer NOT NULL DEFAULT 1,
  -- Slugs of the extra clause groups the admin combined into this document
  -- (empty for a plain single-template agreement).
  included_clause_slugs  text[] NOT NULL DEFAULT '{}',
  status                 text NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'generated', 'shared', 'signed_received',
                                             'countersigned', 'active', 'renewed', 'terminated')),
  effective_date         date NOT NULL,
  -- 2026-11-03 — the WORKING form values (vendor/terms/template fields).
  -- agreement_vendor_details holds the vendor block for listing; this jsonb is
  -- the full editable draft. Each generated version additionally freezes its
  -- own immutable snapshot in agreement_document_versions.content_snapshot.
  field_values           jsonb NOT NULL DEFAULT '{}'::jsonb,
  include_witnesses      boolean NOT NULL DEFAULT true,
  document_version       integer NOT NULL DEFAULT 0,   -- 0 = nothing generated yet
  created_by             uuid NOT NULL REFERENCES employees(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  last_shared_at         timestamptz,
  activated_at           timestamptz,
  terminated_at          timestamptz,
  terminated_reason      text,
  renewal_of             uuid REFERENCES agreement_documents(id),
  notes                  text
);

CREATE INDEX IF NOT EXISTS idx_agreement_documents_company ON agreement_documents(company_id, status);
CREATE INDEX IF NOT EXISTS idx_agreement_documents_vendor ON agreement_documents(vendor_party_id);
CREATE INDEX IF NOT EXISTS idx_agreement_documents_created ON agreement_documents(created_at DESC);

CREATE TABLE IF NOT EXISTS agreement_vendor_details (
  document_id       uuid PRIMARY KEY REFERENCES agreement_documents(id) ON DELETE CASCADE,
  legal_name        text NOT NULL,
  business_name     text,
  contact_person    text,
  designation       text,
  address           text NOT NULL,
  city              text,
  state             text,
  country           text,
  postal_code       text,
  email             text,
  whatsapp          text,
  gstin             text,
  registration_no   text,
  category          text,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agreement_document_versions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       uuid NOT NULL REFERENCES agreement_documents(id) ON DELETE CASCADE,
  version           integer NOT NULL CHECK (version > 0),
  pdf_path          text NOT NULL,          -- private bucket object path
  pdf_sha256        text NOT NULL,          -- integrity / signing evidence
  pdf_size          integer,
  template_version  integer NOT NULL,
  content_snapshot  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- tokens + clauses + letterhead printed
  generated_by      uuid REFERENCES employees(id),
  generated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);

CREATE INDEX IF NOT EXISTS idx_agreement_versions_document ON agreement_document_versions(document_id, version DESC);

CREATE TABLE IF NOT EXISTS agreement_sharing_logs (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id          uuid NOT NULL REFERENCES agreement_documents(id) ON DELETE CASCADE,
  version_id           uuid REFERENCES agreement_document_versions(id),
  channel              text NOT NULL CHECK (channel IN ('whatsapp', 'email', 'download', 'vendor_link')),
  provider             text,                -- 'web_share' | 'click_to_chat' | 'whatsapp_cloud_api' | 'mailto'
  status               text NOT NULL CHECK (status IN ('initiated', 'sent', 'failed', 'manual_attach_required')),
  phone                text,
  message              text,
  provider_message_id  text,
  actor_employee_id    uuid REFERENCES employees(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agreement_sharing_document ON agreement_sharing_logs(document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agreement_signature_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id      uuid NOT NULL REFERENCES agreement_documents(id) ON DELETE CASCADE,
  version_id       uuid REFERENCES agreement_document_versions(id),
  kind             text NOT NULL CHECK (kind IN ('vendor', 'counter')),
  method           text NOT NULL CHECK (method IN ('scanned_upload', 'esign_provider')),
  signer_name      text NOT NULL,
  signer_designation text,
  signed_on        date,
  pdf_path         text NOT NULL,
  pdf_sha256       text NOT NULL,
  verification     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- provider envelope id, IP, UA, checksum info
  uploaded_by      uuid REFERENCES employees(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agreement_signatures_document ON agreement_signature_records(document_id, kind);

CREATE TABLE IF NOT EXISTS agreement_history (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id         uuid NOT NULL REFERENCES agreement_documents(id) ON DELETE CASCADE,
  action              text NOT NULL CHECK (action IN (
                        'created', 'template_selected', 'pdf_generated', 'pdf_regenerated',
                        'pdf_downloaded', 'whatsapp_share_initiated', 'whatsapp_shared',
                        'vendor_link_created', 'vendor_link_opened', 'signed_received',
                        'countersigned', 'activated', 'renewed', 'terminated', 'updated',
                        'letterhead_updated')),
  actor_employee_id   uuid REFERENCES employees(id),
  actor_name          text,
  note                text,
  meta                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agreement_history_document ON agreement_history(document_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Vendor access links: the token itself is never stored, only its SHA-256
-- hash. Revocable + expiring, and every use is added to agreement_history.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agreement_access_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     uuid NOT NULL REFERENCES agreement_documents(id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,
  purpose         text NOT NULL DEFAULT 'view_and_upload'
                    CHECK (purpose IN ('view', 'view_and_upload')),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  created_by      uuid REFERENCES employees(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz,
  use_count       integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_agreement_access_document ON agreement_access_links(document_id);

-- ---------------------------------------------------------------------------
-- RLS: enabled + forced, deliberately ZERO policies (service-role only),
-- same model as hr_letters / courier_credentials.
-- ---------------------------------------------------------------------------
ALTER TABLE agreement_letterhead_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_letterhead_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE agreement_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE agreement_number_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_number_counters FORCE ROW LEVEL SECURITY;
ALTER TABLE agreement_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE agreement_vendor_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_vendor_details FORCE ROW LEVEL SECURITY;
ALTER TABLE agreement_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_document_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE agreement_sharing_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_sharing_logs FORCE ROW LEVEL SECURITY;
ALTER TABLE agreement_signature_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_signature_records FORCE ROW LEVEL SECURITY;
ALTER TABLE agreement_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_history FORCE ROW LEVEL SECURITY;
ALTER TABLE agreement_access_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE agreement_access_links FORCE ROW LEVEL SECURITY;

REVOKE ALL ON agreement_letterhead_settings FROM anon, authenticated;
REVOKE ALL ON agreement_templates FROM anon, authenticated;
REVOKE ALL ON agreement_number_counters FROM anon, authenticated;
REVOKE ALL ON agreement_documents FROM anon, authenticated;
REVOKE ALL ON agreement_vendor_details FROM anon, authenticated;
REVOKE ALL ON agreement_document_versions FROM anon, authenticated;
REVOKE ALL ON agreement_sharing_logs FROM anon, authenticated;
REVOKE ALL ON agreement_signature_records FROM anon, authenticated;
REVOKE ALL ON agreement_history FROM anon, authenticated;
REVOKE ALL ON agreement_access_links FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- Seed the template registry as 'draft'. Nothing can be issued from a
-- template until an admin records the legal review and activates it on
-- /dashboard/agreements/templates — that is the "version-controlled and
-- legally reviewed before activation" requirement. Versions here must match
-- AGREEMENT_TEMPLATES[].version in src/lib/agreements/templates.ts; the app
-- refuses to issue from a template whose code version is newer than the
-- registry row (so an unreviewed wording change can never be sent out).
-- ---------------------------------------------------------------------------
INSERT INTO agreement_templates (slug, title, version, status)
VALUES
  ('master-nda',             'Master Confidentiality & NDA Agreement', 1, 'draft'),
  ('manufacturer-supplier',  'Manufacturer & Rug Supplier Agreement', 1, 'draft'),
  ('design-ip',              'Rug Design & Intellectual Property Protection Agreement', 1, 'draft'),
  ('international-ecommerce','International E-commerce Vendor Agreement', 1, 'draft'),
  ('data-protection',        'Customer & Marketplace Data Protection Agreement', 1, 'draft'),
  ('software-developer',     'Software Developer & IT Vendor Agreement', 1, 'draft'),
  ('photographer-creative',  'Photographer & Creative Agency Agreement', 1, 'draft'),
  ('logistics-fulfilment',   'Logistics & Fulfilment Agreement', 1, 'draft'),
  ('custom',                 'Custom Agreement', 1, 'draft')
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Private storage bucket for generated + signed PDFs. Public = false, so no
-- object is reachable without a signed URL or an authenticated server action;
-- the app never calls getPublicUrl() for this bucket.
-- (Supabase-only: intentionally NOT mirrored into db/schema.sql, which CI
-- applies to a plain Postgres cluster that has no `storage` schema.)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('agreement-documents', 'agreement-documents', false)
ON CONFLICT (id) DO NOTHING;
