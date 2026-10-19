import type { ReactNode } from "react";
import { headers } from "next/headers";
import { getAuthedEmployee, UnauthorizedError } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { DashboardHeader } from "@/components/dashboard-header";
import { DashboardSidebar } from "@/components/dashboard-sidebar";
import { DashboardMain } from "@/components/dashboard-main";
import { redirect } from "next/navigation";
import { CelebrationProvider } from "@/components/celebration/celebration-context";
import { TodaysCelebrationsBanner } from "@/components/celebration/todays-celebrations-banner";
import { getTodaysCelebrations } from "@/lib/celebration/today";
import { HelpCenterProvider } from "@/components/help-center/help-center-provider";
import { getHelpArticles } from "@/lib/help-center/get-articles";
import { PresenceProvider } from "@/components/presence/presence-context";
import { MessageToastProvider } from "@/components/messages/message-toast-provider";
import { MessengerPopup } from "@/components/messages/messenger-popup";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { ThemedShell } from "@/components/theme/themed-shell";
import { PageTransition } from "@/components/page-transition";
import { CompanionLiveProvider } from "@/components/companion/companion-live-provider";
// 2026-09-13 (#1) — module tabs: multiple modules open at once, one strip
// under the header. See module-tabs.tsx for the design; zero changes to
// any individual page (tabs auto-open from the URL).
import { ModuleTabsProvider, ModuleTabBar } from "@/components/module-tabs";

