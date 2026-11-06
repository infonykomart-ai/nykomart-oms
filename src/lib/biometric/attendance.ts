// 2026-11-06 — pure biometric attendance rules. Kept separate from Supabase
// so the direction/shift math is testable and the device adapter cannot
// silently implement a different policy.

export type PunchDirection = "IN" | "OUT" | "AUTO";

export type ShiftRule = {
  name: string;
  start: string; // "HH:MM" or "HH:MM:SS"
  end: string;
  graceMinutes: number;
  halfDayMinutes: number;
  overtimeAfterMinutes: number;
};

export const DEFAULT_SHIFT: ShiftRule = {
  name: "General",
  start: "09:30",
  end: "18:30",
  graceMinutes: 15,
  halfDayMinutes: 240,
  overtimeAfterMinutes: 0,
};

function minutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/** IST wall-clock minutes for an instant, without depending on server TZ. */
export function istMinutes(iso: string): number {
  const shifted = new Date(new Date(iso).getTime() + 5.5 * 60 * 60 * 1000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** "HH:MM:SS" IST for the legacy attendance.device_punch_in/out time columns. */
export function istTimeValue(iso: string): string {
  const shifted = new Date(new Date(iso).getTime() + 5.5 * 60 * 60 * 1000).toISOString();
  return shifted.slice(11, 19);
}

export type ShiftMetrics = {
  lateMinutes: number;
  earlyDepartureMinutes: number;
  overtimeMinutes: number;
  workedMinutes: number | null;
  status: "Present" | "Late" | "Half Day";
};

export function shiftMetrics(inIso: string | null, outIso: string | null, shift: ShiftRule): ShiftMetrics {
  const start = minutes(shift.start);
  const end = minutes(shift.end);
  const inMin = inIso ? istMinutes(inIso) : null;
  const outMin = outIso ? istMinutes(outIso) : null;

  const lateMinutes = inMin == null ? 0 : Math.max(0, inMin - (start + shift.graceMinutes));
  const earlyDepartureMinutes = outMin == null ? 0 : Math.max(0, end - outMin);
  const overtimeMinutes = outMin == null ? 0 : Math.max(0, outMin - end - shift.overtimeAfterMinutes);
  const workedMinutes = inMin != null && outMin != null ? Math.max(0, outMin - inMin) : null;

  const status: ShiftMetrics["status"] =
    workedMinutes != null && workedMinutes > 0 && workedMinutes < shift.halfDayMinutes
      ? "Half Day"
      : lateMinutes > 0
        ? "Late"
        : "Present";
  return { lateMinutes, earlyDepartureMinutes, overtimeMinutes, workedMinutes, status };
}

/** A second AUTO punch closer than this to IN is treated as another IN
 *  (double-tap / retry), not as the day's OUT. */
export const MIN_PUNCH_GAP_MINUTES = 15;

/**
 * Decide what an AUTO punch means from the punches already stored. Explicit
 * IN/OUT from the device always wins. AUTO uses the shift as well as history:
 * a first punch at/after shift end is an OUT (Missing IN), a near-duplicate
 * second punch is still IN, and a normal second punch is OUT. Later punches
 * update the nearest side instead of inventing a third state.
 */
export function resolveDirection(
  requested: PunchDirection,
  punchAtIso: string,
  current: { punchIn: string | null; punchOut: string | null },
  shift?: ShiftRule | null
): "IN" | "OUT" {
  if (requested === "IN" || requested === "OUT") return requested;
  const punchMs = new Date(punchAtIso).getTime();
  if (!current.punchIn) {
    if (shift && istMinutes(punchAtIso) >= minutes(shift.end)) return "OUT";
    return "IN";
  }
  if (!current.punchOut) {
    if (shift && istMinutes(punchAtIso) >= minutes(shift.end)) return "OUT";
    const gapMinutes = (punchMs - new Date(current.punchIn).getTime()) / 60000;
    if (gapMinutes >= 0 && gapMinutes < MIN_PUNCH_GAP_MINUTES) return "IN";
    return "OUT";
  }
  return punchMs < new Date(current.punchIn).getTime() ? "IN" : "OUT";
}
