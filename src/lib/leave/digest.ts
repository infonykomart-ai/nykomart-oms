// 2026-10-21 — the Telegram text for the daily leave digest, kept pure and
// separate from the cron route (src/app/api/cron/leave-digest/route.ts) so the
// wording can be checked — and unit-tested — without a database, a bot token
// or a scheduled run. The route only decides WHO is on leave and WHO receives
// this; what the message SAYS lives here.

const IST = "Asia/Kolkata";

/** One person on approved leave today. */
export type OnLeavePerson = {
  name: string;
  /** Company name; "" when unknown — the line then simply omits it. */
  company: string;
  /** yyyy-mm-dd */
  from: string;
  /** yyyy-mm-dd */
  to: string;
  /** Leave type name, or null when untyped / the optional table is missing. */
  type: string | null;
};

/** "Wed, 21 Oct 2026" in IST — the headline date, never the server's locale. */
export function istDateLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00+05:30`);
  // en-GB (not en-IN): en-IN renders "Wed, 21 Oct, 2026" with an extra comma
  // before the year — small, but this is a message the whole office reads
  // every morning. en-GB gives "Wed, 21 Oct 2026".
  return d.toLocaleDateString("en-GB", {
    timeZone: IST,
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** "21 Oct" for a range end — a digest line has to stay readable on a phone. */
export function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00+05:30`);
  return d.toLocaleDateString("en-GB", { timeZone: IST, day: "2-digit", month: "short" });
}

const FOOTER = "— Automated message from Nykomart OMS. Please do not reply.";

/**
 * "Aaj 4 log leave par — Neelu, Rahul, …" (the user's own wording) plus one
 * line per person: range, optional leave type, company.
 *
 * The count sentence deliberately names everyone: a bare "4 log" would still
 * send the reader to the app, which is the exact thing this digest removes.
 */
export function buildLeaveDigest(people: OnLeavePerson[], today: string): string {
  const header = `🌴 Leave Digest — ${istDateLabel(today)}`;
  if (people.length === 0) {
    return [header, "", "Nobody is on leave today. ✅", "", FOOTER].join("\n");
  }

  const names = people.map((p) => p.name);
  let summary: string;
  if (names.length === 1) {
    summary = `1 person is on leave today — ${names[0]}`;
  } else if (names.length === 2) {
    summary = `2 people are on leave today — ${names[0]} and ${names[1]}`;
  } else {
    summary = `${names.length} people are on leave today — ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }

  const lines = people.map((p) => {
    // Only show a range when it is more than one day — "21 Oct → 21 Oct" is
    // noise; the headline is always "today".
    const range = p.from === p.to ? `today (${shortDate(p.to)})` : `${shortDate(p.from)} → ${shortDate(p.to)}`;
    const parts = [p.name, "—", range];
    if (p.type) parts.push(`(${p.type})`);
    if (p.company) parts.push(`· ${p.company}`);
    return `• ${parts.join(" ")}`;
  });

  return [header, "", summary, "", ...lines, "", FOOTER].join("\n");
}
