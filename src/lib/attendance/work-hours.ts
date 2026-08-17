// 2026-08-12 (round 6): "ek employee daily office time ke hisab se subh
// 9.30 baje se saam 6.30 baje tak kaam karta hai jisme 30 mint ka lunch or
// 15 mint ka tea break, jo time bachta hai utna time report me dikhe ki
// kitna ghante kaam kiya or kitna karna chahiye tha, agar koi kam kar raha
// hai to uska bhi pata chal jayega" — office hours 9:30am-6:30pm (9h),
// minus a 30-minute lunch and a 15-minute tea break, leaves the real
// expected working time per day. Used both on the employee's own Daily
// Work Report (today's tally vs expected) and the Admin/MD performance
// view (per-day and range totals vs expected), so shortfalls are visible
// in one place instead of scattered across separate calculations.
export const OFFICE_START_LABEL = "9:30 AM";
export const OFFICE_END_LABEL = "6:30 PM";
export const LUNCH_MINUTES = 30;
export const TEA_BREAK_MINUTES = 15;
const OFFICE_SPAN_MINUTES = 9 * 60; // 9:30am -> 6:30pm

/** Expected productive work minutes per day, after subtracting breaks. */
export const EXPECTED_WORK_MINUTES = OFFICE_SPAN_MINUTES - LUNCH_MINUTES - TEA_BREAK_MINUTES; // 495 = 8h 15m

export function formatHM(totalMinutes: number): string {
  const sign = totalMinutes < 0 ? "-" : "";
  const abs = Math.abs(Math.round(totalMinutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}m`;
  if (m === 0) return `${sign}${h}h`;
  return `${sign}${h}h ${m}m`;
}

/** Total seconds -> "Xh Ym" (wraps formatHM, since most callers have seconds). */
export function formatSecondsHM(totalSeconds: number): string {
  return formatHM(totalSeconds / 60);
}

export type WorkHoursVerdict = "ahead" | "on-track" | "short" | "anomaly";

// 2026-08-17: "8:15 MINUT PURE DIN KAAM CHAHIYE TO US SE JYADA 1 GHNTA
// CHALA JAYE AGAR JAYADA JA RAHA HAI MATLAB KI 10 GHNTE 50 GNATE TO ALERT
// AAJAYE ... 8.15 SE LAST 9 HOURS HO SAKTE HAI" — 8:15 is the target, up to
// 9:00 is still normal (running a bit over), but anything past that is
// treated as an anomaly rather than "great, way ahead" — in practice this
// catches typos/bugs (e.g. an accidental "50" in the Hours box — see
// daily-report-form.tsx's HourMinuteField, which had no upper bound on
// Hours until this same round) rather than someone genuinely working a
// sane amount of overtime.
export const ANOMALY_THRESHOLD_MINUTES = 9 * 60; // 540 = 9h

/** Compares consumed minutes against the expected daily target. */
export function compareToExpected(consumedMinutes: number): { deltaMinutes: number; verdict: WorkHoursVerdict } {
  const deltaMinutes = consumedMinutes - EXPECTED_WORK_MINUTES;
  const verdict: WorkHoursVerdict =
    consumedMinutes > ANOMALY_THRESHOLD_MINUTES ? "anomaly" : deltaMinutes >= 0 ? "ahead" : deltaMinutes >= -30 ? "on-track" : "short";
  return { deltaMinutes, verdict };
}
