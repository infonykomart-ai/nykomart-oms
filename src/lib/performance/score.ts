import type { WorkHoursVerdict } from "@/lib/attendance/work-hours";

// 2026-09-02: Employee Performance & Awards round. Owner asked (verbatim,
// paraphrased): performance should be judged "the way a big/multinational
// company would evaluate an employee" — order value & growth, cost vs.
// value gained, leave taken, office time, work-report quality/efficiency.
// This is the single shared formula module — both the employee's own "My
// Performance" self-view (attendance/page.tsx) and the admin/MD-only
// company-wide ranking (attendance/admin/page.tsx, gated on the new
// performance_admin capability) call these same functions, so the two
// views can never silently drift apart on what "a good score" means.
//
// Clarified with the owner before building (AskUserQuestion, 2026-09-02):
// 1. Report history — a full date-range picker (like admin already had),
//    not just a single-date lookback.
// 2. Order value/growth only applies to order-entry/sales staff — the app
//    has no per-employee "cost to acquire this order" or "who sold it"
//    data beyond `orders.entry_by_employee_id` (who ENTERED it into the
//    system). Employees without that role get a formula built only from
//    attendance + leave + work-report efficiency (weights renormalized —
//    see compositeScore below), not a 0 for a metric that doesn't apply
//    to their job.
// 3. No automatic "give employee X award Y" decision anywhere — this
//    module only ever produces RANKED METRICS. The admin view surfaces a
//    short, factual "why they're ranked here" reasoning string (see
//    topReasonFor below) but never names a specific award — HR/MD decide
//    that themselves, on purpose.
// 4. The employee's own self-view never uses a peer-relative number
//    (no "you rank #4 of 10" anywhere) — see businessImpactScoreSelf vs.
//    businessImpactScoreRanked below; the self-view only ever uses the
//    Self variant.
//
// Every weight/threshold below is a STATED assumption, not a silently
// guessed one — flagged again in the round's writeup doc. If the real HR
// policy differs (e.g. a different "normal" leave allowance, or different
// category weights), these are the constants to change; nothing else in
// either page needs to know the formula changed.

export type AttendanceCategorySummary = {
  Present: number;
  Late: number;
  "Half Day": number;
  Leave: number;
  Absent: number;
  Holiday: number;
  "Week Off": number;
};

// --- Attendance & Punctuality (0-100) ---------------------------------
// Only days the employee was actually expected in (Present/Late/Half
// Day/Absent) count toward this — Leave/Holiday/Week Off are excluded
// entirely (they're not punctuality events). A Late day still counts
// mostly in the employee's favour (they did show up) but at a discount
// vs. a fully on-time Present day; Half Day similarly partial; Absent
// scores zero for that day.
export function attendanceScore(summary: AttendanceCategorySummary): number {
  const countedDays = summary.Present + summary.Late + summary["Half Day"] + summary.Absent;
  if (countedDays === 0) return 100; // nothing to judge yet this period (e.g. brand-new joinee)
  const points = summary.Present * 1 + summary.Late * 0.7 + summary["Half Day"] * 0.5 + summary.Absent * 0;
  return Math.round((points / countedDays) * 100);
}

// --- Leave discipline (0-100) -----------------------------------------
// ASSUMPTION (stated, tune if the real HR policy differs): up to 2
// approved leave days in the period is normal/healthy and scores full
// marks — leave itself is never penalized as if it were a bad thing.
// Each day beyond that reduces the score, floor 0. This is deliberately
// NOT about whether the leave was "approved" (leave_requests.status —
// only Approved leave should ever reach attendance.status='Leave' in the
// first place) — it's purely about frequency.
const LEAVE_REASONABLE_THRESHOLD_DAYS = 2;
const LEAVE_PENALTY_PER_EXTRA_DAY = 15;

export function leaveScore(leaveDaysTaken: number): number {
  if (leaveDaysTaken <= LEAVE_REASONABLE_THRESHOLD_DAYS) return 100;
  const extra = leaveDaysTaken - LEAVE_REASONABLE_THRESHOLD_DAYS;
  return Math.max(0, 100 - extra * LEAVE_PENALTY_PER_EXTRA_DAY);
}

