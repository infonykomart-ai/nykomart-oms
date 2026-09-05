-- 2026-09-05 — AI Companion refinements, round 2. Follow-up to
-- db/2026-09-05-ai-companion-live.sql (companion_events, companion_enabled,
-- companion_admin — already run). This adds what the next round of asks
-- needs:
--
--   1. employees.companion_name — "ISKA NAAM SABHI EMPLOYE APNEHISAB SE
--      DECIDE KAR SAKTE HAI": every employee can pick their OWN name for
--      their companion (set via the chat panel, src/lib/companion/
--      actions.ts's setCompanionName — same self-service pattern as
--      employees.theme_id/custom_accent_color, no admin approval needed).
--
--   2. companion_character_image — a single shared row (id is always the
--      literal 'default') holding the real AI-generated character image
--      once an Admin/MD generates one from /dashboard/admin/companion-
--      access (see generateCompanionCharacterImage() in that screen's
--      actions.ts). Until that's run once, this table is empty and every
--      employee keeps seeing the existing hand-drawn SVG mascot — the
--      image is a pure upgrade layered on top, never a hard dependency.
--
--   3. 'companion-images' Storage bucket — PUBLIC, same reasoning as
--      db/2026-08-22-employee-photos-bucket.sql: the generated character
--      image needs to render directly in the live widget on every
--      dashboard page without an auth-gated proxy route. Only the
--      generateCompanionCharacterImage() server action (service-role,
--      gated behind requireCapability("companion_admin")) ever writes to
--      it — public only affects reads.
--
-- Idempotent — safe to run again.
--
-- *** RUN THIS IN SUPABASE BEFORE DEPLOYING THE MATCHING CODE. ***
-- dashboard/layout.tsx's per-employee query (runs on every single page
-- load, for every employee) is being extended to also select
-- employees.companion_name and to read companion_character_image — if the
-- column/table don't exist yet when that code goes live, this is the exact
-- same class of outage the 2026-09-05 companion_enabled rollout warned
-- about: one missing column breaks the query that every dashboard page
-- depends on.

ALTER TABLE employees ADD COLUMN IF NOT EXISTS companion_name text;

CREATE TABLE IF NOT EXISTS companion_character_image (
  id text PRIMARY KEY DEFAULT 'default',
  image_url text NOT NULL,
  prompt text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid REFERENCES employees(id) ON DELETE SET NULL
);

ALTER TABLE companion_character_image ENABLE ROW LEVEL SECURITY;

-- Every signed-in employee may read this (it's just an image URL, same
-- non-sensitivity as help_articles) — writes only ever happen through the
-- service-role admin action, which bypasses RLS entirely, so no
-- insert/update/delete policy is needed here at all.
DROP POLICY IF EXISTS companion_character_image_select_all ON companion_character_image;
CREATE POLICY companion_character_image_select_all ON companion_character_image FOR SELECT
  USING (auth.uid() IS NOT NULL);

INSERT INTO storage.buckets (id, name, public)
VALUES ('companion-images', 'companion-images', true)
ON CONFLICT (id) DO NOTHING;
