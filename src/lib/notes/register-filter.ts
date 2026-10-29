// 2026-10-29j — "registers me FY ka filter aur search chahiye".
//
// WHY: the Debit/Credit Note registers listed EVERY note of the selected
// company(ies) with no way to narrow it. Printing a register for one financial
// year (the way a CA files it), or finding "wo ₹2,000 ka note jiska invoice
// 8817 tha", meant scrolling the whole page — and the print carried everything
// anyway. Both registers now filter by the same two things:
//
//   ?fy=2026-27   -> that financial year only (Indian FY, via lib/fy-date.ts)
//   ?q=...        -> free text over note no. / party / invoice / remark / AWB
//
// Deliberately pure functions with no Supabase import so both pages (server
// components) and any future client filter can share them.
import { fyWindow } from "@/lib/fy-date";

export type FySelection = {
  startYear: number;
  /** "2026-27" */
  label: string;
  /** inclusive */
  start: string;
  /** inclusive */
  end: string;
};

/**
 * "2026-27" (the value fyOptions() emits) or "2026" -> that FY's date window.
 * Anything else (blank, "all", garbage) -> null = no FY restriction.
 */
export function parseFyParam(param: string | null | undefined): FySelection | null {
  const m = (param ?? "").trim().match(/^(\d{4})(?:-(\d{2}|\d{4}))?$/);
  if (!m) return null;
  const startYear = Number(m[1]);
  if (!Number.isFinite(startYear) || startYear < 2000 || startYear > 2100) return null;
  const w = fyWindow(startYear);
  return { startYear, label: w.label, start: w.start, end: w.end };
}

/** FY check on a YYYY-MM-DD date; a null/blank date never matches a chosen FY. */
export function inFy(date: string | null | undefined, fy: FySelection | null): boolean {
  if (!fy) return true;
  const d = (date ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d >= fy.start && d <= fy.end;
}

/**
 * Case-insensitive, all-words-must-match search. Every field is joined into one
 * haystack so "8817 freight" finds a note whose invoice is 8817 and remark
 * mentions freight. An empty query matches everything.
 */
export function matchesQuery(fields: (string | null | undefined)[], q: string): boolean {
  const terms = (q ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return terms.every((t) => hay.includes(t));
}

/** Human line describing the active selection, printed with the register. */
export function selectionLabel(args: {
  companyName: string | null;
  fy: FySelection | null;
  q: string;
}): string {
  const parts = [args.companyName ?? "All my companies"];
  parts.push(args.fy ? `FY ${args.fy.label}` : "All financial years");
  if (args.q.trim()) parts.push(`search "${args.q.trim()}"`);
  return parts.join(" · ");
}
