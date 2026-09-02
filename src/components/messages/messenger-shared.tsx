// Small helpers shared by the Messenger popup's own components
// (messenger-popup.tsx / messenger-thread.tsx / messenger-new-conversation.tsx).
// Deliberately a SEPARATE copy of the same Avatar/formatTime/formatBytes
// logic that already lives in messages/messages-client.tsx rather than an
// import from it — that file doesn't export them, and duplicating ~20 lines
// here is simpler and safer than reaching into another feature's client
// component internals. Keep these in sync by eye if the full-page styling
// ever changes; they're intentionally tiny.
"use client";

export function initialsOf(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function Avatar({ name, photoUrl, size = 9 }: { name: string; photoUrl: string | null; size?: 7 | 8 | 9 }) {
  // Tailwind needs static, literal class strings — no dynamic `h-${n}`
  // interpolation — so the handful of sizes this popup actually uses are
  // spelled out explicitly rather than computed.
  const dim = size === 7 ? "h-7 w-7" : size === 8 ? "h-8 w-8" : "h-9 w-9";
  return photoUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photoUrl} alt={name} className={`${dim} shrink-0 rounded-full object-cover`} />
  ) : (
    <div className={`flex ${dim} shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700`}>
      {initialsOf(name)}
    </div>
  );
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function formatBytes(n: number | null): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
