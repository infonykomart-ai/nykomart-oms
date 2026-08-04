import { LogoutButton } from "./logout-button";

/**
 * Professional dashboard header — company logo + name, signed-in employee's
 * name + role (their "department" in the old system's language), logout.
 * Direct answer to the user's explicit ask: "Company ka naam bhi aana
 * chaiye" + "kis bande ne login kiya hai uska naam, kis dipartment me login
 * kiya hai uska naam". Refresh/backup/export live at the page level (each
 * module has its own relevant export), not duplicated here on every screen.
 */
export function DashboardHeader({
  companyName,
  logoUrl,
  employeeName,
  roleName,
}: {
  companyName: string;
  logoUrl: string | null;
  employeeName: string;
  roleName: string;
}) {
  const initials = companyName
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <header className="flex h-16 items-center justify-between border-b border-slate-200 bg-white px-6 shadow-sm">
      <div className="flex items-center gap-3">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={companyName} className="h-9 w-9 rounded-lg object-contain" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-400 to-orange-600 text-sm font-bold text-white">
            {initials || "OMS"}
          </div>
        )}
        <div>
          <div className="text-sm font-semibold leading-tight text-slate-900">{companyName}</div>
          <div className="text-xs leading-tight text-slate-500">Order Management System</div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-right">
          <div className="text-sm font-medium leading-tight text-slate-900">{employeeName}</div>
          <div className="text-xs leading-tight text-slate-500">{roleName}</div>
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-semibold text-slate-700">
          {employeeName
            .split(" ")
            .map((w) => w[0])
            .slice(0, 2)
            .join("")
            .toUpperCase()}
        </div>
        <LogoutButton />
      </div>
    </header>
  );
}
