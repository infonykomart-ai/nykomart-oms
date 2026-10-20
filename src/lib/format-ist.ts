// 2026-10-19 — "pure system me koi bhi entry ho ... uska time and date
// aani chahiye ki kab entry hui hai".
//
// One formatter for the whole app, so every register renders an entry
// timestamp identically. It is intentionally a full date + time in IST
// (not a bare date): the point of the request is knowing WHEN a row was
// entered, and IST is the only zone this business works in.
export function formatIST(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Compact form for tight table cells — "19 Oct, 09:42". */
export function formatISTShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
