import Link from "next/link";
import { LogoutButton } from "./logout-button";
import { CompanySwitcher } from "./company-switcher";
import { MessagesHeaderLink } from "./messages/messages-header-link";
import { NotificationBell, type NotificationItem } from "./notification-bell";

/**
 * Professional dashboard header — company logo + name (with a switcher for
 * logins that work across more than one company, see
 * db/schema.sql's employee_company_access), signed-in employee's name +
 * role (their "department" in the old system's language), logout. Direct
 * answer to the user's explicit ask: "Company ka naam bhi aana chaiye" +
 * "kis bande ne login kiya hai uska naam, kis dipartment me login kiya hai
 * uska naam". Refresh/backup/export live at the page level (each module has
 * its own relevant export), not duplicated here on every screen.
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
    <header className="flex h-16 items-center justify-between border-b border-[var(--oms-header-border)] bg-[var(--oms-header-bg)] px-6 shadow-sm">
      <div className="flex items-center gap-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={companyName} className="h-9 w-9 rounded-lg object-contain" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--oms-accent)] text-sm font-bold text-[var(--oms-accent-contrast)]">
            {initials || "OMS"}
          </div>
        )}
        <div>
          <div className="text-sm font-semibold leading-tight text-[var(--oms-text)]">{companyName}</div>
          <div className="text-xs leading-tight text-[var(--oms-text-muted)]">Order Management System</div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <CompanySwitcher companies={companies} currentCompanyId={currentCompanyId} />
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
          <div>
            <div className="text-sm font-medium leading-tight text-[var(--oms-text)]">{employeeName}</div>
            <div className="text-xs leading-tight text-[var(--oms-text-muted)]">{roleName}</div>
          </div>
          {myPhotoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={myPhotoUrl} alt={employeeName} className="h-9 w-9 rounded-full object-cover" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--oms-accent)]/20 text-sm font-semibold text-[var(--oms-text)]">
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
