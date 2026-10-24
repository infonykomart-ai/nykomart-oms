import Link from "next/link";
import { cookies } from "next/headers";
import { requireCapability, ForbiddenError, UnauthorizedError, CURRENT_COMPANY_COOKIE } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { loadAgeing } from "@/lib/parties/ageing";
import { AgeingTable } from "./ageing-table";

// 2026-10-24 — "OR KYA KAR SAKTE HAI" ka pehla jawab: outstanding report total
// batata hai, umar (ageing) nahi. "Kitna paisa kitna purana pada hai" ke liye
// 0-30 / 31-60 / 61-90 / 90+ buckets, party × company wise, ek click par
// WhatsApp reminder ke saath.
//
// The maths lives in src/lib/parties/ageing.ts (shared with the daily
// overdue-digest cron route), so the report and the Telegram digest can never
// disagree. Source: bill_pass_register.balance_due > 0 — the same rows Bill
// Payment and the Party Ledger use. Nothing is stored or recomputed.
const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default async function AgeingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  try {
    return await AgeingInner(await searchParams);
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

async function AgeingInner(sp: { [key: string]: string | string[] | undefined }) {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();
  const str = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");

  const companyParam = str("company");
  const q = str("q").trim().toLowerCase();
  const onlyOverdue = str("only") === "overdue";
  const today = todayIST();

  const cookieCompany = (await cookies()).get(CURRENT_COMPANY_COOKIE)?.value;
  const current = cookieCompany && employee.companyIds.includes(cookieCompany) ? cookieCompany : employee.currentCompanyId;
  const scopeIds = (companyParam === "all" ? employee.companyIds : [companyParam || current]).filter(Boolean);

  const [{ data: companies }, ageing] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds),
    loadAgeing(supabase, scopeIds, today),
  ]);

  const scopeLabel = companyParam === "all" ? "All companies" : companies?.find((c) => c.id === scopeIds[0])?.name ?? "—";
  const showCompany = companyParam === "all";

  const rows = ageing.rows
    .filter((r) => (q ? r.partyName.toLowerCase().includes(q) : true))
    .filter((r) => (onlyOverdue ? r.d1_30 + r.d31_60 + r.d61_90 + r.d90plus > 0 : true))
    .sort((a, b) => b.d90plus - a.d90plus || b.total - a.total || a.partyName.localeCompare(b.partyName));

  // Totals follow the VISIBLE rows (search / overdue filter), same rule the
  // Party Balance Summary uses — the printed sheet must add up to what it shows.
  const sum = (k: "notDue" | "d1_30" | "d31_60" | "d61_90" | "d90plus" | "total") =>
    Math.round(rows.reduce((s, r) => s + r[k], 0) * 100) / 100;
  const totals = {
    notDue: sum("notDue"),
    d1_30: sum("d1_30"),
    d31_60: sum("d31_60"),
    d61_90: sum("d61_90"),
    d90plus: sum("d90plus"),
    total: sum("total"),
    bills: rows.reduce((s, r) => s + r.bills, 0),
    parties: rows.length,
  };
  const overdueTotal = Math.round((totals.d1_30 + totals.d31_60 + totals.d61_90 + totals.d90plus) * 100) / 100;

  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">⏳ Payables Ageing</h1>
          <p className="mt-1 text-sm text-slate-500">
            Kitna paisa kitna purana pada hai — bill ke due date se din gine jaate hain. Source: bill-pass register (Bill Payment / Party Ledger ke same rows).
          </p>
        </div>
        <div className="flex gap-3 text-sm">
          <Link href="/dashboard/reports" className="text-slate-500 hover:underline">
            ← Reports
          </Link>
          <Link href="/dashboard/parties/summary" className="text-amber-700 hover:underline">
            Party Balance Summary →
          </Link>
        </div>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 print:hidden">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="company">
            Company
          </label>
          <select id="company" name="company" defaultValue={companyParam || current} className={inputClass}>
            {(companies ?? []).map((c) => (
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
          <input type="checkbox" name="only" value="overdue" defaultChecked={onlyOverdue} className="h-3.5 w-3.5 rounded border-slate-300" />
          Only overdue (due date nikAL chuki hai)
        </label>
        <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
          Apply
        </button>
        <Link href="/dashboard/reports/ageing" className="text-xs text-slate-400 underline">
          Reset
        </Link>
      </form>

      {ageing.error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          Could not read the bill pass register: {ageing.error}
        </p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium text-slate-500">Not due yet</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">₹{money(totals.notDue)}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <p className="text-xs font-medium text-slate-500">1-30 days</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">₹{money(totals.d1_30)}</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-700">31-90 days</p>
          <p className="mt-1 text-sm font-semibold text-amber-900">₹{money(totals.d31_60 + totals.d61_90)}</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-xs font-medium text-red-700">90+ days</p>
          <p className="mt-1 text-lg font-semibold text-red-900">₹{money(totals.d90plus)}</p>
        </div>
        <div className="rounded-xl border border-slate-300 bg-white p-3">
          <p className="text-xs font-medium text-slate-600">Total payable (overdue ₹{money(overdueTotal)})</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">₹{money(totals.total)}</p>
        </div>
      </div>

      <AgeingTable rows={rows} scopeLabel={scopeLabel} today={today} totals={totals} showCompany={showCompany} />
    </div>
  );
}
