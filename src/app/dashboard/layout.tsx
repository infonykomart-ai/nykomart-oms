import type { ReactNode } from "react";
import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { redirect } from "next/navigation";
import { CelebrationProvider } from "@/components/celebration/celebration-context";
import { TodaysCelebrationsBanner } from "@/components/celebration/todays-celebrations-banner";
import { getTodaysCelebrations } from "@/lib/celebration/today";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  let employee;
  try {
    employee = await getAuthedEmployee();
  } catch {
    redirect("/login");
  }

  const supabase = await createClient();
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name, logo_url")
    .in("id", employee.companyIds)
    .order("name");
  const currentCompany = (companies ?? []).find((c) => c.id === employee.currentCompanyId);
  const celebrations = await getTodaysCelebrations(supabase, employee.companyIds);

  // 2026-08-08: "LEFT WINDOW AND TOP DESBORD LOCK KARO BICH KI JO DETAIL HAI
  // VAHI MOVE HONI CHAHIYE SABHI SECTION ME" — the left Work Menu sidebar
  // and the top header used to scroll away with the page on any long list
  // (Orders, Employees, etc.), since the whole layout was just a normal
  // block flow with no bounded height. Now the OUTER shell is pinned to
  // exactly the viewport height (h-screen + overflow-hidden — no page-level
  // scroll at all) and only <main> scrolls; the sidebar and header stay put
  // in every section since they're just flex siblings of that scrolling
  // <main>, not inside it. The sidebar's own internal `overflow-y-auto`
  // (dashboard-sidebar.tsx) still lets its tile grid scroll independently
  // if it's ever taller than the viewport.
  return (
    <CelebrationProvider>
      <div className="flex h-screen overflow-hidden bg-slate-100">
        <DashboardSidebar capabilities={employee.capabilities} />
        <div className="flex flex-1 flex-col overflow-hidden">
          <DashboardHeader
            companyName={currentCompany?.name ?? ""}
            logoUrl={currentCompany?.logo_url ?? null}
            employeeName={employee.name}
            roleName={employee.roleName}
            companies={companies ?? []}
            currentCompanyId={employee.currentCompanyId}
          />
          <main className="flex-1 overflow-y-auto p-6">
            <TodaysCelebrationsBanner celebrations={celebrations} />
            {children}
          </main>
        </div>
      </div>
    </CelebrationProvider>
  );
}
