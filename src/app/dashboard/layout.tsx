import type { ReactNode } from "react";
import { getAuthedEmployee, MfaRequiredError } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { redirect } from "next/navigation";
import { CelebrationProvider } from "@/components/celebration/celebration-context";
import { TodaysCelebrationsBanner } from "@/components/celebration/todays-celebrations-banner";
import { getTodaysCelebrations } from "@/lib/celebration/today";
import { HelpCenterProvider } from "@/components/help-center/help-center-provider";
import { getHelpArticles } from "@/lib/help-center/get-articles";
import { PresenceProvider } from "@/components/presence/presence-context";
import { MessageToastProvider } from "@/components/messages/message-toast-provider";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemedShell } from "@/components/theme/themed-shell";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  let employee;
  try {
    employee = await getAuthedEmployee();
  } catch (e) {
    // 2026-08-24 — 2FA: the password WAS correct, just the second factor
    // hasn't been verified this session yet, so send them to the code
    // challenge instead of back to the plain login form.
    if (e instanceof MfaRequiredError) redirect("/login/verify-2fa");
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
  //
  // 2026-08-18 — same batch, 2 more count-only queries for the new
  // notification bell (see notification-bell.tsx's header comment for why
  // this is derived-on-load rather than a stored notifications table).
  // Deliberately capability-gated the SAME way the pages themselves are
  // (approve_level1/approve_level2/bill_payment) and skipped entirely for
  // employees without the relevant capability, so this never queries a
  // table the employee couldn't otherwise see. Both are single indexed
  // count(*) queries (idx_bill_pass_approval_status, and the
  // idx_bill_pass_company_due_date partial index added 2026-08-18) — cheap
  // enough to run on every dashboard page load, unlike a full reorder-
  // alert-style computation would be.
  const bprClient = createServiceRoleClient();
  const [
    helpArticles,
    { count: unreadMessageCount },
    { data: messagingEmployees },
    { count: pendingL1Count },
    { count: pendingL2Count },
    { count: overdueBillsCount },
    { data: myThemePrefs },
  ] =
    await Promise.all([
      getHelpArticles(),
      createServiceRoleClient()
        .from("direct_messages")
        .select("id", { count: "exact", head: true })
        .eq("recipient_employee_id", employee.id)
        .is("read_at", null),
      // 2026-08-18 — id/name/photo_url for every active employee, so the
      // new message "bubble" toast (fired from a layout-level, app-wide
      // subscription — see message-toast-provider.tsx) can show the
      // sender's name/photo without a per-toast lookup. Small table
      // (headcount-sized), cheap alongside the other layout queries above.
      bprClient.from("employees").select("id, name, photo_url").eq("active", true),
      employee.capabilities.includes("approve_level1")
        ? bprClient
            .from("bill_pass_register")
            .select("id", { count: "exact", head: true })
            .eq("company_id", employee.currentCompanyId)
            .eq("approval_status", "Pending")
        : { count: 0 },
      employee.capabilities.includes("approve_level2")
        ? bprClient
            .from("bill_pass_register")
            .select("id", { count: "exact", head: true })
            .eq("company_id", employee.currentCompanyId)
            .eq("approval_status", "Approved L1")
        : { count: 0 },
      employee.capabilities.includes("bill_payment")
        ? bprClient
            .from("bill_pass_register")
            .select("id", { count: "exact", head: true })
            .eq("company_id", employee.currentCompanyId)
            .gt("balance_due", 0)
            .lt("due_date", new Date().toISOString().slice(0, 10))
        : { count: 0 },
      // 2026-08-22 — this employee's saved theme + custom accent (see
      // db/2026-08-22-employee-theme-prefs.sql). Fetched here, alongside
      // every other per-employee layout query, so the very first paint
      // already renders the saved theme — no flash of the default before
      // a client-side fetch resolves. Service-role client for consistency
      // with the rest of this layout's newer reads (same reasoning noted
      // above for messagingEmployees etc.), though this one is hard-scoped
      // to the caller's own id regardless.
      //
      bprClient.from("employees").select("theme_id, custom_accent_color").eq("id", employee.id).single(),
    ]);

  const notificationItems = [
    employee.capabilities.includes("approve_level1")
      ? { key: "approvals_l1", label: "Bills awaiting L1 approval", count: pendingL1Count ?? 0, href: "/dashboard/approvals/l1" }
      : null,
    employee.capabilities.includes("approve_level2")
      ? { key: "approvals_l2", label: "Bills awaiting L2 approval", count: pendingL2Count ?? 0, href: "/dashboard/approvals/l2" }
      : null,
    employee.capabilities.includes("bill_payment")
      ? { key: "overdue_bills", label: "Overdue vendor bills", count: overdueBillsCount ?? 0, href: "/dashboard/bill-payment" }
      : null,
  ].filter((i): i is { key: string; label: string; count: number; href: string } => i !== null);

  const employeesById = Object.fromEntries(
    (messagingEmployees ?? []).map((e) => [e.id, { name: e.name, photo_url: e.photo_url }])
  );

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
    <PresenceProvider meId={employee.id}>
      <CelebrationProvider>
        <HelpCenterProvider articles={helpArticles}>
          <ThemeProvider initialThemeId={myThemePrefs?.theme_id ?? null} initialCustomAccent={myThemePrefs?.custom_accent_color ?? null}>
            <ThemedShell>
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
                  notificationItems={notificationItems}
                />
                <main className="flex-1 overflow-y-auto p-6">
                  <TodaysCelebrationsBanner celebrations={celebrations} />
                  {children}
                </main>
              </div>
            </ThemedShell>
          </ThemeProvider>
          <MessageToastProvider meId={employee.id} employeesById={employeesById} />
        </HelpCenterProvider>
      </CelebrationProvider>
    </PresenceProvider>
  );
}
