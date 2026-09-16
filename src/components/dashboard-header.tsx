"use client";

import Link from "next/link";
import { LogoutButton } from "./logout-button";
import { CompanySwitcher } from "./company-switcher";
import { MessagesHeaderLink } from "./messages/messages-header-link";
import { NotificationBell, type NotificationItem } from "./notification-bell";
import { GlobalSearchButton } from "./search/global-search";
import { SIDEBAR_OPEN_EVENT } from "./dashboard-sidebar";

/**
 * Professional dashboard header — company logo + name (with a switcher for
 * logins that work across more than one company, see
 * db/schema.sql's employee_company_access), signed-in employee's name + role
 * (their "department" in the old system's language), logout. Direct answer to
 * the user's explicit ask: "Company ka naam bhi aana chaiye" + "kis bande ne
 * login kiya hai uska naam, kis dipartment me login kiya hai uska naam".
 * Refresh/backup/export live at the page level (each module has its own
 * relevant export), not duplicated here on every screen.
 *
 * 2026-09-15 — "mobile view & tablate view sahi nahi hai ek dusre par chadh
 * rahe hain, page ese hona chahiye ki screen auto adjust hojaye": the header
 * no longer overflows/overlaps on phones and tablets —
 *   • A ☰ hamburger (phones only) opens the sidebar as a slide-in drawer
 *     (dashboard-sidebar.tsx listens for the same event).
 *   • Padding/gaps shrink below md; the company name truncates instead of
 *     pushing the right-side icons off-screen; the "Order Management
 *     System" subtitle and the employee role line hide on small screens
 *     (initials/avatar + name remain).
 * Desktop layout is byte-for-byte unchanged.
 */
export function DashboardHeader({
  companyName,
  logoUrl,
  employeeName,
  roleName,
  companies,
  currentCompanyId,
  meId,
  myPhotoUrl,
  unreadMessageCount,
  notificationItems,
}: {
  companyName: string;
  logoUrl: string | null;
  employeeName: string;
  roleName: string;
  companies: { id: string; name: string }[];
  currentCompanyId: string;
  meId: string;
  myPhotoUrl: string | null;
  unreadMessageCount: number;
  notificationItems: NotificationItem[];
}) {
  const initials = companyName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-[var(--oms-header-border)] bg-[var(--oms-header-bg)] px-3 shadow-sm md:px-6">
      <div className="flex min-w-0 items-center gap-2 md:gap-3">
        {/* 2026-09-15 — phones only: opens the sidebar drawer (the sidebar
            itself never takes layout width below md, so without this there
            was no way to reach the Work Menu on a phone). */}
        <button
          type="button"
          aria-label="Open menu"
          title="Menu"
          onClick={() => window.dispatchEvent(new Event(SIDEBAR_OPEN_EVENT))}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--oms-header-border)] text-lg text-[var(--oms-text)] transition hover:bg-[var(--oms-accent)]/10 md:hidden"
        >
          ☰
        </button>
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={companyName} className="h-9 w-9 shrink-0 rounded-lg object-contain" />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--oms-accent)] text-sm font-bold text-[var(--oms-accent-contrast)]">
            {initials || "OMS"}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight text-[var(--oms-text)]">{companyName}</div>
          <div className="hidden text-xs leading-tight text-[var(--oms-text-muted)] sm:block">Order Management System</div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5 md:gap-4">
        <CompanySwitcher companies={companies} currentCompanyId={currentCompanyId} />
        {/* 2026-09-02: Global Search — "pure OMS ke liye ek global search
            button" — open to every signed-in employee, per-hit
            authorization handled server-side (see actions.ts). */}
        <GlobalSearchButton />
        {/* 2026-08-22: Theme settings — open to every signed-in employee,
            same "not a capability tile" precedent as My Profile/Messages/
            Help Center just below (see capability-info.ts). */}
        <Link
          href="/dashboard/settings/theme"
          className="oms-icon-btn flex h-9 w-9 items-center justify-center rounded-lg text-lg"
          title="Theme settings"
        >
          🎨
        </Link>
        <NotificationBell items={notificationItems} />
        <MessagesHeaderLink meId={meId} initialUnreadCount={unreadMessageCount} />
        {/* 2026-08-12: "sabhi ko apni profile update karne ka option ho" —
            the name/avatar is now a link to the self-service My Profile
            page, open to every signed-in employee. */}
        <Link href="/dashboard/profile" className="oms-icon-btn flex items-center gap-2 rounded-lg px-1.5 py-1 text-right" title="My Profile">
          <div className="hidden min-w-0 md:block">
            <div className="max-w-[10rem] truncate text-sm font-medium leading-tight text-[var(--oms-text)]">{employeeName}</div>
            <div className="max-w-[10rem] truncate text-xs leading-tight text-[var(--oms-text-muted)]">{roleName}</div>
          </div>
          {myPhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={myPhotoUrl} alt={employeeName} className="h-9 w-9 shrink-0 rounded-full object-cover" />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--oms-accent)]/20 text-sm font-semibold text-[var(--oms-text)]">
              {employeeName
                .split(" ")
                .map((w) => w[0])
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </div>
          )}
        </Link>
        <LogoutButton />
      </div>
    </header>
  );
}
