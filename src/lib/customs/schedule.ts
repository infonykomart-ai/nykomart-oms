// When is a customs-rate check due? Kept separate from ingest.ts so the
// dashboard (a client component) can import the pure helpers without pulling
// the database/network service into the browser bundle.
//
// CBIC publishes on the 1st and 3rd Thursdays, effective from midnight the
// next day, and ICEGATE puts the rates up at 18:00 IST. Extra notifications
// can be issued any evening when a currency moves sharply, so the daily
// staleness check covers those too.
const IST_OFFSET_MIN = 330;

function istParts(date: Date): { day: number; hours: number; minutes: number } {
  const shifted = new Date(date.getTime() + IST_OFFSET_MIN * 60 * 1000);
  return {
    day: shifted.getUTCDay(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

export function isCustomsSyncDue(lastAttemptAt: string | null, now: Date = new Date()): boolean {
  if (!lastAttemptAt) return true;
  const ageMs = now.getTime() - new Date(lastAttemptAt).getTime();
  if (!Number.isFinite(ageMs)) return true;
  if (ageMs > 12 * 60 * 60 * 1000) return true;

  const { day, hours } = istParts(now);
  if (day !== 4) return false; // Thursday
  if (hours < 18) return false;

  const lastIst = istParts(new Date(lastAttemptAt));
  // Before today's 18:00 IST → today's publication has not been checked yet.
  const checkedToday = lastIst.day === 4 && lastIst.hours >= 18;
  return !checkedToday;
}

/** The next expected automatic check, for the dashboard's status card. */
export function nextScheduledCheck(now: Date = new Date()): string {
  return new Date(now.getTime() + 12 * 60 * 60 * 1000).toISOString();
}
