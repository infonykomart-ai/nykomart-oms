// src/lib/attendance/settlement.ts
//
// 2026-09-11 — Phase 4 (final phase) of the Payroll & HR build: pure REFERENCE
// calculations for a Full & Final (FnF) settlement — notice-period shortfall,
// a gratuity ESTIMATE, and years-of-service. These are shown to the admin as
// numbers to consider, never auto-applied as a settlement amount — every
// actual rupee on a settlement is a line item the admin explicitly adds (see
// db/2026-09-11-fnf-settlement.sql's own comment on why). Leave-balance
// reference numbers reuse src/lib/attendance/leave-balance.ts directly rather
// than duplicating that math here.
//
// ⚠️ GRATUITY IS A ROUGH ESTIMATE, NOT A LEGAL CALCULATION. The Payment of
// Gratuity Act, 1972 convention used here — (last drawn Basic) × 15/26 ×
// completed years of service — only actually applies if: this establishment
// employs 10+ people (making it "covered" under the Act), the employee has
// completed 5+ years of continuous service (with narrow exceptions this
// calculator does not model — death/disablement), and the wage base is
// correctly your real "last drawn Basic + DA" (this app has no separate DA
// field, so Basic alone — or the flat Monthly Salary for a non-CTC employee —
// is used as a simplification). CONFIRM the real figure with a CA before
// using it for an actual payment.

function daysBetween(fromDateStr: string, toDateStr: string): number {
  const from = new Date(fromDateStr + "T00:00:00Z").getTime();
  const to = new Date(toDateStr + "T00:00:00Z").getTime();
  return Math.round((to - from) / (1000 * 60 * 60 * 24));
}

/** Completed years of service (decimal) between date of joining and the last working day. */
export function computeYearsOfService(dateOfJoining: string, lastWorkingDay: string): number {
  const days = daysBetween(dateOfJoining, lastWorkingDay);
  return Math.round((days / 365.25) * 100) / 100;
}

/**
 * Rough gratuity estimate — see the file-level disclaimer above. Returns 0
 * (not eligible by the simple 5-year rule) rather than throwing, so the UI
 * can always show a number and let the admin decide whether to add it as a
 * line item at all.
 */
export function estimateGratuity({
  monthlyBasicOrSalary,
  yearsOfService,
}: {
  monthlyBasicOrSalary: number;
  yearsOfService: number;
}): { eligible: boolean; completedYears: number; estimate: number } {
  const completedYears = Math.floor(yearsOfService);
  const eligible = yearsOfService >= 5;
  const estimate = eligible ? Math.round(((monthlyBasicOrSalary * 15) / 26) * completedYears * 100) / 100 : 0;
  return { eligible, completedYears, estimate };
}

/** Notice-period shortfall — positive = employee/company owes notice pay for these many un-served days. Negative never returned (clamped to 0). */
export function computeNoticeShortfallDays(requiredDays: number, servedDays: number): number {
  return Math.max(0, requiredDays - servedDays);
}

/**
 * A simple per-day rate for notice-pay-buyout / leave-encashment reference
 * figures — monthly salary ÷ 30, the same flat convention this app already
 * uses for attendance deduction (src/lib/attendance/payroll.ts's
 * computeDeduction uses ÷ calendar-days-in-month instead; ÷30 is used here
 * only as a rough settlement-time reference, not tied to any specific
 * month — flagged as a convention, not a verified policy).
 */
export function estimatePerDayRate(monthlySalary: number): number {
  return Math.round((monthlySalary / 30) * 100) / 100;
}
