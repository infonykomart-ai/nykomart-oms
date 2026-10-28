import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { isMissingSchemaPiece } from "@/lib/db/missing-column";
import { ExpenseEntrySection, type ExpenseBill } from "./expense-entry-section";
import { ExpenseReportTable, type ExpenseReportRow } from "./expense-report-table";
// 2026-09-15 — "kuch payment auto debit hote hai credit card se — erank,
// etsy bill, ebay & other": the Card Auto-Debits tab (registry + one-click
// monthly logging into internal_expenses).
import { RecurringDebitsSection, type RecurringDebitRow } from "./recurring-debits-section";

// Office/cash expenses (Gap 4 of the 2026-08-20 five-gaps plan — see
// claude/five-gaps-implementation-plan-2026-08-20.md). Rent, electricity,
// fuel, and any other cost not tied to a purchase order or AWB — the
// previously-flagged gap where bank-ledger "OFFICE EXP." rows had nowhere
// to land. Two tabs, same shape as Ad Spend: Entry (log a new expense,
// with a Recent Entries list) and Report (date-range + category filter,
// running total, Universal Export). Also now feeds the P&L Dashboard
// (crm/page.tsx) as a distinct "Internal Expenses" overhead line — see
// pl_dashboard_by_company_view / pl_dashboard_by_month_view.
//
// 2026-10-28 — "office expense vale section ko jese purchase ki entry karte
// hai vese banao: multiple item, party ka naam, invoice no (if applicable),
// invoice date, edit / preview / delete". The Entry tab now loads one BILL per
// entry_group_id (see db/2026-10-28-internal-expense-bills.sql). The read
// falls back to the old flat columns when that patch has not been run yet, and
// every pre-patch row (entry_group_id NULL) is treated as its own one-line
// bill — so the screen never goes blank / broken mid-migration.
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("internal_expense_entry");
  const supabase = createServiceRoleClient();
  const sp = await searchParams;

  const tab = sp.tab === "report" ? "report" : sp.tab === "recurring" ? "recurring" : "entry";

  const [{ data: companies }, { data: parties }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("parties").select("id, name").order("name"),
  ]);

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name]));

  type BillRow = {
    id: string;
    company_id: string;
    expense_date: string;
    category: string;
    amount_inr: number;
    payment_mode: string | null;
    remark: string | null;
    party_id?: string | null;
    invoice_no?: string | null;
    invoice_date?: string | null;
    description?: string | null;
    entry_group_id?: string | null;
  };

  let recentBills: ExpenseBill[] = [];

  if (tab === "entry") {
    const BASE = "id, company_id, expense_date, category, amount_inr, payment_mode, remark";
    const FULL = `${BASE}, party_id, invoice_no, invoice_date, description, entry_group_id`;

    let rows: BillRow[] = [];
    const full = await supabase
      .from("internal_expenses")
      .select(FULL)
      .in("company_id", employee.companyIds)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(120);
    if (!full.error) {
      rows = (full.data ?? []) as BillRow[];
    } else if (isMissingSchemaPiece(full.error)) {
      const base = await supabase
        .from("internal_expenses")
        .select(BASE)
        .in("company_id", employee.companyIds)
        .order("expense_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(120);
      rows = (base.data ?? []) as BillRow[];
    }

    // One bill per group (a pre-patch row has no group → its own bill), then
    // the newest 30 bills.
    const byGroup = new Map<string, BillRow[]>();
    for (const r of rows) {
      const key = r.entry_group_id ?? r.id;
      const list = byGroup.get(key) ?? [];
      list.push(r);
      byGroup.set(key, list);
    }
    // 2026-10-28b — the Finance side of each bill (payable posted to
    // bill_pass_register, source 'office_expense'). Read-only: the sheet and
    // the card can never disagree with Bill Payment / the Party Ledger.
    const groupIds = Array.from(byGroup.keys());
    const financeByGroup = new Map<string, { billId: string; paid: number; balance: number }>();
    if (groupIds.length) {
      const { data: ledger } = await supabase
        .from("bill_pass_register")
        .select("id, source_id, total_paid, balance_due")
        .eq("source", "office_expense")
        .in("source_id", groupIds);
      for (const l of ledger ?? []) {
        if (!l.source_id) continue;
        financeByGroup.set(l.source_id, {
          billId: l.id,
          paid: Number(l.total_paid ?? 0),
          balance: Number(l.balance_due ?? 0),
        });
      }
    }

    recentBills = Array.from(byGroup.entries())
      .map(([key, lines]) => {
        const first = lines[0];
        return {
          key,
          rowIds: lines.map((l) => l.id),
          companyId: first.company_id,
          companyName: companyName.get(first.company_id) ?? "—",
          date: first.expense_date,
          partyId: first.party_id ?? null,
          partyName: first.party_id ? partyName.get(first.party_id) ?? null : null,
          invoiceNo: first.invoice_no ?? null,
          invoiceDate: first.invoice_date ?? null,
          paymentMode: first.payment_mode,
          remark: first.remark,
          items: lines.map((l) => ({
            id: l.id,
            category: l.category,
            description: l.description ?? null,
            amount: Number(l.amount_inr ?? 0),
          })),
          total: lines.reduce((s, l) => s + Number(l.amount_inr ?? 0), 0),
          financeBillId: financeByGroup.get(key)?.billId ?? null,
          paid: financeByGroup.get(key)?.paid ?? 0,
          balanceDue: financeByGroup.get(key)?.balance ?? 0,
        } satisfies ExpenseBill;
      })
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, 30);
  }

  let reportRows: ExpenseReportRow[] = [];
  // server-render time, fine here (not inside a workflow script) — shared
  // by the Report tab's default range and the recurring tab's month cursor.
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const defaultTo = now.toISOString().slice(0, 10);
  const from = typeof sp.from === "string" && sp.from ? sp.from : defaultFrom;
  const to = typeof sp.to === "string" && sp.to ? sp.to : defaultTo;
  const companyFilter = typeof sp.company === "string" ? sp.company : "";
  const categoryFilter = typeof sp.category === "string" ? sp.category : "";

  if (tab === "report") {
    let query = supabase
      .from("internal_expenses")
      .select("id, company_id, expense_date, category, amount_inr, payment_mode, remark")
      .in("company_id", employee.companyIds)
      .gte("expense_date", from)
      .lte("expense_date", to)
      .order("expense_date", { ascending: false });

    if (companyFilter) query = query.eq("company_id", companyFilter);
    if (categoryFilter) query = query.eq("category", categoryFilter);

    const { data: rows } = await query;
    reportRows = (rows ?? []).map((r) => ({
      id: r.id,
      companyName: companyName.get(r.company_id) ?? "—",
      date: r.expense_date,
      category: r.category,
      amount: Number(r.amount_inr ?? 0),
      paymentMode: r.payment_mode,
      remark: r.remark,
    }));
  }

  const tabClass = (active: boolean) =>
    `rounded-lg px-3 py-1.5 text-xs font-semibold transition ${active ? "bg-amber-500 text-white" : "border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`;

  // 2026-09-15 — Card Auto-Debits registry (recurring tab only).
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  let recurringRows: RecurringDebitRow[] = [];
  if (tab === "recurring") {
    const { data: reg } = await supabase
      .from("recurring_card_debits")
      .select("id, company_id, vendor_name, category, amount, card_label, day_of_month, active, last_logged_month")
      .in("company_id", employee.companyIds)
      .order("day_of_month", { ascending: true });
    recurringRows = (reg ?? []).map((r) => ({
      id: r.id,
      company_id: r.company_id,
      company_name: companyName.get(r.company_id) ?? "—",
      vendor_name: r.vendor_name,
      category: r.category,
      amount: r.amount === null ? null : Number(r.amount),
      card_label: r.card_label,
      day_of_month: r.day_of_month,
      active: r.active,
      last_logged_month: r.last_logged_month,
    }));
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">🧾 Office/Cash Expenses</h1>
        </div>
        <Link
          href="/dashboard"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          ← Dashboard
        </Link>
      </div>

      <div className="mb-4 flex gap-2">
        <Link href="/dashboard/expenses?tab=entry" className={tabClass(tab === "entry")}>Log Expense</Link>
        <Link href="/dashboard/expenses?tab=report" className={tabClass(tab === "report")}>Report</Link>
        <Link href="/dashboard/expenses?tab=recurring" className={tabClass(tab === "recurring")}>🔁 Card Auto-Debits</Link>
      </div>

      {tab === "entry" ? (
        <ExpenseEntrySection
          companies={companies ?? []}
          parties={parties ?? []}
          recentBills={recentBills}
        />
      ) : tab === "recurring" ? (
        <RecurringDebitsSection registry={recurringRows} companies={companies ?? []} currentMonth={currentMonth} />
      ) : (
        <ExpenseReportTable
          companies={companies ?? []}
          filters={{ from, to, companyId: companyFilter, category: categoryFilter }}
          rows={reportRows}
        />
      )}
    </div>
  );
}
