import Link from "next/link";
import { requireCapability, ForbiddenError, UnauthorizedError, CURRENT_COMPANY_COOKIE } from "@/lib/auth/require-capability";
import { cookies } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea } from "@/components/print-view";
import { ExportBar } from "@/components/export-bar";
import type { ExportColumn } from "@/lib/export/export-table";
import { todayIST } from "@/lib/attendance/ist-date";

// 2026-10-24 — "SABHI PARTY KE LADGER SUMMERY KI KONSI PARTY KA KITNA BALACE
// HAI PAYMENT KARNA HAI. COMPANY WISE."
//
// The Party Ledger page (parties/[id]/ledger) answers that for ONE party, and
// Bill Payment lists individual unpaid BILLS — neither answered "across every
// party, what do we still owe, per company". This page is that roll-up.
//
// Source of truth is bill_pass_register — the same table the party ledger and
// Bill Payment read — so the numbers here always tie out with both. Its
// balance_due is already the generated (total_amt − credit_note_amt − adj_amt
// − total_paid) figure, so nothing is recomputed here: a party's balance is
// simply the sum of the balances of its bills.
//
// Grouping is (party × company) deliberately: one party can legitimately have
// bills against more than one company (shared purchase), and the user asked
// for the summary COMPANY WISE — merging those into one number would hide
// which company has to pay. `company=all` widens the view to every company
// this login can access and keeps the company column on every row.
//
// A negative net balance is shown as ADVANCE (we paid more than we owe) and
// kept separate from PAYABLE — netting an advance against a different
// invoice's outstanding would misstate what is actually due today.

type Row = {
  partyId: string;
  partyName: string;
  companyId: string;
  companyName: string;
  bills: number;
  billed: number;
  paid: number;
  balance: number;
  overdue: number;
  oldestDue: string | null;
  advance: number;
};

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function PartyBalanceSummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  try {
    return await SummaryInner(await searchParams);
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof UnauthorizedError) {
      return (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <p className="font-semibold">Access Denied</p>
          <p className="mt-1">{err.message}</p>
        </div>
      );
    }
    throw err;
  }
}

// bill_pass_register can hold far more rows than PostgREST returns in one
// response (1000 by default), and silently summarising only the first 1000
// would understate every balance. Page through until exhausted.
async function loadAllRegisterRows(
  supabase: ReturnType<typeof createServiceRoleClient>,
  companyIds: string[]
) {
  const pageSize = 1000;
  const rows: {
    party_id: string | null;
    company_id: string;
    total_amt: number;
    total_paid: number;
    balance_due: number;
    due_date: string | null;
  }[] = [];
  for (let from = 0; from < 50000; from += pageSize) {
    const { data, error } = await supabase
      .from("bill_pass_register")
      .select("party_id, company_id, total_amt, total_paid, balance_due, due_date")
      .in("company_id", companyIds)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      rows.push({
        party_id: r.party_id,
        company_id: r.company_id,
        total_amt: Number(r.total_amt ?? 0),
        total_paid: Number(r.total_paid ?? 0),
        balance_due: Number(r.balance_due ?? 0),
        due_date: r.due_date,
      });
    }
    if (!data || data.length < pageSize) break;
  }
  return rows;
}

