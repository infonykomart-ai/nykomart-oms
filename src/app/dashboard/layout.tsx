import type { ReactNode } from "react";
import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { redirect } from "next/navigation";
import { CelebrationProvider } from "@/components/celebration/celebration-context";
import { TodaysCelebrationsBanner } from "@/components/celebration/todays-celebrations-banner";
import { getTodaysCelebrations } from "@/lib/celebration/today";
import { HelpCenterProvider } from "@/components/help-center/help-center-provider";
import { getHelpArticles } from "@/lib/help-center/get-articles";

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

  // 2026-08-14: Help Center content + this employee's unread-message count
  // (for the header badge) — both via the service-role client, same
  // reasoning as every other newer read in this layout: must never come
  // back silently empty because of an RLS gap, and both queries are either
  // non-sensitive (help_articles) or hard-scoped to the caller's own id
  // (the count() below) regardless.
  const [helpArticles, { count: unreadMessageCount }] = await Promise.all([
    getHelpArticles(),
    createServiceRoleClient()
      .from("direct_messages")
      .select("id", { count: "exact", head: true })
      .eq("recipient_employee_id", employee.id)
      .is("read_at", null),
  ]);

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
      <HelpCenterProvider articles={helpArticles}>
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
              meId={employee.id}
              myPhotoUrl={employee.photoUrl}
              unreadMessageCount={unreadMessageCount ?? 0}
            />
            <main className="flex-1 overflow-y-auto p-6">
              <TodaysCelebrationsBanner celebrations={celebrations} />
              {children}
            </main>
          </div>
        </div>
      </HelpCenterProvider>
    </CelebrationProvider>
  );
}
