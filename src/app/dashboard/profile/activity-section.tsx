"use client";

/**
 * 2026-09-12 — "Recent activity" card (FedEx-style security activity), part
 * of the Login & Security group on My Profile. Backed by the EXISTING
 * audit_log table — no new schema: login actions now write `auth.login`,
 * 2FA enroll/unenroll write `auth.2fa_enabled`/`auth.2fa_disabled`, and the
 * password card already wrote `auth.password_changed`. The profile page
 * (server) reads the caller's OWN last few security events and passes them
 * down as plain {id, action, createdAt} rows.
 *
 * Every row is the viewer's own event, so the card says "You" rather than
 * trying to display actor names — matching FedEx's "your recent activity"
 * framing. Nothing here is a security control; it's transparency, so a
 * missing/empty list must never block anything.
 */
import type { ActivityItem } from "./activity-types";

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Signed in",
  "auth.login_2fa": "Signed in (two-step verified)",
  "auth.password_changed": "Password changed",
  "auth.2fa_enabled": "Two-factor authentication enabled",
  "auth.2fa_disabled": "Two-factor authentication disabled",
  "profile.updated": "Profile updated",
};

const ACTION_ICONS: Record<string, string> = {
  "auth.login": "🔑",
  "auth.login_2fa": "🔐",
  "auth.password_changed": "🔑",
  "auth.2fa_enabled": "🛡️",
  "auth.2fa_disabled": "🔓",
  "profile.updated": "👤",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ActivitySection({ items }: { items: ActivityItem[] }) {
  return (
    <div className="oms-card rounded-2xl border p-5 shadow-sm">
      <div className="mb-1 flex items-center gap-2">
        <span aria-hidden className="text-lg">🕓</span>
        <h3 className="text-sm font-semibold text-[var(--oms-text)]">Recent activity</h3>
      </div>
      <p className="text-xs text-[var(--oms-text-muted)]">
        Your recent sign-ins and security changes, newest first.
      </p>

      {items.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-[var(--oms-surface-border)] px-3 py-4 text-center text-xs text-[var(--oms-text-muted)]">
          No activity recorded yet — it will appear here after your next sign-in.
        </p>
      ) : (
        <ul className="mt-3 space-y-1">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition hover:bg-[var(--oms-canvas)]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="shrink-0 text-sm">{ACTION_ICONS[item.action] ?? "•"}</span>
                <span className="truncate text-sm text-[var(--oms-text)]">
                  {ACTION_LABELS[item.action] ?? item.action}
                </span>
              </span>
              <span className="shrink-0 text-xs text-[var(--oms-text-muted)]">{formatWhen(item.createdAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
