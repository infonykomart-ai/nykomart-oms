-- 2026-08-22 — Dashboard theme system: per-employee theme preference.
--
-- User's confirmed spec: "pure desbord ke andar 5 theam banege example
-- navy/gold or day night eye comfert and night mode ka option ho" +
-- "kisi ko agar theam ke sath sath kuch or bhi jese collor change karna ho
-- to vo chose kar le" — 5 selectable preset themes (Navy/Gold, Day, Eye
-- Comfort, Night, Ocean) PLUS an independent custom accent-color override
-- that layers on top of whichever theme is active.
--
-- This business has multiple employees/logins sharing the same app, each
-- wanting their own look — so the preference lives on the employees row
-- (per-login), not a company-level or global setting. Two simple nullable
-- columns, no new table:
--   theme_id             — one of the 5 preset theme keys (see
--                           src/lib/theme/themes.ts for the canonical list:
--                           'navy-gold' | 'day' | 'eye-comfort' | 'night' |
--                           'ocean'). NULL = no preference saved yet, app
--                           falls back to 'navy-gold' (the existing brand
--                           look, matches login page / HR certificate).
--   custom_accent_color   — optional hex color (e.g. '#d9a441') that
--                           overrides just the theme's accent/primary CSS
--                           variable, independent of theme_id. NULL = use
--                           the active theme's own accent, unmodified.
--
-- Deliberately NOT an enum for theme_id — kept as plain text so adding a
-- 6th theme later (or swapping the 5th, see the build notes on which one
-- was picked) never needs a migration, same reasoning as several other
-- free-text "kind" columns already in this schema (e.g. bill_pass_register
-- .source). App-layer validates against the known theme list before
-- persisting.
--
-- No RLS/capability changes needed — employees already has RLS enabled
-- from its original CREATE TABLE, and every employee may only ever read/
-- write their OWN row for these two columns (enforced server-side via
-- requireCapability/getAuthedEmployee + a hard .eq("id", employee.id), see
-- src/app/dashboard/settings/theme/actions.ts), same pattern as My Profile
-- self-editing (src/app/dashboard/profile/actions.ts).

BEGIN;

ALTER TABLE employees
  ADD COLUMN theme_id text,
  ADD COLUMN custom_accent_color text;

ALTER TABLE employees
  ADD CONSTRAINT employees_theme_id_check
    CHECK (theme_id IS NULL OR theme_id IN ('navy-gold', 'day', 'eye-comfort', 'night', 'ocean'));

-- Loose sanity check, not strict hex validation — keeps this resilient to
-- 3-digit shorthand (#fff) as well as 6-digit (#ffffff), same tolerance a
-- browser <input type="color"> value naturally has (always 6-digit from
-- that widget, but don't hard-fail a hand-typed 3-digit value either).
ALTER TABLE employees
  ADD CONSTRAINT employees_custom_accent_color_check
    CHECK (custom_accent_color IS NULL OR custom_accent_color ~ '^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$');

COMMIT;

-- Verify:
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'employees' AND column_name IN ('theme_id', 'custom_accent_color')
ORDER BY column_name;
