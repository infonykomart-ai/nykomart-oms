import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { ExpenseEntrySection } from "./expense-entry-section";
import { ExpenseReportTable, type ExpenseReportRow } from "./expense-report-table";

// Office/cash expenses (Gap 4 of the 2026-08-20 five-gaps plan — see
// claude/five-gaps-implementation-plan-2026-08-20.md). Rent, electricity,
// fuel, and any other cost not tied to a purchase order or AWB — the
// previously-flagged gap where bank-ledger "OFFICE EXP." rows had nowhere
// to land. Two tabs, same shape as Ad Spend: Entry (log a new expense,
// with a Recent Entries list) and Report (date-range + category filter,
// running total, Universal Export). Also now feeds the P&L Dashboard
// (crm/page.tsx) as a distinct "Internal Expenses" overhead line — see
// pl_dashboard_by_company_view / pl_dashboard_by_month_view.
export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("internal_expense_entry");
  const supabase = createServiceRoleClient();
  const sp = await searchParams;

  const tab = sp.tab === "report" ? "report" : "entry";

  const { data: companies } = await supabase
    .from("companies")
    .select("id, name")
    .in("id", employee.companyIds)
    .order("name");

  let recentEntries: {
    id: string;
    companyName: string;
    date: string;
    category: string;
    amount: number;
    paymentMode: string | null;
    remark: string | null;
  }[] = [];

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));

  if (tab === "entry") {
    const { data: recent } = await supabase
      .from("internal_expenses")
      .select("id, company_id, expense_date, category, amount_inr, payment_mode, remark")
      .in("company_id", employee.companyIds)
      .order("expense_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(30);

    recentEntries = (recent ?? []).map((r) => ({
      id: r.id,
      companyName: companyName.get(r.company_id) ?? "—",
      date: r.expense_date,
      category: r.category,
      amount: Number(r.amount_inr ?? 0),
      paymentMode: r.payment_mode,
      remark: r.remark,
    }));
  }

  let reportRows: ExpenseReportRow[] = [];
  const now = new Date(); // server-render time, fine here (not inside a workflow script)
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

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">🧾 Office/Cash Expenses</h1>
          <p className="mt-1 text-sm text-slate-500">
            Rent, electricity, fuel and other overhead not tied to any purchase order or AWB. Feeds into the P&amp;L
            Dashboard as a separate line from order/shipping expenses.
          </p>
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
      </div>

      {tab === "entry" ? (
        <ExpenseEntrySection companies={companies ?? []} recentEntries={recentEntries} />
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
