import Link from "next/link";
import { requireCapability, ForbiddenError, UnauthorizedError, CURRENT_COMPANY_COOKIE } from "@/lib/auth/require-capability";
import { cookies } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { PartyBalanceSummaryTable, type SummaryRow } from "./summary-table";

// 2026-10-24 — "SABHI PARTY KE LADGER SUMMERY KI KONSI PARTY KA KITNA BALACE
// HAI PAYMENT KARNA HAI. COMPANY WISE."
//
// The Party Ledger page answers that for ONE party, and Bill Payment lists
// individual unpaid BILLS — neither answered "across every party, what do we
// still owe, per company". This page is that roll-up.
//
// Source of truth is bill_pass_register — the same table the party ledger and
// Bill Payment read — so the numbers here always tie out with both. Its
// balance_due is already the generated (total_amt − credit_note_amt − adj_amt
// − total_paid) figure, so nothing is recomputed here: a party's balance is
// simply the sum of the balances of its bills.
//
// Grouping is (party × company) by default: one party can legitimately have
// bills against more than one company (shared purchase), and the summary is
// COMPANY WISE — merging those hides which company has to pay.
//
// 2026-10-24 (b) — "AGAR TEENO COMPANY ME BILL NO SAM HAI TO VO JUD KE AAYE":
// the same vendor invoice is often billed against all three companies, and in
// the company-wise view that reads as three separate lines for one vendor.
// `combine=1` now merges every company into ONE row per party (the same bill
// no across companies simply adds up), with the companies it came from listed
// in the Company column.
//
// A negative net balance is shown as ADVANCE (we paid more than we owe) and
// kept separate from PAYABLE — netting an advance against a different
// invoice's outstanding would misstate what is actually due today.

type Row = SummaryRow;

const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const round2 = (n: number) => Math.round(n * 100) / 100;

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
//
// 2026-10-24 (b) — a failed read now comes back as an error the page can
// SHOW, instead of a thrown error that replaces the whole screen with the
// generic "This page couldn't load" card.
async function loadAllRegisterRows(
  supabase: ReturnType<typeof createServiceRoleClient>,
  companyIds: string[]
): Promise<{
  rows: {
    party_id: string | null;
    company_id: string;
    total_amt: number;
    total_paid: number;
    balance_due: number;
    due_date: string | null;
  }[];
  error: string | null;
}> {
  if (companyIds.length === 0) return { rows: [], error: null };
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
    if (error) return { rows, error: error.message };
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
  return { rows, error: null };
}

async function SummaryInner(sp: { [key: string]: string | string[] | undefined }) {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

  const companyParam = str("company");
  const q = str("q").trim().toLowerCase();
  const onlyDue = str("only") === "due";
  // "teeno company me bill no sam hai to jud ke aaye" — one row per party.
  const combine = str("combine") === "1";
  const today = todayIST();

  // Default: the company this login is currently acting as — the same scope
  // the party ledger defaults to. "all" = every company the login can access.
  const cookieCompany = (await cookies()).get(CURRENT_COMPANY_COOKIE)?.value;
  const current = cookieCompany && employee.companyIds.includes(cookieCompany) ? cookieCompany : employee.currentCompanyId;
  const scopeIds = (companyParam === "all" || combine ? employee.companyIds : [companyParam || current]).filter(Boolean);

  const [{ rows: registerRows, error: loadError }, { data: companies }, { data: parties }] = await Promise.all([
    loadAllRegisterRows(supabase, scopeIds),
    supabase.from("companies").select("id, name").in("id", employee.companyIds),
    supabase.from("parties").select("id, name"),
  ]);

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name] as const));
  const partyName = new Map((parties ?? []).map((p) => [p.id, p.name] as const));

  const grouped = new Map<string, Row>();
  const companiesByParty = new Map<string, Set<string>>();
  for (const r of registerRows) {
    // Salary/advance register rows have no party (employee_id instead) — not
    // a party payable, so they are excluded rather than lumped under "—".
    if (!r.party_id) continue;
    const key = combine ? r.party_id : `${r.party_id}::${r.company_id}`;
    const row =
      grouped.get(key) ??
      ({
        partyId: r.party_id,
        partyName: partyName.get(r.party_id) ?? "Unknown party",
        companyId: combine ? "" : r.company_id,
        companyName: combine ? "" : companyName.get(r.company_id) ?? "—",
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
    if (combine) {
      const set = companiesByParty.get(r.party_id) ?? new Set<string>();
      set.add(companyName.get(r.company_id) ?? "—");
      companiesByParty.set(r.party_id, set);
    }
  }

  const allRows = Array.from(grouped.values());
  for (const r of allRows) {
    if (r.balance < 0) {
      r.advance = -r.balance;
      r.balance = 0;
    }
    // Rounding: sums of numeric(14,2) are exact, but a stray float can still
    // show 1234.5600000000001 — pin to paise.
    r.billed = round2(r.billed);
    r.paid = round2(r.paid);
    r.balance = round2(r.balance);
    r.overdue = round2(r.overdue);
    r.advance = round2(r.advance);
    if (combine) {
      r.companyName = Array.from(companiesByParty.get(r.partyId) ?? []).join(" + ") || "—";
      r.companyId = "combined";
    }
  }

  const rows = allRows
    .filter((r) => (q ? r.partyName.toLowerCase().includes(q) : true))
    .filter((r) => (onlyDue ? r.balance > 0 : true))
    .sort((a, b) => b.balance - a.balance || a.partyName.localeCompare(b.partyName));

  const totals = {
    bills: rows.reduce((s, r) => s + r.bills, 0),
    billed: round2(rows.reduce((s, r) => s + r.billed, 0)),
    paid: round2(rows.reduce((s, r) => s + r.paid, 0)),
    payable: round2(rows.reduce((s, r) => s + r.balance, 0)),
    overdue: round2(rows.reduce((s, r) => s + r.overdue, 0)),
    advance: round2(rows.reduce((s, r) => s + r.advance, 0)),
  };

  const scopeLabel =
    companyParam === "all" || combine ? "All companies" : companyName.get(scopeIds[0] ?? "") ?? "—";
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
        <label className="flex items-center gap-2 pb-1.5 text-xs text-slate-600" title="Same bill no. in several companies adds up into one row per party">
          <input type="checkbox" name="combine" value="1" defaultChecked={combine} className="h-3.5 w-3.5 rounded border-slate-300" />
          All companies combined (ek party = ek row)
        </label>
        <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
          Apply
        </button>
        <Link href="/dashboard/parties/summary" className="text-xs text-slate-400 underline">
          Reset
        </Link>
      </form>

      {loadError && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          Could not read the bill pass register: {loadError}
        </p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-700">Total payable</p>
          <p className="mt-1 text-lg font-semibold text-amber-900">₹{money(totals.payable)}</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-medium text-red-700">Overdue</p>
          <p className="mt-1 text-lg font-semibold text-red-900">₹{money(totals.overdue)}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xs font-medium text-emerald-700">Advance held by us</p>
          <p className="mt-1 text-lg font-semibold text-emerald-900">₹{money(totals.advance)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium text-slate-500">Billed / Paid</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">
            ₹{money(totals.billed)} <span className="font-normal text-slate-400">/</span> ₹{money(totals.paid)}
          </p>
        </div>
      </div>

      <PartyBalanceSummaryTable
        rows={rows}
        scopeLabel={scopeLabel}
        today={today}
        showCompany={companyParam === "all" || combine}
        combined={combine}
        totals={totals}
      />
    </div>
  );
}
