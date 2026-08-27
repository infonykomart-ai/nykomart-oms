-- 2026-08-27 — HR Letters: persistent issued-letter record + dispatch no.
--
-- User's request (verbatim, Hindi): "jese print karte hai to abhi bhi pure
-- page ka print hota hai lekin jo data apn dalte hai uska hi print hona
-- chahiye" (print only the actual entered content, not a blank page) +
-- "jis employe ko ye latter issue ho uska record teyar hota jaye ... baad
-- me kabhi dubara download kare to mil jaye" (keep a findable, re-downloadable
-- record of every issued letter) + "usko ek no diya jaye ... dispatch no"
-- (assign each issued letter a sequential dispatch number).
--
-- The print-blank-page fix is a pure frontend change (letter-form.tsx —
-- neutralizes a `min-h-[1000px]` under @media print). This file is the DB
-- side: the `hr_letters` table + `reserve_next_number`/`format_document_no`
-- dispatch-numbering machinery already exist LIVE in production (confirmed
-- via SQL Editor 2026-08-27 — table, trigger `hr_letters_before_insert`,
-- function `trg_hr_letters_ref_no()`, and `companies.ref_prefix` are all
-- already wired and working; the table currently has 0 rows because
-- nothing in the app has ever inserted into it — HR Letters had zero
-- persistence until now). This migration only:
--   1. adds the one `letter_type` enum value the app's 7 templates need
--      that the existing 9 enum values don't already cover
--      ("Termination Letter" — see mapping note below)
--   2. adds columns to snapshot the FULL letter content (not just metadata)
--      so a past letter can be re-opened/reprinted/re-exported later,
--      exactly as it was issued
--   3. adds 2 indexes the new "Issued Letters Record" search page needs
--
-- Template → letter_type mapping used by the new server action
-- (src/lib/hr-letters/letter-type-map.ts) — 5 of the app's 7 templates
-- reuse an EXISTING enum value (no schema change needed for those):
--   offer-letter          -> 'Offer Letter'      (exact match)
--   appointment-letter    -> 'Joining Letter'     (old system's closest
--                             equivalent — an Appointment Letter IS the
--                             joining-confirmation letter in this company's
--                             usage; reusing it keeps one numbering series
--                             instead of splitting it)
--   experience-certificate-> 'Experience Letter'  (semantic match)
--   relieving-letter       -> 'Relieving Letter'  (exact match)
--   salary-certificate     -> 'Salary Slip'       (semantic match)
--   warning-letter         -> 'Warning Letter'    (exact match)
--   termination-letter     -> 'Termination Letter' (NEW — nothing in the
--                             existing 9 values fits; mapping it to
--                             'Custom / Other Letter' would make every
--                             termination letter indistinguishable from any
--                             other miscellaneous letter in the record log,
--                             which defeats the point of the log)
--
-- Run this whole file once in the Supabase SQL Editor (Database > SQL
-- Editor > New query), top to bottom. Safe to re-run — every statement is
-- IF NOT EXISTS / ADD VALUE IF NOT EXISTS / CREATE OR REPLACE.

-- 1) New letter_type enum value.
ALTER TYPE letter_type ADD VALUE IF NOT EXISTS 'Termination Letter';

-- 2) Content-snapshot columns — everything needed to redraw the exact
-- letter that was printed/sent, without depending on the employee's
-- current data (which can change later) or the app's template text
-- (which could be edited later too).
ALTER TABLE hr_letters
  ADD COLUMN IF NOT EXISTS template_slug text,
  ADD COLUMN IF NOT EXISTS employee_address text,
  ADD COLUMN IF NOT EXISTS signatory_name text,
  ADD COLUMN IF NOT EXISTS signatory_designation text,
  ADD COLUMN IF NOT EXISTS subject_line text,
  ADD COLUMN IF NOT EXISTS field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS body_text text NOT NULL DEFAULT '';

COMMENT ON COLUMN hr_letters.template_slug IS
  'Slug from LETTER_TEMPLATES (src/lib/hr-letters/templates.ts) at the time this letter was issued — lets the record page reprint using the exact template title/icon even if letter_type is shared across templates (see mapping note in db/2026-08-27-hr-letters-record-and-dispatch-no.sql).';
COMMENT ON COLUMN hr_letters.body_text IS
  'The exact edited letter body text as printed/sent — snapshot, not a live reference to the template, so a reprint years later matches what was actually issued.';

-- 3) Indexes for the new /dashboard/hr-letters/records search/filter page.
CREATE INDEX IF NOT EXISTS idx_hr_letters_employee ON hr_letters(for_employee_id);
CREATE INDEX IF NOT EXISTS idx_hr_letters_type ON hr_letters(letter_type);

-- 4) Re-point the ref_no trigger's type->code map to include the new value.
-- (Same function, same trigger already live — just adding one map entry.
-- CREATE OR REPLACE is safe/idempotent; the trigger itself is untouched.)
CREATE OR REPLACE FUNCTION trg_hr_letters_ref_no() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_prefix text;
  v_code   text;
  v_num    int;
  v_type_code_map jsonb := '{
    "Joining Letter":"JL", "Offer Letter":"OL", "Promotion Letter":"PL", "Increment Letter":"IL",
    "Experience Letter":"EL", "Relieving Letter":"RL", "Warning Letter":"WL", "Salary Slip":"SS",
    "Termination Letter":"TL", "Custom / Other Letter":"GL"
  }';
BEGIN
  SELECT ref_prefix INTO v_prefix FROM companies WHERE id = NEW.for_company_id;
  v_code := v_type_code_map ->> NEW.letter_type::text;
  v_num := reserve_next_number(NEW.for_company_id, 'LETTER_' || v_code, false);
  NEW.ref_no := v_prefix || '/' || v_code || '/' || lpad(v_num::text, 4, '0');
  RETURN NEW;
END; $$;

-- Nothing to backfill — hr_letters has 0 rows in production as of this
-- migration (verified live 2026-08-27), since no app code has ever
-- inserted into it before this feature.