async function SummaryInner(sp: { [key: string]: string | string[] | undefined }) {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

  const companyParam = str("company");
  const q = str("q").trim().toLowerCase();
  const onlyDue = str("only") === "due";
  const today = todayIST();

  // Default: the company this login is currently acting as — the same scope
  // the party ledger defaults to. "all" = every company the login can access.
  const cookieCompany = (await cookies()).get(CURRENT_COMPANY_COOKIE)?.value;
  const current = cookieCompany && employee.companyIds.includes(cookieCompany) ? cookieCompany : employee.currentCompanyId;
  const scopeIds = companyParam === "all" ? employee.companyIds : [companyParam || current];

  const [registerRows, { data: companies }, { data: parties }] = await Promise.all([
    loadAllRegisterRows(supabase, scopeIds.length ? scopeIds : [current]),
    supabase.from("companies").select("id, name").in("id", employee.companyIds),
    supabase.from("parties").select("id, name"),
  ]);

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name] as const));
  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name] as const));

  const grouped = new Map<string, Row>();
  for (const r of registerRows) {
    // Salary/advance register rows have no party (employee_id instead) — not
    // a party payable, so they are excluded rather than lumped under "—".
    if (!r.party_id) continue;
    const key = `${r.party_id}::${r.company_id}`;
    const row =
      grouped.get(key) ??
      ({
        partyId: r.party_id,
        partyName: partyName.get(r.party_id) ?? "Unknown party",
        companyId: r.company_id,
        companyName: companyName.get(r.company_id) ?? "—",
        bills: 0,
        billed: 0,
        paid: 0,
        balance: 0,
        overdue: 0,
        oldestDue: null,
        advance: 0,
      } satisfies Row);
    row.bills += 1;
    row.billed += r.total_amt;
    row.paid += r.total_paid;
    row.balance += r.balance_due;
    if (r.balance_due > 0 && r.due_date && r.due_date < today) {
      row.overdue += r.balance_due;
      if (!row.oldestDue || r.due_date < row.oldestDue) row.oldestDue = r.due_date;
    }
    grouped.set(key, row);
  }

  const allRows = Array.from(grouped.values());
  for (const r of allRows) {
    if (r.balance < 0) {
      r.advance = -r.balance;
      r.balance = 0;
    }
    // Rounding: sums of numeric(14,2) are exact, but a stray float can still
    // show 1234.5600000000001 — pin to paise.
    r.billed = Math.round(r.billed * 100) / 100;
    r.paid = Math.round(r.paid * 100) / 100;
    r.balance = Math.round(r.balance * 100) / 100;
    r.overdue = Math.round(r.overdue * 100) / 100;
    r.advance = Math.round(r.advance * 100) / 100;
  }

  const rows = allRows
    .filter((r) => (q ? r.partyName.toLowerCase().includes(q) : true))
    .filter((r) => (onlyDue ? r.balance > 0 : true))
    .sort((a, b) => b.balance - a.balance || a.partyName.localeCompare(b.partyName));

  const totalPayable = rows.reduce((s, r) => s + r.balance, 0);
  const totalOverdue = rows.reduce((s, r) => s + r.overdue, 0);
  const totalAdvance = rows.reduce((s, r) => s + r.advance, 0);
  const totalBilled = rows.reduce((s, r) => s + r.billed, 0);
  const totalPaid = rows.reduce((s, r) => s + r.paid, 0);

  const columns: ExportColumn<Row>[] = [
    { key: "party", label: "Party", value: (r) => r.partyName },
    { key: "company", label: "Company", value: (r) => r.companyName },
    { key: "bills", label: "Bills", value: (r) => r.bills },
    { key: "billed", label: "Billed (₹)", value: (r) => r.billed.toFixed(2) },
    { key: "paid", label: "Paid (₹)", value: (r) => r.paid.toFixed(2) },
    { key: "balance", label: "Balance Payable (₹)", value: (r) => r.balance.toFixed(2) },
    { key: "overdue", label: "Overdue (₹)", value: (r) => r.overdue.toFixed(2) },
    { key: "advance", label: "Advance (₹)", value: (r) => r.advance.toFixed(2) },
    { key: "oldestDue", label: "Oldest Due Date", value: (r) => r.oldestDue ?? "" },
  ];

  const scopeLabel = companyParam === "all" ? "All companies" : companyName.get(scopeIds[0]) ?? "—";
  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">🧾 Party Balance Summary</h1>
          <p className="mt-1 text-sm text-slate-500">
            Everyone we owe, company-wise — straight from the same bill-pass register the Party Ledger and Bill Payment use.
          </p>
        </div>
        <Link href="/dashboard/parties" className="text-sm text-slate-500 hover:underline">
          ← Party Master
        </Link>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 print:hidden">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="company">
            Company
          </label>
          <select id="company" name="company" defaultValue={companyParam || current} className={inputClass}>
            {(companies ?? [])
              .filter((c) => employee.companyIds.includes(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            <option value="all">All companies</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="q">
            Search party
          </label>
          <input id="q" name="q" defaultValue={str("q")} placeholder="Party name…" className={inputClass} />
        </div>
        <label className="flex items-center gap-2 pb-1.5 text-xs text-slate-600">
          <input type="checkbox" name="only" value="due" defaultChecked={onlyDue} className="h-3.5 w-3.5 rounded border-slate-300" />
          Only parties with a balance to pay
        </label>
        <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
          Apply
        </button>
        <Link href="/dashboard/parties/summary" className="text-xs text-slate-400 underline">
          Reset
        </Link>
      </form>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-700">Total payable</p>
          <p className="mt-1 text-lg font-semibold text-amber-900">₹{money(totalPayable)}</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-medium text-red-700">Overdue</p>
          <p className="mt-1 text-lg font-semibold text-red-900">₹{money(totalOverdue)}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs font-medium text-emerald-700">Advance held by us</p>
          <p className="mt-1 text-lg font-semibold text-emerald-900">₹{money(totalAdvance)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium text-slate-500">Billed / Paid</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            ₹{money(totalBilled)} <span className="font-normal text-slate-400">/</span> ₹{money(totalPaid)}
          </p>
        </div>
      </div>

      <div className="mb-3 print:hidden">
        <ExportBar
          title={`Party Balance Summary — ${scopeLabel}`}
          filenameBase="party-balance-summary"
          columns={columns}
          rows={rows}
          printAreaId="party-balance-summary-print-area"
        />
      </div>

      <PrintArea id="party-balance-summary-print-area">
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white print:overflow-visible print:border-0">
          <div className="border-b border-slate-200 px-4 py-2 text-xs text-slate-500 print:border-slate-300">
            <span className="font-semibold text-slate-900">Party Balance Summary</span> · {scopeLabel} · as on {today}
          </div>
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[10px] uppercase text-slate-500">
                <th className="px-3 py-2">Party</th>
                {companyParam === "all" && <th className="px-2 py-2">Company</th>}
                <th className="px-2 py-2 text-right">Bills</th>
                <th className="px-2 py-2 text-right">Billed</th>
                <th className="px-2 py-2 text-right">Paid</th>
                <th className="px-2 py-2 text-right">Balance Payable</th>
                <th className="px-2 py-2 text-right">Overdue</th>
                <th className="px-2 py-2 text-right">Advance</th>
                <th className="px-2 py-2">Oldest Due</th>
                <th className="px-2 py-2 print:hidden"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.partyId}-${r.companyId}`} className="border-b border-slate-100 text-slate-700">
                  <td className="px-3 py-1.5 font-medium text-slate-900">{r.partyName}</td>
                  {companyParam === "all" && <td className="px-2 py-1.5 text-slate-500">{r.companyName}</td>}
                  <td className="px-2 py-1.5 text-right">{r.bills}</td>
                  <td className="px-2 py-1.5 text-right">{money(r.billed)}</td>
                  <td className="px-2 py-1.5 text-right">{money(r.paid)}</td>
                  <td className={`px-2 py-1.5 text-right font-semibold ${r.balance > 0 ? "text-amber-800" : "text-slate-400"}`}>
                    {r.balance > 0 ? money(r.balance) : "—"}
                  </td>
                  <td className={`px-2 py-1.5 text-right ${r.overdue > 0 ? "font-medium text-red-700" : "text-slate-400"}`}>
                    {r.overdue > 0 ? money(r.overdue) : "—"}
                  </td>
                  <td className="px-2 py-1.5 text-right text-emerald-700">{r.advance > 0 ? money(r.advance) : "—"}</td>
                  <td className="px-2 py-1.5 text-slate-500">{r.oldestDue ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right print:hidden">
                    <Link href={`/dashboard/parties/${r.partyId}/ledger`} className="text-amber-700 hover:underline">
                      Ledger →
                    </Link>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={companyParam === "all" ? 10 : 9} className="px-3 py-6 text-center text-slate-400">
                    No party has an outstanding balance in this scope.
                  </td>
                </tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-slate-400 font-bold text-slate-900">
                  <td className="px-3 py-2" colSpan={companyParam === "all" ? 2 : 1}>
                    TOTAL ({rows.length})
                  </td>
                  <td className="px-2 py-2 text-right">{rows.reduce((s, r) => s + r.bills, 0)}</td>
                  <td className="px-2 py-2 text-right">{money(totalBilled)}</td>
                  <td className="px-2 py-2 text-right">{money(totalPaid)}</td>
                  <td className="px-2 py-2 text-right">{money(totalPayable)}</td>
                  <td className="px-2 py-2 text-right">{money(totalOverdue)}</td>
                  <td className="px-2 py-2 text-right">{money(totalAdvance)}</td>
                  <td className="px-2 py-2" colSpan={2}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </PrintArea>
    </div>
  );
}
