// Maps each LETTER_TEMPLATES slug (templates.ts) to the DB's `letter_type`
// enum value, so issueHrLetter() (hr-letters/actions.ts) knows which
// dispatch-number series (and 2-letter code, e.g. "OL", "RL") a given
// template's letters belong to — see db/2026-08-27-hr-letters-record-and-
// dispatch-no.sql for the full reasoning behind each mapping, in particular
// why appointment-letter/experience-certificate/salary-certificate reuse an
// existing enum value instead of getting their own, and why
// termination-letter needed a genuinely new one ('Termination Letter').
//
// If a new template slug is ever added to LETTER_TEMPLATES without adding
// it here too, issueHrLetter() returns a clear "Unknown letter template."
// error instead of silently mis-filing it under the wrong series — see the
// lookup there.
//
// Kept as a standalone literal union (rather than importing Supabase's
// generated Database["public"]["Enums"]["letter_type"]) so this file has no
// dependency on src/types/database.ts's shape — it must exactly match the
// live `letter_type` Postgres enum though (verified live 2026-08-27; kept
// in sync by hand alongside db/2026-08-27-hr-letters-record-and-dispatch-
// no.sql whenever the enum changes).
export type LetterTypeValue =
  | "Joining Letter"
  | "Offer Letter"
  | "Promotion Letter"
  | "Increment Letter"
  | "Experience Letter"
  | "Relieving Letter"
  | "Warning Letter"
  | "Salary Slip"
  | "Termination Letter"
  | "Custom / Other Letter";

export const LETTER_TYPE_VALUES: LetterTypeValue[] = [
  "Joining Letter",
  "Offer Letter",
  "Promotion Letter",
  "Increment Letter",
  "Experience Letter",
  "Relieving Letter",
  "Warning Letter",
  "Salary Slip",
  "Termination Letter",
  "Custom / Other Letter",
];

export const TEMPLATE_TO_LETTER_TYPE: Record<string, LetterTypeValue> = {
  "offer-letter": "Offer Letter",
  "appointment-letter": "Joining Letter",
  "experience-certificate": "Experience Letter",
  "relieving-letter": "Relieving Letter",
  "salary-certificate": "Salary Slip",
  "warning-letter": "Warning Letter",
  // 2026-10-23 — the two new notice templates (templates.ts) are warning
  // letters in every sense the records log cares about (a formal written
  // warning ahead of termination), so they deliberately reuse the existing
  // 'Warning Letter' enum value instead of needing a new one + a migration
  // applied before they can be issued. The exact template is still shown
  // per row from template_slug, so the record never confuses them.
  "improvement-notice": "Warning Letter",
  "final-notice": "Warning Letter",
  // 2026-10-23 — the company-issued notice letter (10/15/20 days, months or
  // a custom period) is a notice that the employment will end on a stated
  // date, so it files under the 'Termination Letter' (TL) series rather
  // than 'Warning Letter' — it is not a warning to improve. The record log
  // still shows the exact template title from template_slug, so it never
  // gets confused with the after-the-fact Termination Letter.
  "company-notice-letter": "Termination Letter",
  "termination-letter": "Termination Letter",
};
