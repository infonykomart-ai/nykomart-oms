import Link from "next/link";
import { requireAnyCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import {
  ACCOUNTS_MIGRATION_FILE,
  accountsSchemaState,
  buildPaymentBook,
  buildTrialBalance,
  loadAccounts,
  loadApprovalLimits,
  loadCategories,
  loadClaims,
  loadFinancialYears,
  loadJournalEntries,
  loadOpeningBalances,
  loadPettyCash,
  loadSettings,
  loadVouchers,
} from "@/lib/accounts/data";
import { pettyCashBalance } from "@/lib/accounts/petty-cash";
import { PrintDialog } from "@/components/print-dialog";
import { financialYearLabel } from "@/lib/accounts/opening-balances";
import { formatPaise, toPaise } from "@/lib/accounts/money";
import { ExpenseEntryForm, type AccountOption, type CategoryOption } from "./expense-form";
import {
  addPettyCashTxnAction,
  deleteExpenseDraftAction,
  markClaimPaidAction,
  markExpensePaidAction,
  postExpenseAction,
  postOpeningBalancesAction,
  reviewClaimAction,
  reviewExpenseAction,
  reverseExpenseAction,
  saveAccountAction,
  saveApprovalLimitAction,
  saveCategoryAction,
  saveFinancialYearAction,
  saveOpeningBalancesAction,
  savePettyCashAccountAction,
  saveSettingsAction,
  seedDefaultAccountsAction,
  submitClaimAction,
  submitExpenseAction,
  toggleCategoryAction,
} from "./actions";

// PURCHASE & ACCOUNTS — Phase 1 (office / cash expenses) plus the setup the
// later phases need (financial years, cash/bank accounts, opening balances).
//
// ONE route with sections, deliberately: the master prompt's 20 submenus are
// one module, and this codebase's owner has asked for fewer tiles, not more.
// Each section is its own linkable screen (?tab=), and the dashboard tile for
// Expense Vouchers / Expense Approvals opens its section directly instead of
// dropping the user on the overview. The section bar is a tile grid (icon +
// label + one-line hint) so this module navigates the way the rest of the OMS
// launcher does, without adding more top-level tiles.
//
// Every section is server-rendered except the entry form.
//
// Read-only loads only; every write is a Server Action that re-checks
// capabilities (see actions.ts).
//
// Read-only loads only; every write is a Server Action that re-checks
// capabilities (see actions.ts).

export const dynamic = "force-dynamic";

const SECTIONS = [
  { id: "dashboard", label: "Overview", icon: "🏦", hint: "KPIs and what still needs setting up" },
  { id: "expenses", label: "Expense Vouchers", icon: "🧮", hint: "Office & cash expenses — enter a voucher, then track it" },
  { id: "approvals", label: "Expense Approvals", icon: "✅", hint: "Review submitted vouchers and post them to the ledger" },
  { id: "petty-cash", label: "Petty Cash", icon: "👛", hint: "Floats, spends, replenishments, physical count" },
  { id: "claims", label: "Reimbursements", icon: "🧾", hint: "Employee expense claims and their payouts" },
  { id: "categories", label: "Categories", icon: "🗂️", hint: "Expense heads, GST rate and their ledger account" },
  { id: "reports", label: "Reports", icon: "📊", hint: "Trial balance, cash book, bank book and UPI" },
  { id: "setup", label: "Accounts Setup", icon: "⚙️", hint: "FY, cash/bank accounts, opening balances" },
] as const;

type TabId = (typeof SECTIONS)[number]["id"];

type SearchParams = Promise<{ tab?: string; ok?: string; error?: string; from?: string; to?: string; fy?: string }>;

const card = "rounded-xl border border-stone-200 bg-white p-4";
const input =
  "w-full rounded-lg border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const label = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-stone-500";
const btn = "rounded-lg bg-stone-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-stone-800";
const btnQuiet = "rounded-lg border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:bg-stone-100";
const btnDanger = "rounded-lg border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50";

function tone(status: string): string {
  switch (status) {
    case "draft":
      return "bg-stone-100 text-stone-700";
    case "submitted":
      return "bg-amber-100 text-amber-800";
    case "approved":
      return "bg-sky-100 text-sky-800";
    case "posted":
      return "bg-emerald-100 text-emerald-800";
    case "paid":
      return "bg-teal-100 text-teal-800";
    case "rejected":
      return "bg-red-100 text-red-800";
    case "cancelled":
      return "bg-stone-200 text-stone-600";
    default:
      return "bg-stone-100 text-stone-700";
  }
}

export default async function AccountsPage({ searchParams }: { searchParams: SearchParams }) {
  const employee = await requireAnyCapability(
    "accounts_view",
    "accounts_expense_entry",
    "accounts_expense_approve",
    "accounts_setup"
  );
  const params = await searchParams;
  const tab: TabId = (SECTIONS.find((t) => t.id === params.tab)?.id ?? "dashboard") as TabId;
  const supabase = createServiceRoleClient();
  const today = todayIST();

  const canEntry = employee.capabilities.includes("accounts_expense_entry") || employee.capabilities.includes("accounts_setup");
  const canApprove =
    employee.capabilities.includes("accounts_expense_approve") || employee.capabilities.includes("accounts_setup");
  const canSetup = employee.capabilities.includes("accounts_setup");
  const visibleSections = SECTIONS.filter((section) =>
    section.id === "approvals" ? canApprove : section.id === "setup" ? canSetup : true
  );

  const schema = await accountsSchemaState(supabase);
  if (schema.state === "missing") {
    return (
      <main className="mx-auto max-w-3xl p-6">
        <h1 className="text-xl font-semibold text-stone-900">Office Expenses</h1>
        <div className={`${card} mt-4 border-amber-300 bg-amber-50`}>
          <p className="text-sm font-medium text-amber-900">The accounting tables are not in the database yet.</p>
          <p className="mt-1 text-sm text-amber-800">
            Run <code className="rounded bg-amber-100 px-1">db/{ACCOUNTS_MIGRATION_FILE}</code> once in the Supabase SQL
            editor, then reload this page. Nothing else is required.
          </p>
          {schema.error ? <p className="mt-2 font-mono text-[11px] text-amber-700">{schema.error}</p> : null}
        </div>
      </main>
    );
  }

  const [companiesResult, settings, years, accounts, categories, measurementSettings] = await Promise.all([
    supabase.from("companies").select("id, name, short_code").in("id", employee.companyIds),
    loadSettings(supabase, employee.currentCompanyId),
    loadFinancialYears(supabase, employee.currentCompanyId),
    loadAccounts(supabase, employee.currentCompanyId),
    loadCategories(supabase, employee.currentCompanyId),
    // 2026-11-19 — the expense line's unit dropdown follows OMS Settings →
    // Measurement, exactly like Office Expenses does. Missing row/columns =
    // every unit (the pre-settings list).
    supabase
      .from("company_measurement_settings")
      .select(
        "enabled_length_units, enabled_area_units, enabled_weight_units, enabled_quantity_units, default_quantity_unit, module_defaults"
      )
      .eq("company_id", employee.currentCompanyId)
      .maybeSingle(),
  ]);
  const unitSettings = {
    enabledUnits: measurementSettings.data
      ? [
          ...(measurementSettings.data.enabled_length_units ?? []),
          ...(measurementSettings.data.enabled_area_units ?? []),
          ...(measurementSettings.data.enabled_weight_units ?? []),
          ...(measurementSettings.data.enabled_quantity_units ?? []),
        ]
      : undefined,
    defaultQuantityUnit:
      (measurementSettings.data?.module_defaults as { expenseQtyUnit?: string } | null)?.expenseQtyUnit ??
      measurementSettings.data?.default_quantity_unit ??
      "PCS",
  };
  const companies = (companiesResult.data ?? []).map((c) => ({ id: c.id, name: c.name }));
  const companyName = companies.find((c) => c.id === employee.currentCompanyId)?.name ?? "Current company";

  const accountOptions: AccountOption[] = accounts.map((account) => ({
    id: account.id,
    name: account.name,
    code: account.code,
    isCash: account.is_cash,
    isBank: account.is_bank,
    isPettyCash: account.is_petty_cash,
    isCreditCard: account.is_credit_card,
  }));
  const categoryOptions: CategoryOption[] = categories
    .filter((c) => c.active)
    .map((c) => ({
      id: c.id,
      name: c.name,
      groupName: c.group_name,
      defaultGstRate: Number(c.default_gst_rate),
      gstApplicable: c.gst_applicable,
      itcEligible: c.itc_eligible,
    }));

  const [{ data: employeeRows }, { data: departmentRows }, { data: roleRows }] = await Promise.all([
    supabase.from("employees").select("id, name").in("company_id", employee.companyIds).eq("active", true).order("name"),
    supabase.from("departments").select("id, name").eq("company_id", employee.currentCompanyId).order("name"),
    supabase.from("roles").select("id, name").order("name"),
  ]);
  const employees = (employeeRows ?? []).map((e) => ({ id: e.id, name: e.name }));
  const departments = (departmentRows ?? []).map((d) => ({ id: d.id, name: d.name }));
  const roles = (roleRows ?? []).map((r) => ({ id: r.id, name: r.name }));

  const homeState = settings?.home_state ?? null;

  /* ---------------- per-tab data ---------------- */

  const vouchers =
    tab === "expenses" || tab === "dashboard" || tab === "approvals"
      ? await loadVouchers(supabase, employee.currentCompanyId, { limit: 200 })
      : [];

  const approvals =
    tab === "approvals" ? vouchers.filter((v) => v.status === "submitted" || v.status === "approved") : [];

  const petty = tab === "petty-cash" || tab === "dashboard" ? await loadPettyCash(supabase, employee.currentCompanyId) : { accounts: [], transactions: [] };
  const claims = tab === "claims" ? await loadClaims(supabase, employee.currentCompanyId) : [];

  const from = params.from ?? `${financialYearLabel(today).slice(0, 4)}-04-01`;
  const to = params.to ?? today;
  const journal = tab === "reports" || tab === "dashboard" ? await loadJournalEntries(supabase, employee.currentCompanyId, { from: tab === "reports" ? from : undefined, to: tab === "reports" ? to : undefined }) : [];

  const trialBalance = buildTrialBalance(accounts, journal);
  const trialDebit = trialBalance.reduce((sum, row) => sum + row.debitPaise, 0);
  const trialCredit = trialBalance.reduce((sum, row) => sum + row.creditPaise, 0);
  const cashBook = buildPaymentBook(accounts, journal, "cash");
  const bankBook = buildPaymentBook(accounts, journal, "bank");

  const activeYear = years.find((y) => y.is_current) ?? years[0] ?? null;
  const openingYearId = params.fy ?? activeYear?.id ?? "";
  const openingYear = years.find((y) => y.id === openingYearId) ?? activeYear;
  const openingRows = tab === "setup" && openingYear ? await loadOpeningBalances(supabase, employee.currentCompanyId, openingYear.id) : [];
  const openingByAccount = new Map(openingRows.map((row) => [row.account_id, row]));
  const approvalLimits = canSetup ? await loadApprovalLimits(supabase, employee.currentCompanyId) : [];
  const openingPosted = canSetup
    ? Boolean(
        (
          await supabase
            .from("fin_journal_entries")
            .select("id")
            .eq("company_id", employee.currentCompanyId)
            .eq("source_type", "opening_balance")
            .limit(1)
        ).data?.length
      )
    : false;

  const posted = vouchers.filter((v) => v.status === "posted" || v.status === "paid");
  const postedTotal = posted.reduce((sum, v) => sum + Math.round(Number(v.grand_total) * 100), 0);
  const byMode = (mode: string) =>
    posted
      .filter((v) => v.payment_mode === mode)
      .reduce((sum, v) => sum + Math.round(Number(v.grand_total) * 100), 0);
  const upiTotal = byMode("UPI");
  const cashTotal = byMode("Cash");
  const bankTotal = posted
    .filter((v) => ["Bank Transfer", "NEFT", "RTGS", "IMPS", "Cheque"].includes(v.payment_mode))
    .reduce((sum, v) => sum + Math.round(Number(v.grand_total) * 100), 0);
  const pendingApprovals = vouchers.filter((v) => v.status === "submitted");
  const pettyBalances = petty.accounts.map((account) => ({
    account,
    balance: pettyCashBalance(
      toPaise(account.opening_balance),
      petty.transactions
        .filter((t) => t.petty_cash_account_id === account.id)
        .map((t) => ({ txnType: t.txn_type as never, amountPaise: toPaise(t.amount) }))
    ),
  }));

  return (
    <main className="mx-auto max-w-7xl space-y-4 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">Office Expenses &amp; Accounts</p>
          <h1 className="text-2xl font-semibold text-stone-900">
            {tab === "dashboard" ? "Office Expenses" : SECTIONS.find((s) => s.id === tab)?.label}
          </h1>
          <p className="text-xs text-stone-500">
            {companyName} · every voucher is approved before it reaches the ledger · {today}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className={`rounded-full px-2 py-0.5 ${homeState ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
            {homeState ? `Home state: ${homeState}` : "Set the home state in Accounts setup"}
          </span>
          <span className={`rounded-full px-2 py-0.5 ${activeYear ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
            {activeYear ? `FY ${activeYear.label}${activeYear.is_locked ? " (locked)" : ""}` : "No financial year configured"}
          </span>
          <span className={`rounded-full px-2 py-0.5 ${accounts.length > 0 ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
            {accounts.length} ledger account{accounts.length === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      {params.ok ? (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{params.ok}</p>
      ) : null}
      {params.error ? (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">{params.error}</p>
      ) : null}

      <nav className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {visibleSections.map((item) => (
          <Link
            key={item.id}
            href={`/dashboard/accounts?tab=${item.id}`}
            aria-current={tab === item.id ? "page" : undefined}
            className={`flex items-start gap-2.5 rounded-xl border p-3 transition ${
              tab === item.id
                ? "border-amber-400 bg-amber-50 ring-1 ring-amber-300"
                : "border-stone-200 bg-white hover:border-amber-300 hover:bg-amber-50/40"
            }`}
          >
            <span className="text-lg leading-none" aria-hidden>
              {item.icon}
            </span>
            <span className="min-w-0">
              <span className={`block text-sm font-medium ${tab === item.id ? "text-amber-900" : "text-stone-800"}`}>
                {item.label}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-stone-500">{item.hint}</span>
            </span>
          </Link>
        ))}
        {/* 2026-11-22 — the P&L overhead log used to be its own launcher tile
            next to this module, which made "office expenses" look like four
            different features. It is one more destination inside the same
            section: same page bar, clearer purpose. */}
        {employee.capabilities.includes("internal_expense_entry") ? (
          <Link
            href="/dashboard/expenses"
            className="flex items-start gap-2.5 rounded-xl border border-stone-200 bg-white p-3 transition hover:border-amber-300 hover:bg-amber-50/40"
          >
            <span className="text-lg leading-none" aria-hidden>
              📈
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-stone-800">P&amp;L Overhead Log</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-stone-500">
                Quick expense log that only feeds the P&amp;L — no voucher, no approval
              </span>
            </span>
          </Link>
        ) : null}
      </nav>

      {/* ================= DASHBOARD ================= */}
      {tab === "dashboard" ? (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi label="Posted expenses" value={formatPaise(postedTotal)} hint={`${posted.length} posted voucher(s)`} />
            <Kpi label="Cash paid" value={formatPaise(cashTotal)} hint="Cash Book" />
            <Kpi label="Bank paid" value={formatPaise(bankTotal)} hint="NEFT / RTGS / IMPS / cheque / transfer" />
            <Kpi label="UPI paid" value={formatPaise(upiTotal)} hint="Mapped to the bank account, never cash" />
            <Kpi
              label="Pending approval"
              value={String(pendingApprovals.length)}
              hint={`₹${(pendingApprovals.reduce((s, v) => s + Math.round(Number(v.grand_total) * 100), 0) / 100).toFixed(2)}`}
            />
            <Kpi
              label="Petty cash balance"
              value={formatPaise(pettyBalances.reduce((sum, p) => sum + p.balance.closingPaise, 0))}
              hint={`${petty.accounts.length} account(s)`}
            />
            <Kpi
              label="Trial balance"
              value={formatPaise(trialDebit)}
              hint={trialDebit === trialCredit ? "Debit = credit ✓" : `Out by ₹${((trialDebit - trialCredit) / 100).toFixed(2)}`}
            />
            <Kpi label="Ledger entries" value={String(journal.length)} hint="Double-entry lines posted" />
          </div>

          <div className={card}>
            <h2 className="mb-2 text-sm font-semibold text-stone-800">Recent vouchers</h2>
            {vouchers.length === 0 ? (
              <Empty text="No expense vouchers yet. Open Expense vouchers to enter the first one." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="py-1 pr-2">Voucher</th>
                      <th className="py-1 pr-2">Date</th>
                      <th className="py-1 pr-2">Type</th>
                      <th className="py-1 pr-2">Mode</th>
                      <th className="py-1 pr-2 text-right">Total</th>
                      <th className="py-1 pr-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vouchers.slice(0, 10).map((voucher) => (
                      <tr key={voucher.id} className="border-t border-stone-100">
                        <td className="py-1 pr-2 font-mono text-[11px]">{voucher.voucher_no ?? "—"}</td>
                        <td className="py-1 pr-2">{voucher.voucher_date}</td>
                        <td className="py-1 pr-2">{voucher.expense_type}</td>
                        <td className="py-1 pr-2">{voucher.payment_mode}</td>
                        <td className="py-1 pr-2 text-right">₹{Number(voucher.grand_total).toFixed(2)}</td>
                        <td className="py-1 pr-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] ${tone(voucher.status)}`}>{voucher.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className={card}>
              <h2 className="mb-2 text-sm font-semibold text-stone-800">Setup checklist</h2>
              <ul className="space-y-1 text-xs text-stone-700">
                <Check ok={Boolean(homeState)} text="Home state + GSTIN (CGST/SGST vs IGST)" />
                <Check ok={Boolean(activeYear)} text="Financial year configured" />
                <Check ok={accounts.some((a) => a.is_cash)} text="A cash account exists" />
                <Check ok={accounts.some((a) => a.is_bank)} text="A bank account exists (UPI must point at one)" />
                <Check ok={openingRows.length > 0} text="Opening balances entered (needed before Phase 2)" />
                <Check ok={journal.some((e) => e.source_type === "opening_balance") || openingPosted} text="Opening balances posted" />
              </ul>
              <p className="mt-2 text-[11px] text-stone-500">
                Opening balances are the bridge between the old system and this ledger — see Accounts setup.
              </p>
            </div>
            <div className={card}>
              <h2 className="mb-2 text-sm font-semibold text-stone-800">How a voucher flows</h2>
              <ol className="list-inside list-decimal space-y-1 text-xs text-stone-700">
                <li>Entry user saves it as a draft and submits it.</li>
                <li>An admin reviews it (self-approval is blocked unless a limit allows it).</li>
                <li>Posting writes the double entry in one transaction — debit = credit, always.</li>
                <li>A posted voucher is never edited: a reversal posts the opposite entries.</li>
              </ol>
            </div>
          </div>
        </div>
      ) : null}

      {/* ================= EXPENSES ================= */}
      {tab === "expenses" ? (
        <div className="space-y-4">
          {employee.capabilities.includes("internal_expense_entry") ? (
            <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs leading-relaxed text-stone-600">
              Everything here is a real double-entry voucher — admin approval, posting, Cash/Bank Book. A quick overhead entry that
              only feeds the P&amp;L (no ledger, no approval) stays on the older{" "}
              <Link href="/dashboard/expenses" className="font-medium underline">
                Office Expenses (P&amp;L)
              </Link>{" "}
              screen.
            </p>
          ) : null}
          {canEntry ? (
            <div className={card}>
              <h2 className="mb-3 text-sm font-semibold text-stone-800">New expense voucher</h2>
              <ExpenseEntryForm
                companies={companies}
                defaultCompanyId={employee.currentCompanyId}
                accounts={accountOptions}
                categories={categoryOptions}
                departments={departments}
                employees={employees}
                homeState={homeState}
                today={today}
                roundToRupee={settings?.round_to_rupee ?? false}
                unitSettings={unitSettings}
              />
            </div>
          ) : null}

          <div className={card}>
            <h2 className="mb-2 text-sm font-semibold text-stone-800">Expense register</h2>
            {vouchers.length === 0 ? (
              <Empty text="No vouchers yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] uppercase tracking-wide text-stone-500">
                    <tr>
                      <th className="py-1 pr-2">Voucher</th>
                      <th className="py-1 pr-2">Date</th>
                      <th className="py-1 pr-2">Type / mode</th>
                      <th className="py-1 pr-2">Payee</th>
                      <th className="py-1 pr-2 text-right">GST</th>
                      <th className="py-1 pr-2 text-right">Total</th>
                      <th className="py-1 pr-2">Status</th>
                      <th className="py-1 pr-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vouchers.map((voucher) => {
                      const gst = Number(voucher.cgst_total) + Number(voucher.sgst_total) + Number(voucher.igst_total) + Number(voucher.cess_total);
                      return (
                        <tr key={voucher.id} className="border-t border-stone-100 align-top">
                          <td className="py-1.5 pr-2 font-mono text-[11px]">
                            {voucher.voucher_no ?? "—"}
                            {voucher.is_interstate ? <span className="ml-1 text-[9px] text-sky-700">IGST</span> : null}
                          </td>
                          <td className="py-1.5 pr-2">{voucher.voucher_date}</td>
                          <td className="py-1.5 pr-2">
                            {voucher.expense_type}
                            <br />
                            <span className="text-stone-500">
                              {voucher.payment_mode}
                              {voucher.upi_reference ? ` · ${voucher.upi_reference}` : ""}
                            </span>
                          </td>
                          <td className="py-1.5 pr-2">{voucher.paid_to ?? "—"}</td>
                          <td className="py-1.5 pr-2 text-right">{gst > 0 ? `₹${gst.toFixed(2)}` : "—"}</td>
                          <td className="py-1.5 pr-2 text-right font-medium">₹{Number(voucher.grand_total).toFixed(2)}</td>
                          <td className="py-1.5 pr-2">
                            <span className={`rounded-full px-2 py-0.5 text-[10px] ${tone(voucher.status)}`}>{voucher.status}</span>
                            {voucher.rejection_reason ? (
                              <p className="mt-1 max-w-[160px] text-[10px] text-red-700">{voucher.rejection_reason}</p>
                            ) : null}
                          </td>
                          <td className="py-1.5 pr-2">
                            <div className="flex flex-wrap gap-1">
                              {["draft", "rejected"].includes(voucher.status) ? (
                                <>
                                  <form action={submitExpenseAction}>
                                    <input type="hidden" name="voucher_id" value={voucher.id} />
                                    <button className={btnQuiet}>Submit</button>
                                  </form>
                                  <form action={deleteExpenseDraftAction}>
                                    <input type="hidden" name="voucher_id" value={voucher.id} />
                                    <button className={btnDanger}>Delete</button>
                                  </form>
                                </>
                              ) : null}
                              {voucher.status === "approved" && canApprove ? (
                                <form action={postExpenseAction}>
                                  <input type="hidden" name="voucher_id" value={voucher.id} />
                                  <button className={btnQuiet}>Post to ledger</button>
                                </form>
                              ) : null}
                              {["posted", "approved"].includes(voucher.status) && voucher.payment_status !== "paid" && canApprove ? (
                                <form action={markExpensePaidAction} className="flex items-center gap-1">
                                  <input type="hidden" name="voucher_id" value={voucher.id} />
                                  <select name="payment_account_id" className="rounded border border-stone-300 px-1 py-0.5 text-[11px]">
                                    <option value="">—</option>
                                    {accountOptions.map((account) => (
                                      <option key={account.id} value={account.id}>
                                        {account.name}
                                      </option>
                                    ))}
                                  </select>
                                  <button className={btnQuiet}>Paid</button>
                                </form>
                              ) : null}
                              {["posted", "paid"].includes(voucher.status) && canSetup ? (
                                <form action={reverseExpenseAction} className="flex items-center gap-1">
                                  <input type="hidden" name="voucher_id" value={voucher.id} />
                                  <input
                                    name="reason"
                                    placeholder="reversal reason"
                                    className="w-28 rounded border border-stone-300 px-1 py-0.5 text-[11px]"
                                    required
                                  />
                                  <button className={btnDanger}>Reverse</button>
                                </form>
                              ) : null}
                              {voucher.attachment_url ? (
                                <a href={voucher.attachment_url} target="_blank" rel="noreferrer" className="text-[11px] underline">
                                  receipt
                                </a>
                              ) : null}
                              {["approved", "posted", "paid"].includes(voucher.status) ? (
                                <PrintDialog
                                  href={`/dashboard/accounts/expense-vouchers/${voucher.id}/report`}
                                  label="🖨 Print"
                                  title={`Expense Voucher — ${voucher.voucher_no ?? voucher.id}`}
                                />
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {/* ================= APPROVALS ================= */}
      {tab === "approvals" ? (
        <div className={`${card} space-y-3`}>
          <h2 className="text-sm font-semibold text-stone-800">Approval queue</h2>
          {approvals.length === 0 ? (
            <Empty text="Nothing waiting for approval." />
          ) : (
            approvals.map((voucher) => (
              <div key={voucher.id} className="rounded-lg border border-stone-200 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-stone-900">
                      {voucher.voucher_no} · ₹{Number(voucher.grand_total).toFixed(2)}
                    </p>
                    <p className="text-[11px] text-stone-500">
                      {voucher.voucher_date} · {voucher.expense_type} · {voucher.payment_mode} ·{" "}
                      {voucher.paid_to ?? "no payee"} · {voucher.invoice_no ? `inv ${voucher.invoice_no}` : "no invoice"}
                      {voucher.is_interstate ? " · IGST" : " · CGST+SGST"}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] ${tone(voucher.status)}`}>{voucher.status}</span>
                </div>
                {voucher.status === "submitted" ? (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <form action={reviewExpenseAction} className="flex items-end gap-2">
                      <input type="hidden" name="voucher_id" value={voucher.id} />
                      <input type="hidden" name="decision" value="approve" />
                      <button className={btn}>Approve</button>
                    </form>
                    <form action={reviewExpenseAction} className="flex items-end gap-2">
                      <input type="hidden" name="voucher_id" value={voucher.id} />
                      <input type="hidden" name="decision" value="reject" />
                      <input name="reason" placeholder="Reason for rejection" className={`${input} w-56`} required />
                      <button className={btnDanger}>Reject</button>
                    </form>
                  </div>
                ) : (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <form action={postExpenseAction}>
                      <input type="hidden" name="voucher_id" value={voucher.id} />
                      <button className={btn}>Post to ledger</button>
                    </form>
                    <PrintDialog
                      href={`/dashboard/accounts/expense-vouchers/${voucher.id}/report`}
                      label="🖨 Print"
                      title={`Expense Voucher — ${voucher.voucher_no ?? voucher.id}`}
                    />
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      ) : null}

      {/* ================= PETTY CASH ================= */}
      {tab === "petty-cash" ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <div className={`${card} lg:col-span-2`}>
            <h2 className="mb-2 text-sm font-semibold text-stone-800">Petty cash accounts</h2>
            {pettyBalances.length === 0 ? (
              <Empty text="No petty cash account yet — create one on the right." />
            ) : (
              <div className="space-y-3">
                {pettyBalances.map(({ account, balance }) => (
                  <div key={account.id} className="rounded-lg border border-stone-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-stone-900">{account.name}</p>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${balance.closingPaise < 0 ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>
                        closing ₹{formatPaise(balance.closingPaise)}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-stone-500">
                      opening ₹{formatPaise(balance.openingPaise)} + received ₹{formatPaise(balance.receivedPaise)} − spent ₹
                      {formatPaise(balance.spentPaise)} − returned ₹{formatPaise(balance.returnedPaise)}
                      {balance.countedPaise !== null
                        ? ` · counted ₹${formatPaise(balance.countedPaise)} (difference ₹${formatPaise(balance.verificationDifferencePaise)})`
                        : ""}
                    </p>
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full text-left text-[11px]">
                        <thead className="text-[9px] uppercase tracking-wide text-stone-500">
                          <tr>
                            <th className="py-0.5 pr-2">Date</th>
                            <th className="py-0.5 pr-2">Type</th>
                            <th className="py-0.5 pr-2 text-right">Amount</th>
                            <th className="py-0.5 pr-2">Note</th>
                          </tr>
                        </thead>
                        <tbody>
                          {petty.transactions
                            .filter((t) => t.petty_cash_account_id === account.id)
                            .slice(0, 12)
                            .map((txn) => (
                              <tr key={txn.id} className="border-t border-stone-100">
                                <td className="py-0.5 pr-2">{txn.txn_date}</td>
                                <td className="py-0.5 pr-2">{txn.txn_type}</td>
                                <td className="py-0.5 pr-2 text-right">₹{Number(txn.amount).toFixed(2)}</td>
                                <td className="py-0.5 pr-2">{txn.narration ?? "—"}</td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-3">
            <div className={card}>
              <h3 className="mb-2 text-sm font-semibold text-stone-800">New petty cash account</h3>
              <form action={savePettyCashAccountAction} className="space-y-2">
                <input type="hidden" name="company_id" value={employee.currentCompanyId} />
                <div>
                  <label className={label}>Name</label>
                  <input name="name" className={input} required placeholder="Site petty cash" />
                </div>
                <div>
                  <label className={label}>Custodian</label>
                  <select name="custodian_employee_id" className={input}>
                    <option value="">—</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={label}>Petty cash ledger account</label>
                  <select name="ledger_account_id" className={input} required>
                    <option value="">—</option>
                    {accountOptions
                      .filter((a) => a.isPettyCash || a.isCash)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.code} · {a.name}
                        </option>
                      ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={label}>Opening balance</label>
                    <input name="opening_balance" className={input} inputMode="decimal" defaultValue="0" />
                  </div>
                  <div>
                    <label className={label}>Float limit</label>
                    <input name="float_limit" className={input} inputMode="decimal" />
                  </div>
                </div>
                <button className={btn}>Create account</button>
              </form>
            </div>

            <div className={card}>
              <h3 className="mb-2 text-sm font-semibold text-stone-800">Record movement</h3>
              <form action={addPettyCashTxnAction} className="space-y-2">
                <div>
                  <label className={label}>Account</label>
                  <select name="petty_cash_account_id" className={input} required>
                    <option value="">—</option>
                    {petty.accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={label}>Date</label>
                    <input type="date" name="txn_date" defaultValue={today} className={input} required />
                  </div>
                  <div>
                    <label className={label}>Type</label>
                    <select name="txn_type" className={input}>
                      {["allocation", "replenishment", "expense", "return", "verification"].map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className={label}>Amount</label>
                  <input name="amount" className={input} inputMode="decimal" required />
                </div>
                <div>
                  <label className={label}>Note</label>
                  <input name="narration" className={input} />
                </div>
                <button className={btn}>Save movement</button>
                <p className="text-[10px] text-stone-500">An expense larger than the cash on hand is refused.</p>
              </form>
            </div>
          </div>
        </div>
      ) : null}

      {/* ================= CLAIMS ================= */}
      {tab === "claims" ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <div className={`${card} lg:col-span-2`}>
            <h2 className="mb-2 text-sm font-semibold text-stone-800">Reimbursement claims</h2>
            {claims.length === 0 ? (
              <Empty text="No claims yet." />
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="py-1 pr-2">Date</th>
                    <th className="py-1 pr-2">Employee</th>
                    <th className="py-1 pr-2">For</th>
                    <th className="py-1 pr-2 text-right">Amount</th>
                    <th className="py-1 pr-2">Status</th>
                    <th className="py-1 pr-2">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {claims.map((claim) => (
                    <tr key={claim.id} className="border-t border-stone-100 align-top">
                      <td className="py-1.5 pr-2">{claim.claim_date}</td>
                      <td className="py-1.5 pr-2">{employees.find((e) => e.id === claim.employee_id)?.name ?? "—"}</td>
                      <td className="py-1.5 pr-2">
                        {claim.description}
                        {claim.rejection_reason ? <p className="text-[10px] text-red-700">{claim.rejection_reason}</p> : null}
                      </td>
                      <td className="py-1.5 pr-2 text-right">₹{Number(claim.amount).toFixed(2)}</td>
                      <td className="py-1.5 pr-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] ${tone(claim.status === "approved" ? "approved" : claim.status)}`}>
                          {claim.status}
                        </span>
                      </td>
                      <td className="py-1.5 pr-2">
                        {claim.status === "submitted" && canApprove ? (
                          <div className="flex flex-wrap gap-1">
                            <form action={reviewClaimAction}>
                              <input type="hidden" name="claim_id" value={claim.id} />
                              <input type="hidden" name="decision" value="approve" />
                              <button className={btnQuiet}>Approve</button>
                            </form>
                            <form action={reviewClaimAction} className="flex gap-1">
                              <input type="hidden" name="claim_id" value={claim.id} />
                              <input type="hidden" name="decision" value="reject" />
                              <input name="reason" placeholder="reason" className="w-24 rounded border border-stone-300 px-1 text-[11px]" required />
                              <button className={btnDanger}>Reject</button>
                            </form>
                          </div>
                        ) : claim.status === "approved" && canApprove ? (
                          <form action={markClaimPaidAction}>
                            <input type="hidden" name="claim_id" value={claim.id} />
                            <button className={btnQuiet}>Mark paid</button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className={card}>
            <h3 className="mb-2 text-sm font-semibold text-stone-800">Submit a claim</h3>
            <form action={submitClaimAction} className="space-y-2">
              <input type="hidden" name="company_id" value={employee.currentCompanyId} />
              <div>
                <label className={label}>Employee</label>
                <select name="employee_id" className={input} defaultValue={employee.id}>
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={label}>Date</label>
                  <input type="date" name="claim_date" defaultValue={today} className={input} required />
                </div>
                <div>
                  <label className={label}>Amount</label>
                  <input name="amount" className={input} inputMode="decimal" required />
                </div>
              </div>
              <div>
                <label className={label}>Category</label>
                <select name="category_id" className={input}>
                  <option value="">—</option>
                  {categoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.groupName} · {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>What for</label>
                <input name="description" className={input} required />
              </div>
              <div>
                <label className={label}>Receipt link (optional)</label>
                <input name="receipt_url" className={input} />
              </div>
              <button className={btn}>Submit claim</button>
              <p className="text-[10px] text-stone-500">
                Approval creates a payable to the employee and posts it to the ledger automatically.
              </p>
            </form>
          </div>
        </div>
      ) : null}

      {/* ================= CATEGORIES ================= */}
      {tab === "categories" ? (
        <div className="grid gap-3 lg:grid-cols-3">
          <div className={`${card} lg:col-span-2`}>
            <h2 className="mb-2 text-sm font-semibold text-stone-800">Expense categories</h2>
            <div className="max-h-[560px] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-white text-[10px] uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="py-1 pr-2">Group</th>
                    <th className="py-1 pr-2">Category</th>
                    <th className="py-1 pr-2 text-right">GST</th>
                    <th className="py-1 pr-2">ITC</th>
                    <th className="py-1 pr-2">Source</th>
                    <th className="py-1 pr-2" />
                  </tr>
                </thead>
                <tbody>
                  {categories.map((category) => (
                    <tr key={category.id} className={`border-t border-stone-100 ${category.active ? "" : "text-stone-400"}`}>
                      <td className="py-1 pr-2">{category.group_name}</td>
                      <td className="py-1 pr-2">{category.name}</td>
                      <td className="py-1 pr-2 text-right">{Number(category.default_gst_rate)}%</td>
                      <td className="py-1 pr-2">{category.itc_eligible ? "yes" : "no"}</td>
                      <td className="py-1 pr-2">{category.company_id ? "custom" : "shared"}</td>
                      <td className="py-1 pr-2">
                        {category.company_id ? (
                          <form action={toggleCategoryAction}>
                            <input type="hidden" name="category_id" value={category.id} />
                            <button className="text-[11px] text-stone-600 hover:underline">
                              {category.active ? "disable" : "enable"}
                            </button>
                          </form>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className={card}>
            <h3 className="mb-2 text-sm font-semibold text-stone-800">Add a category</h3>
            <form action={saveCategoryAction} className="space-y-2">
              <input type="hidden" name="company_id" value={employee.currentCompanyId} />
              <div>
                <label className={label}>Name</label>
                <input name="name" className={input} required />
              </div>
              <div>
                <label className={label}>Group</label>
                <input name="group_name" className={input} defaultValue="Other" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={label}>Default GST</label>
                  <input name="default_gst_rate" className={input} inputMode="decimal" defaultValue="0" />
                </div>
                <div>
                  <label className={label}>Sort order</label>
                  <input name="sort_order" className={input} inputMode="numeric" defaultValue="500" />
                </div>
              </div>
              <div>
                <label className={label}>Ledger account</label>
                <select name="ledger_account_id" className={input}>
                  <option value="">Default office expense</option>
                  {accounts
                    .filter((a) => a.account_type === "expense")
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} · {a.name}
                      </option>
                    ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-xs text-stone-700">
                <input type="checkbox" name="gst_applicable" defaultChecked className="h-4 w-4" /> GST applicable
              </label>
              <label className="flex items-center gap-2 text-xs text-stone-700">
                <input type="checkbox" name="itc_eligible" defaultChecked className="h-4 w-4" /> ITC eligible
              </label>
              <button className={btn}>Add category</button>
            </form>
          </div>
        </div>
      ) : null}

      {/* ================= REPORTS ================= */}
      {tab === "reports" ? (
        <div className="space-y-3">
          <form method="get" className={`${card} flex flex-wrap items-end gap-2`}>
            <input type="hidden" name="tab" value="reports" />
            <div>
              <label className={label}>From</label>
              <input type="date" name="from" defaultValue={from} className={input} />
            </div>
            <div>
              <label className={label}>To</label>
              <input type="date" name="to" defaultValue={to} className={input} />
            </div>
            <button className={btn}>Show</button>
            <span className="text-[11px] text-stone-500">
              {journal.length} journal entries · debit ₹{(trialDebit / 100).toFixed(2)} / credit ₹
              {(trialCredit / 100).toFixed(2)}
            </span>
          </form>

          <div className={card}>
            <h2 className="mb-2 text-sm font-semibold text-stone-800">Trial balance</h2>
            {trialBalance.length === 0 ? (
              <Empty text="Nothing posted in this period." />
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="py-1 pr-2">Code</th>
                    <th className="py-1 pr-2">Account</th>
                    <th className="py-1 pr-2">Type</th>
                    <th className="py-1 pr-2 text-right">Debit</th>
                    <th className="py-1 pr-2 text-right">Credit</th>
                    <th className="py-1 pr-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {trialBalance.map((row) => (
                    <tr key={row.accountId} className="border-t border-stone-100">
                      <td className="py-1 pr-2 font-mono text-[11px]">{row.code}</td>
                      <td className="py-1 pr-2">{row.name}</td>
                      <td className="py-1 pr-2 capitalize">{row.accountType}</td>
                      <td className="py-1 pr-2 text-right">{formatPaise(row.debitPaise)}</td>
                      <td className="py-1 pr-2 text-right">{formatPaise(row.creditPaise)}</td>
                      <td className="py-1 pr-2 text-right">{formatPaise(row.balancePaise)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-stone-300 font-medium">
                    <td className="py-1 pr-2" colSpan={3}>
                      Total
                    </td>
                    <td className="py-1 pr-2 text-right">{formatPaise(trialDebit)}</td>
                    <td className="py-1 pr-2 text-right">{formatPaise(trialCredit)}</td>
                    <td className={`py-1 pr-2 text-right ${trialDebit === trialCredit ? "text-emerald-700" : "text-red-700"}`}>
                      {trialDebit === trialCredit ? "balanced ✓" : formatPaise(trialDebit - trialCredit)}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <BookCard title="Cash book" rows={cashBook} />
            <BookCard title="Bank book" rows={bankBook} />
          </div>

          <div className={card}>
            <h2 className="mb-2 text-sm font-semibold text-stone-800">UPI payments</h2>
            {posted.filter((v) => v.payment_mode === "UPI").length === 0 ? (
              <Empty text="No UPI payments in the register." />
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="py-1 pr-2">Voucher</th>
                    <th className="py-1 pr-2">Date</th>
                    <th className="py-1 pr-2">UTR</th>
                    <th className="py-1 pr-2">Bank account</th>
                    <th className="py-1 pr-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {posted
                    .filter((v) => v.payment_mode === "UPI")
                    .map((voucher) => (
                      <tr key={voucher.id} className="border-t border-stone-100">
                        <td className="py-1 pr-2 font-mono text-[11px]">{voucher.voucher_no}</td>
                        <td className="py-1 pr-2">{voucher.voucher_date}</td>
                        <td className="py-1 pr-2">{voucher.upi_reference ?? voucher.payment_reference ?? "—"}</td>
                        <td className="py-1 pr-2">
                          {accountOptions.find((a) => a.id === voucher.payment_account_id)?.name ?? "—"}
                        </td>
                        <td className="py-1 pr-2 text-right">₹{Number(voucher.grand_total).toFixed(2)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
            <p className="mt-2 text-[11px] text-stone-500">
              One row per UPI payment. It appears in the bank book above and nowhere in the cash book — the same money is
              never counted twice.
            </p>
          </div>
        </div>
      ) : null}

      {/* ================= SETUP ================= */}
      {tab === "setup" ? (
        <div className="space-y-3">
          <div className="grid gap-3 lg:grid-cols-2">
            <div className={card}>
              <h2 className="mb-2 text-sm font-semibold text-stone-800">Company accounts settings</h2>
              <form action={saveSettingsAction} className="grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="company_id" value={employee.currentCompanyId} />
                <div>
                  <label className={label}>Legal name</label>
                  <input name="legal_name" defaultValue={settings?.legal_name ?? ""} className={input} />
                </div>
                <div>
                  <label className={label}>GSTIN</label>
                  <input name="gstin" defaultValue={settings?.gstin ?? ""} className={input} maxLength={15} />
                </div>
                <div>
                  <label className={label}>Home state (place of supply)</label>
                  <select name="home_state" defaultValue={settings?.home_state ?? ""} className={input}>
                    <option value="">—</option>
                    {[
                      "Andhra Pradesh",
                      "Assam",
                      "Bihar",
                      "Chhattisgarh",
                      "Delhi",
                      "Goa",
                      "Gujarat",
                      "Haryana",
                      "Himachal Pradesh",
                      "Jharkhand",
                      "Karnataka",
                      "Kerala",
                      "Madhya Pradesh",
                      "Maharashtra",
                      "Odisha",
                      "Punjab",
                      "Rajasthan",
                      "Tamil Nadu",
                      "Telangana",
                      "Uttar Pradesh",
                      "Uttarakhand",
                      "West Bengal",
                    ].map((state) => (
                      <option key={state} value={state}>
                        {state}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex items-end gap-2 pb-1 text-xs text-stone-700">
                  <input type="checkbox" name="round_to_rupee" defaultChecked={settings?.round_to_rupee ?? false} className="h-4 w-4" />
                  Round vouchers to the nearest rupee
                </label>
                <div className="sm:col-span-2">
                  <button className={btn}>Save settings</button>
                </div>
              </form>
            </div>

            <div className={card}>
              <h2 className="mb-2 text-sm font-semibold text-stone-800">Financial years</h2>
              <ul className="mb-2 space-y-1 text-xs text-stone-700">
                {years.length === 0 ? <li className="text-amber-800">No financial year configured yet.</li> : null}
                {years.map((year) => (
                  <li key={year.id} className="flex items-center justify-between gap-2">
                    <span>
                      {year.label} · {year.start_date} → {year.end_date}
                    </span>
                    <span className="flex gap-1 text-[10px]">
                      {year.is_current ? <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-800">current</span> : null}
                      {year.is_locked ? <span className="rounded-full bg-stone-200 px-2 py-0.5">locked</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
              <form action={saveFinancialYearAction} className="grid gap-2 sm:grid-cols-2">
                <input type="hidden" name="company_id" value={employee.currentCompanyId} />
                <div>
                  <label className={label}>Label</label>
                  <input name="label" placeholder="2026-27" defaultValue={financialYearLabel(today)} className={input} required />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className={label}>Start</label>
                    <input type="date" name="start_date" className={input} required />
                  </div>
                  <div>
                    <label className={label}>End</label>
                    <input type="date" name="end_date" className={input} required />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-xs text-stone-700">
                  <input type="checkbox" name="is_current" defaultChecked className="h-4 w-4" /> Set as current
                </label>
                <label className="flex items-center gap-2 text-xs text-stone-700">
                  <input type="checkbox" name="is_locked" className="h-4 w-4" /> Lock this year
                </label>
                <div className="sm:col-span-2">
                  <button className={btn}>Save financial year</button>
                </div>
              </form>
            </div>
          </div>

          <div className={card}>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-stone-800">Cash, bank, UPI and card accounts</h2>
              <form action={seedDefaultAccountsAction}>
                <input type="hidden" name="company_id" value={employee.currentCompanyId} />
                <button className={btnQuiet}>Ensure default chart of accounts</button>
              </form>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="py-1 pr-2">Code</th>
                    <th className="py-1 pr-2">Name</th>
                    <th className="py-1 pr-2">Type</th>
                    <th className="py-1 pr-2">Kind</th>
                    <th className="py-1 pr-2">UPI handle</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account.id} className="border-t border-stone-100">
                      <td className="py-1 pr-2 font-mono text-[11px]">{account.code}</td>
                      <td className="py-1 pr-2">{account.name}</td>
                      <td className="py-1 pr-2 capitalize">{account.account_type}</td>
                      <td className="py-1 pr-2">
                        {account.is_cash
                          ? "Cash"
                          : account.is_bank
                            ? "Bank"
                            : account.is_petty_cash
                              ? "Petty cash"
                              : account.is_credit_card
                                ? "Credit card"
                                : "—"}
                      </td>
                      <td className="py-1 pr-2">{account.upi_handle ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <form action={saveAccountAction} className="mt-3 grid gap-2 border-t border-stone-200 pt-3 sm:grid-cols-3 lg:grid-cols-6">
              <input type="hidden" name="company_id" value={employee.currentCompanyId} />
              <div>
                <label className={label}>Name</label>
                <input name="name" className={input} placeholder="PNB Current A/c" required />
              </div>
              <div>
                <label className={label}>Code</label>
                <input name="code" className={input} placeholder="auto" />
              </div>
              <div>
                <label className={label}>Kind</label>
                <select name="kind" className={input} required>
                  {["bank", "cash", "petty", "card", "expense", "liability", "asset", "income", "equity"].map((kind) => (
                    <option key={kind} value={kind}>
                      {kind}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={label}>UPI handle</label>
                <input name="upi_handle" className={input} placeholder="nyko@pnb" />
              </div>
              <div>
                <label className={label}>Group</label>
                <input name="account_group" className={input} placeholder="Cash & Bank" />
              </div>
              <div className="flex items-end">
                <button className={btn}>Add account</button>
              </div>
            </form>
          </div>

          <div className={card}>
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-stone-800">Opening balances</h2>
                <p className="text-[11px] text-stone-500">
                  Carry in what already exists before Phase 2 starts: cash on hand, each bank account and the opening
                  payables. They post once, as one balanced journal.
                </p>
              </div>
              <form method="get" className="flex items-end gap-2">
                <input type="hidden" name="tab" value="setup" />
                <div>
                  <label className={label}>Financial year</label>
                  <select name="fy" defaultValue={openingYearId} className={input}>
                    {years.map((year) => (
                      <option key={year.id} value={year.id}>
                        {year.label}
                        {year.is_locked ? " (locked)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <button className={btnQuiet}>Change</button>
              </form>
            </div>

            {!openingYear ? (
              <Empty text="Add a financial year first." />
            ) : openingRows.length > 0 && openingYear.is_locked ? (
              <Empty text="This financial year is locked — opening balances cannot change." />
            ) : (
              <form action={saveOpeningBalancesAction} className="space-y-2">
                <input type="hidden" name="company_id" value={employee.currentCompanyId} />
                <input type="hidden" name="financial_year_id" value={openingYear.id} />
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-white text-[10px] uppercase tracking-wide text-stone-500">
                      <tr>
                        <th className="py-1 pr-2">Code</th>
                        <th className="py-1 pr-2">Account</th>
                        <th className="py-1 pr-2">Type</th>
                        <th className="py-1 pr-2 w-28 text-right">Debit</th>
                        <th className="py-1 pr-2 w-28 text-right">Credit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {accounts.map((account) => {
                        const existing = openingByAccount.get(account.id);
                        return (
                          <tr key={account.id} className="border-t border-stone-100">
                            <td className="py-0.5 pr-2 font-mono text-[11px]">{account.code}</td>
                            <td className="py-0.5 pr-2">
                              {account.name}
                              <input type="hidden" name="account_id[]" value={account.id} />
                            </td>
                            <td className="py-0.5 pr-2 capitalize">{account.account_type}</td>
                            <td className="py-0.5 pr-2">
                              <input
                                name="debit[]"
                                defaultValue={existing && Number(existing.debit) > 0 ? String(Number(existing.debit)) : ""}
                                className={`${input} text-right`}
                                inputMode="decimal"
                              />
                            </td>
                            <td className="py-0.5 pr-2">
                              <input
                                name="credit[]"
                                defaultValue={existing && Number(existing.credit) > 0 ? String(Number(existing.credit)) : ""}
                                className={`${input} text-right`}
                                inputMode="decimal"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button className={btn}>Save opening balances</button>
                  <span className="text-[11px] text-stone-500">
                    Debit and credit must match before anything is accepted.
                  </span>
                </div>
              </form>
            )}

            <form action={postOpeningBalancesAction} className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3">
              <input type="hidden" name="company_id" value={employee.currentCompanyId} />
              <input type="hidden" name="financial_year_id" value={openingYear?.id ?? ""} />
              <button className={btnQuiet}>Post opening balances to the ledger</button>
              <span className="text-[11px] text-stone-500">
                One-time. The database refuses a second posting for the same year.
              </span>
            </form>
          </div>

          <div className={card}>
            <h2 className="mb-2 text-sm font-semibold text-stone-800">Approval limits</h2>
            <p className="mb-2 text-[11px] text-stone-500">
              Who may approve up to what amount. Nobody can approve their own voucher unless the role is explicitly allowed
              to.
            </p>
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-stone-500">
                <tr>
                  <th className="py-1 pr-2">Role</th>
                  <th className="py-1 pr-2 text-right">Limit</th>
                  <th className="py-1 pr-2">Self-approve</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id} className="border-t border-stone-100">
                    <td className="py-1 pr-2">{role.name}</td>
                    <td className="py-1 pr-2 text-right" colSpan={2}>
                      <form action={saveApprovalLimitAction} className="flex items-center justify-end gap-2">
                        <input type="hidden" name="company_id" value={employee.currentCompanyId} />
                        <input type="hidden" name="role_id" value={role.id} />
                        <input
                          name="max_amount"
                          className={`${input} w-28 text-right`}
                          inputMode="decimal"
                          placeholder="0"
                          defaultValue={String(limitsForRole(approvalLimits, role.id) ?? "")}
                        />
                        <label className="flex items-center gap-1 text-[11px] text-stone-600">
                          <input
                            type="checkbox"
                            name="can_self_approve"
                            defaultChecked={false}
                            className="h-3.5 w-3.5"
                          />
                          self
                        </label>
                        <button className={btnQuiet}>Save</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function limitsForRole(limits: Array<{ role_id: string; max_amount: number }>, roleId: string): number | null {
  const found = limits.find((limit) => limit.role_id === roleId);
  return found ? Number(found.max_amount) : null;
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-stone-900">{value}</p>
      {hint ? <p className="text-[10px] text-stone-500">{hint}</p> : null}
    </div>
  );
}

function Check({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li className="flex items-start gap-2">
      <span className={ok ? "text-emerald-600" : "text-amber-600"}>{ok ? "✓" : "○"}</span>
      <span>{text}</span>
    </li>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-stone-300 px-3 py-4 text-xs text-stone-500">{text}</p>;
}

function BookCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ entry: { id: string; entry_date: string; debit: number; credit: number; narration: string | null }; account: { name: string } | null }>;
}) {
  const debit = rows.reduce((sum, row) => sum + Math.round(Number(row.entry.debit) * 100), 0);
  const credit = rows.reduce((sum, row) => sum + Math.round(Number(row.entry.credit) * 100), 0);
  return (
    <div className="rounded-xl border border-stone-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-stone-800">{title}</h2>
        <span className="text-[11px] text-stone-500">
          in ₹{formatPaise(debit)} · out ₹{formatPaise(credit)}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="text-xs text-stone-500">No movements in this period.</p>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-[9px] uppercase tracking-wide text-stone-500">
              <tr>
                <th className="py-0.5 pr-2">Date</th>
                <th className="py-0.5 pr-2">Account</th>
                <th className="py-0.5 pr-2">Narration</th>
                <th className="py-0.5 pr-2 text-right">In</th>
                <th className="py-0.5 pr-2 text-right">Out</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(-40).map((row) => (
                <tr key={row.entry.id} className="border-t border-stone-100">
                  <td className="py-0.5 pr-2">{row.entry.entry_date}</td>
                  <td className="py-0.5 pr-2">{row.account?.name ?? "—"}</td>
                  <td className="py-0.5 pr-2">{row.entry.narration ?? "—"}</td>
                  <td className="py-0.5 pr-2 text-right">
                    {Number(row.entry.debit) > 0 ? `₹${Number(row.entry.debit).toFixed(2)}` : ""}
                  </td>
                  <td className="py-0.5 pr-2 text-right">
                    {Number(row.entry.credit) > 0 ? `₹${Number(row.entry.credit).toFixed(2)}` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
