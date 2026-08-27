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
  "termination-letter": "Termination Letter",
};