// --- Work Report efficiency (0-100) ------------------------------------
// Blends two things: (a) the quality of days actually reported — reusing
// the SAME compareToExpected() verdicts already shown elsewhere on both
// pages, so this never disagrees with what the employee/admin already see
// on-screen — and (b) how consistently a report was submitted at all on
// the days they were actually at work (workingDaysInPeriod = Present +
// Late + Half Day for that same period, from attendanceScore's own input).
const VERDICT_POINTS: Record<WorkHoursVerdict, number> = {
  ahead: 100,
  "on-track": 90,
  short: 55,
  // "anomaly" (>9h logged) isn't necessarily bad — often a data-entry typo
  // — scored as a mild flag, not a failure.
  anomaly: 60,
};

export function workEfficiencyScore(dailyVerdicts: WorkHoursVerdict[], workingDaysInPeriod: number): number {
  if (workingDaysInPeriod === 0) return 100; // nothing to judge yet this period
  const qualityScore = dailyVerdicts.length
    ? dailyVerdicts.reduce((sum, v) => sum + VERDICT_POINTS[v], 0) / dailyVerdicts.length
    : 0;
  const complianceRate = Math.min(1, dailyVerdicts.length / workingDaysInPeriod);
  return Math.round(qualityScore * 0.6 + complianceRate * 100 * 0.4);
}

// --- Business impact — order value & growth (0-100) ---------------------
// Two variants on purpose (see module header, point 4):
//
// Self-view: the employee's OWN trend only, never compared to anyone
// else's numbers. Flat 50 = "no change" baseline; each +1% growth is +1
// point (capped 0-100). No prior-period data (e.g. first month) -> 50
// (neutral, not penalized for lacking history).
export function businessImpactScoreSelf(growthPct: number | null): number {
  if (growthPct === null) return 50;
  return Math.max(0, Math.min(100, Math.round(50 + growthPct)));
}

// Admin/ranked view only: blends where this employee's order value sits
// relative to the highest-value order-entry peer this period (60%, so the
// ranking has real spread to sort by) with their own growth trend (40%,
// same scoring as the Self variant). maxValueAmongPeers is an aggregate
// number only — this function never needs or exposes any other
// individual's identity.
export function businessImpactScoreRanked(myValue: number, maxValueAmongPeers: number, growthPct: number | null): number {
  const levelScore = maxValueAmongPeers > 0 ? Math.min(100, Math.round((myValue / maxValueAmongPeers) * 100)) : myValue > 0 ? 100 : 0;
  const growthScore = businessImpactScoreSelf(growthPct);
  return Math.round(levelScore * 0.6 + growthScore * 0.4);
}

export function growthPct(current: number, previous: number): number | null {
  if (previous <= 0) return null; // nothing meaningful to compare against (no orders last period)
  return ((current - previous) / previous) * 100;
}

// --- Composite score (0-100) --------------------------------------------
// A Balanced-Scorecard-style weighted composite — attendance/reliability,
// leave discipline, and work-report quality for everyone, plus business
// impact for order-entry/sales staff only. When businessImpact isn't
// applicable (undefined), its weight is dropped and the remaining three
// are renormalized to still sum to 100 — so a warehouse/back-office
// employee is never scored against a metric their job doesn't produce.
export type ScoreComponents = {
  attendance: number;
  leave: number;
  workEfficiency: number;
  businessImpact?: number;
};

const WEIGHTS_WITH_BUSINESS = { attendance: 25, leave: 15, workEfficiency: 25, businessImpact: 35 } as const;
const WEIGHTS_NO_BUSINESS = { attendance: 35, leave: 20, workEfficiency: 45 } as const;

export function compositeScore(c: ScoreComponents): number {
  const weights = c.businessImpact !== undefined ? WEIGHTS_WITH_BUSINESS : WEIGHTS_NO_BUSINESS;
  let weighted = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const val = (c as Record<string, number | undefined>)[key];
    if (val === undefined) continue;
    weighted += val * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? Math.round(weighted / totalWeight) : 0;
}

// A short, factual "why this person ranks where they do" string for the
// admin ranking view — describes which component(s) they lead in, never
// names or suggests a specific award (that decision stays with HR/MD, per
// the owner's explicit choice on this round).
export function topReasonFor(c: ScoreComponents & { name: string }): string {
  const entries: [string, number][] = [
    ["attendance", c.attendance],
    ["leave discipline", c.leave],
    ["work-report efficiency", c.workEfficiency],
  ];
  if (c.businessImpact !== undefined) entries.push(["order value/growth", c.businessImpact]);
  entries.sort((a, b) => b[1] - a[1]);
  const [topLabel, topScore] = entries[0];
  if (topScore < 70) return "No standout metric this period.";
  return `Strongest in ${topLabel} (${topScore}/100).`;
}
