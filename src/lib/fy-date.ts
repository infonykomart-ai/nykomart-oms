// Central business-date validation, anchored on the FINANCIAL YEAR system
// (2026-09-17 — "data validation or pura system FY par depend hoyega").
//
// WHY THIS EXISTS: the P&L dashboard groups by date_trunc('month', date)
// across 4 different sources (orders, purchase_bills, sale_profit_ledger,
// internal_expenses) — one typo'd year like 20026-09-01 silently became its
// own month at the top of the P&L-by-Month table (and made September appear
// twice). No entry form validated the year at all; a `date` column happily
// accepts year 20026. This module is the one gate every human entry path
// now passes its dates through BEFORE insert/update.
//
// FY SYSTEM (pura system FY par depend karta hai — nothing hardcoded):
//   • Indian FY = 1 April → 31 March, mirroring fy_label() in db/schema.sql
//     exactly (that SQL function is the source of truth for document
//     numbering; this file is its date-validation sibling).
//   • Change FY_START_MONTH here and every rule below follows — there is
//     deliberately NO hardcoded calendar year anywhere in this file.
//   • Allowed window = [current FY start − PAST_FY_LIMIT years,
//     current FY end + FUTURE_FY_LIMIT years]. Today (2026) that is roughly
//     2016-04-01 … 2028-03-31 — wide enough for backdated CSV-era history
//     and post-dated POs, tight enough that "20026" (or 22026, or 2100) is
//     rejected with a message that names the allowed window.

export const FY_START_MONTH = 4; // April — Indian FY start (same as fy_label())
export const PAST_FY_LIMIT = 10; // how many past FYs back entries may reach
export const FUTURE_FY_LIMIT = 1; // how far ahead a document may be dated

// Mirrors fy_label(p_date) in db/schema.sql: 2026-07-15 -> '26-27',
// 2026-03-31 -> '25-26' (April = start of FY). Kept in sync deliberately —
// invoices/actions.ts has its own copy for invoice numbering; this one is
// for validation.
export function fyLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1-12
  const startYear = month < FY_START_MONTH ? year - 1 : year;
  const endYear = month < FY_START_MONTH ? year : year + 1;
  return `${String(startYear).slice(2)}-${String(endYear).slice(2)}`;
}

function fyStartYearOf(dateStr: string): number {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.getUTCMonth() + 1 < FY_START_MONTH ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
}

// The inclusive calendar window any business date may fall in, derived from
// the FY system relative to TODAY at call time — never a frozen year.
export function fyDateWindow(now: Date = new Date()): { min: string; max: string; minLabel: string; maxLabel: string } {
  const today = now.toISOString().slice(0, 10);
  const curStartYear = fyStartYearOf(today);
  const minStartYear = curStartYear - PAST_FY_LIMIT;
  const maxEndYear = curStartYear + 1 + FUTURE_FY_LIMIT; // FY that started curStartYear+1 ends curStartYear+2... +FUTURE_FY_LIMIT
  const min = `${minStartYear}-${String(FY_START_MONTH).padStart(2, "0")}-01`;
  // FY end = (start year + 1) ke March ki last date; max window end =
  // (curStartYear + 1 + FUTURE_FY_LIMIT) ke March 31.
  const max = `${maxEndYear}-03-31`;
  return { min, max, minLabel: `${String(minStartYear).slice(2)}-${String(minStartYear + 1).slice(2)}`, maxLabel: `${String(maxEndYear - 1).slice(2)}-${String(maxEndYear).slice(2)}` };
}

// Returns null when the date is usable, otherwise a human error message.
// Accepts the shapes Supabase/forms produce: 'YYYY-MM-DD' and
// 'YYYY-MM-DDTHH:mm:ss…'. An empty value is NOT this function's business —
// required-ness stays each action's own check (same convention as before).
export function validateBusinessDate(value: string, label = "Date"): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;

  // Shape check FIRST — a 5-digit year (20026-09-01) can never be a real
  // date, and new Date() would quietly "parse" it into something absurd.
  const datePart = v.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return `${label} "${v}" is not a valid date — use the date picker (YYYY-MM-DD, 4-digit year).`;
  }

  // Real-calendar-date check — catches 2026-02-31 / 2026-13-05 which the
  // regex alone passes.
  const d = new Date(datePart + "T00:00:00Z");
  const [y, m, day] = datePart.split("-").map(Number);
  if (
    d.getUTCFullYear() !== y ||
    d.getUTCMonth() !== m - 1 ||
    d.getUTCDate() !== day
  ) {
    return `${label} "${v}" is not a real calendar date.`;
  }

  const { min, max, minLabel, maxLabel } = fyDateWindow();
  if (datePart < min || datePart > max) {
    return `${label} "${datePart}" is outside the allowed financial-year window (FY ${minLabel} to FY ${maxLabel}) — check the year for typos.`;
  }
  return null;
}

// One call for a form's whole date set: first failure wins, message ready to
// return from the server action. Required fields still pass through — their
// emptiness is the action's own check; this only rejects WRONG values.
export function validateDateFields(
  fields: Array<{ value: string | null | undefined; label: string }>
): string | null {
  for (const f of fields) {
    const err = validateBusinessDate(f.value ?? "", f.label);
    if (err) return err;
  }
  return null;
}