export default async function DashboardLayout({ children }: { children: ReactNode }) {
  let employee;
  try {
    employee = await getAuthedEmployee();
  } catch (e) {
    // 2026-08-27 — getAuthedEmployee() now redirects to /login/verify-2fa
    // itself (see require-capability.ts) rather than throwing
    // MfaRequiredError for us to catch, so that fix protects every caller
    // (Server Actions included), not just this layout. That internal
    // redirect() call throws Next.js's own NEXT_REDIRECT signal, which
    // MUST pass through this catch untouched — only UnauthorizedError (no
    // session / no active employee row) is ours to handle here.
    if (e instanceof UnauthorizedError) redirect("/login");
    throw e;
  }

  // 2026-10-19 — embed mode. src/proxy.ts sets x-embed for ?embed=1
  // requests, which is what any dialog that previews a dashboard page in
  // an <iframe> sends (the Orders hub's View button, every Print button's
  // A4 preview). Only the visible chrome below is skipped: the sidebar,
  // header, module tab strip, celebrations banner and the floating
  // messenger/companion widgets — all the PROVIDERS still mount, so a page
  // rendered this way behaves exactly like it does normally, just without
  // the surrounding window.
  const embed = (await headers()).get("x-embed") === "1";

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
  // 2026-09-12 (round 6 of the company-switcher investigation — see
  // company-switcher.tsx's fix-4b note for the full trail) — every one of
  // these 9 queries now has its own `.catch()` with a safe fallback value
  // matching what's destructured below. Previously a single transient
  // failure here (a Supabase network blip, an RPC timeout — anything that
  // makes the underlying fetch REJECT rather than resolve with
  // `{data: null, error}`, which is how Supabase normally reports a query
  // error) took down this ENTIRE layout render with an uncaught rejection.
  // Live-reproduced: that surfaced to the browser as a bare HTTP 500 +
  // React's own "#441 error in Server Components render" — and since this
  // exact render is the one switchCompanyAction's revalidatePath triggers,
  // it happened DURING a company switch, wiping the whole app shell to a
  // blank browser error page instead of failing one badge/count quietly.
  // None of these 9 things (help articles, unread counts, the companion
  // widget's image, etc.) are worth crashing the dashboard over — each one
  // failing on its own and falling back to "0 / empty / off" is the
  // correct behaviour, exactly like the capability-gated branches below
  // already do by returning a plain `{count: 0}` instead of a query.
  const [
    helpArticles,
    { count: unreadMessageCount },
    { data: messagingEmployees },
    { count: pendingL1Count },
    { count: pendingL2Count },
    { count: overdueBillsCount },
    { data: myThemePrefs },
    { data: unreadGroupMessageCount },
    { data: companionCharacterImage },
    { count: pendingLeaveCount },
    { count: onLeaveTodayCount },
    { data: onLeaveTodayRows },
  ] =
    await Promise.all([
      getHelpArticles().catch((err) => {
        console.error("[dashboard/layout] getHelpArticles failed", err);
        return [];
      }),
      createServiceRoleClient()
        .from("direct_messages")
        .select("id", { count: "exact", head: true })
        .eq("recipient_employee_id", employee.id)
        .is("read_at", null)
        .then(
          (r) => r,
          (err) => {
            console.error("[dashboard/layout] unread direct_messages count failed", err);
            return { count: 0 };
          }
        ),
      // 2026-08-18 — id/name/photo_url for every active employee, so the
      // new message "bubble" toast (fired from a layout-level, app-wide
      // subscription — see message-toast-provider.tsx) can show the
      // sender's name/photo without a per-toast lookup. Small table
      // (headcount-sized), cheap alongside the other layout queries above.
      bprClient
        .from("employees")
        .select("id, name, photo_url")
        .eq("active", true)
        .then(
          (r) => r,
          (err) => {
            console.error("[dashboard/layout] messagingEmployees failed", err);
            return { data: [] };
          }
        ),
      employee.capabilities.includes("approve_level1")
        ? bprClient
            .from("bill_pass_register")
            .select("id", { count: "exact", head: true })
            .eq("company_id", employee.currentCompanyId)
            .eq("approval_status", "Pending")
            .then(
              (r) => r,
              (err) => {
                console.error("[dashboard/layout] pendingL1Count failed", err);
                return { count: 0 };
              }
            )
        : { count: 0 },
      employee.capabilities.includes("approve_level2")
        ? bprClient
            .from("bill_pass_register")
            .select("id", { count: "exact", head: true })
            .eq("company_id", employee.currentCompanyId)
            .eq("approval_status", "Approved L1")
            .then(
              (r) => r,
              (err) => {
                console.error("[dashboard/layout] pendingL2Count failed", err);
                return { count: 0 };
              }
            )
        : { count: 0 },
      employee.capabilities.includes("bill_payment")
        ? bprClient
            .from("bill_pass_register")
            .select("id", { count: "exact", head: true })
            .eq("company_id", employee.currentCompanyId)
            .gt("balance_due", 0)
            .lt("due_date", new Date().toISOString().slice(0, 10))
            .then(
              (r) => r,
              (err) => {
                console.error("[dashboard/layout] overdueBillsCount failed", err);
                return { count: 0 };
              }
            )
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
      // 2026-09-05 — same single-row query, now also carrying
      // companion_enabled (db/2026-09-05-ai-companion-live.sql) so the very
      // first paint already knows whether to mount the live AI Companion
      // widget for this employee — no separate query needed.
      //
      // 2026-09-05, round 2 — also companion_name (db/2026-09-05-ai-
      // companion-refinements.sql), this employee's own custom name for
      // their companion (set from the chat panel — src/lib/companion/
      // actions.ts), so the dock/chat panel already show it on first paint.
      bprClient
        .from("employees")
        .select("theme_id, custom_accent_color, companion_enabled, companion_name")
        .eq("id", employee.id)
        .single()
        .then(
          (r) => r,
          (err) => {
            console.error("[dashboard/layout] myThemePrefs failed", err);
            return { data: null };
          }
        ),
      // 2026-09-02 — unread count for the new Messenger popup's group
      // badge (messenger-popup.tsx). Same RPC the popup itself re-calls on
      // resync (get_unread_group_message_count, db/2026-09-02-group-
      // messaging.sql) — seeding it here means the badge's very first
      // paint is already correct, same reasoning as unreadMessageCount
      // above for the 1:1 badge.
      bprClient.rpc("get_unread_group_message_count", { p_employee_id: employee.id }).then(
        (r) => r,
        (err) => {
          console.error("[dashboard/layout] unreadGroupMessageCount RPC failed", err);
          return { data: 0 };
        }
      ),
      // 2026-09-05, round 2 — the real AI-generated character image, if an
      // Admin/MD has ever generated one from /dashboard/admin/companion-
      // access (db/2026-09-05-ai-companion-refinements.sql). A single
      // shared row (id='default'), not per-employee — cheap PK lookup,
      // fine to run unconditionally alongside every other layout query even
      // for employees without the companion on, same reasoning as the
      // approval-count queries above being harmless no-ops when unused.
      bprClient
        .from("companion_character_image")
        .select("image_url, generated_at")
        .eq("id", "default")
        .maybeSingle()
        .then(
          (r) => r,
          (err) => {
            console.error("[dashboard/layout] companionCharacterImage failed", err);
            return { data: null };
          }
        ),
      // 2026-10-17 — two leave_admin counts for the bell: applications
      // still awaiting a decision, and who is ON LEAVE RIGHT NOW (so the
      // admin is reminded at every screen not to mark them present).
      // Same capability gate + .catch fallback as the approval counts
      // above; both are single indexed count queries (idx_leave_requests_
      // company_status). "Today" is an IST range overlap on the
      // from_date/to_date date columns.
      employee.capabilities.includes("leave_admin")
        ? bprClient
            .from("leave_requests")
            .select("id", { count: "exact", head: true })
            .eq("company_id", employee.currentCompanyId)
            .eq("status", "Pending")
            .then(
              (r) => r,
              (err) => {
                console.error("[dashboard/layout] pendingLeaveCount failed", err);
                return { count: 0 };
              }
            )
        : { count: 0 },
      employee.capabilities.includes("leave_admin")
        ? bprClient
            .from("leave_requests")
            .select("id", { count: "exact", head: true })
            .eq("company_id", employee.currentCompanyId)
            .eq("status", "Approved")
            .lte("from_date", todayIST())
            .gte("to_date", todayIST())
            .then(
              (r) => r,
              (err) => {
                console.error("[dashboard/layout] onLeaveTodayCount failed", err);
                return { count: 0 };
              }
            )
        : { count: 0 },
      // 2026-10-19 — WHO is on leave today, not just how many ("admin ko md ko
      // ye dikh jaye ki aaj ye employee leave par hai"). Same indexed window
      // as the count above; names are resolved against the employees list this
      // layout already fetched for the messenger, so this adds no extra query.
      // Only the base columns here — this runs on every page load and must not
      // depend on the 2026-10-17 audit migration (see leave-queries.ts).
      employee.capabilities.includes("leave_admin")
        ? bprClient
            .from("leave_requests")
            .select("employee_id")
            .eq("company_id", employee.currentCompanyId)
            .eq("status", "Approved")
            .lte("from_date", todayIST())
            .gte("to_date", todayIST())
            .then(
              (r) => r,
              (err) => {
                console.error("[dashboard/layout] onLeaveTodayRows failed", err);
                return { data: [] as { employee_id: string }[] };
              }
            )
        : { data: [] as { employee_id: string }[] },
    ]);

  // 2026-10-19 — names for the "On leave today" bell item, resolved against
  // the employee list this layout already loaded (no extra query). A lookup
  // miss (e.g. someone since deactivated) shows "—" rather than being
  // dropped, so the names always match the item's own count.
  const onLeaveTodayNameById = new Map((messagingEmployees ?? []).map((e) => [e.id, e.name]));
  const onLeaveTodayAll = Array.from(new Set((onLeaveTodayRows ?? []).map((r) => r.employee_id)))
    .map((id) => onLeaveTodayNameById.get(id) ?? "—")
    .sort((a, b) => a.localeCompare(b));
  const onLeaveTodayNames =
    onLeaveTodayAll.length === 0
      ? null
      : `${onLeaveTodayAll.slice(0, 4).join(", ")}${onLeaveTodayAll.length > 4 ? ` +${onLeaveTodayAll.length - 4} more` : ""}`;

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
    // 2026-10-17 — "admin ko notification dikhta rahna chahiye" — pending
    // leave applications needing a decision + how many people are on
    // approved leave TODAY (attendance-marking reminder).
    employee.capabilities.includes("leave_admin")
      ? { key: "pending_leaves", label: "Leave requests pending approval", count: pendingLeaveCount ?? 0, href: "/dashboard/leave/admin" }
      : null,
    employee.capabilities.includes("leave_admin")
      ? {
          key: "on_leave_today",
          label: "On leave today",
          count: onLeaveTodayCount ?? 0,
          href: "/dashboard/leave/admin",
          details: onLeaveTodayNames,
        }
      : null,
  ].filter(
    (i): i is { key: string; label: string; count: number; href: string; details?: string | null } => i !== null
  );

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
        <HelpCenterProvider articles={helpArticles} hideButton={myThemePrefs?.companion_enabled === true}>
          <ThemeProvider initialThemeId={myThemePrefs?.theme_id ?? null} initialCustomAccent={myThemePrefs?.custom_accent_color ?? null}>
            <ThemedShell>
              <ModuleTabsProvider>
                {!embed && <DashboardSidebar capabilities={employee.capabilities} />}
                <div className="flex flex-1 flex-col overflow-hidden">
                  {!embed && (
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
                  )}
                  {/* 2026-09-13 (#1) — module tab strip: every module you
                      visit stays open as a tab, so several can be worked
                      at once. Inside ModuleTabsProvider (above) so the
                      bar and the sidebar share one tab state. */}
                  {!embed && <ModuleTabBar />}
                  <DashboardMain>
                    {!embed && <TodaysCelebrationsBanner celebrations={celebrations} />}
                    <PageTransition>{children}</PageTransition>
                  </DashboardMain>
                </div>
                {/* 2026-09-17 — Dock nav mode (bottom-center bar, opt-in
                    alternative to the sidebar above) removed entirely per
                    owner request ("docer remove karna hai"). The sidebar is
                    now the only nav; see dashboard-sidebar.tsx. */}
              </ModuleTabsProvider>
            </ThemedShell>
          </ThemeProvider>
          {!embed && <MessageToastProvider meId={employee.id} employeesById={employeesById} />}
          {!embed && (
            <MessengerPopup
              meId={employee.id}
              employeesById={employeesById}
              initialDirectUnread={unreadMessageCount ?? 0}
              initialGroupUnread={typeof unreadGroupMessageCount === "number" ? unreadGroupMessageCount : 0}
            />
          )}
          {/* 2026-09-05 — AI Companion, live. Only mounted (subscribes to
              nothing, renders nothing) for employees an Admin/MD has
              explicitly turned on via /dashboard/admin/companion-access —
              everyone else pays zero cost for this feature existing. */}
          {!embed && myThemePrefs?.companion_enabled ? (
            <CompanionLiveProvider
              employeeId={employee.id}
              employeeName={employee.name}
              companionName={myThemePrefs?.companion_name ?? null}
              // Cache-busted with the row's own generated_at so a fresh
              // regeneration (same public URL, upsert: true) is picked up
              // immediately instead of every browser's cached copy of the
              // old image sticking around.
              //
              // 2026-09-09 — "STATIC FALLBACK IMAGE ADD KARO": until an
              // Admin/MD generates a real photo via /dashboard/admin/
              // companion-access, every employee used to see the hand-drawn
              // SVG mascot. Now they see this bundled reference-art image
              // instead — same character the claymock UI mockup's own
              // companion widget uses — with the DB-generated Gemini photo
              // still taking priority the moment one exists (unchanged
              // precedence, this only replaces the innermost `null`).
              companionImageUrl={
                companionCharacterImage?.image_url
                  ? `${companionCharacterImage.image_url}?v=${encodeURIComponent(companionCharacterImage.generated_at)}`
                  : "/companion/character-fallback.png"
              }
            />
          ) : null}
        </HelpCenterProvider>
      </CelebrationProvider>
    </PresenceProvider>
  );
}
