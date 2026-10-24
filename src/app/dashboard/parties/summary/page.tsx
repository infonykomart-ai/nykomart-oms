import Link from "next/link";
import { requireCapability, ForbiddenError, UnauthorizedError, CURRENT_COMPANY_COOKIE } from "@/lib/auth/require-capability";
import { cookies } from "next/headers";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { todayIST } from "@/lib/attendance/ist-date";
import { fyOptions, fyStartYear, fyWindow } from "@/lib/fy-date";
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
// 2026-10-24 (c) — "PARTY BALANCE SUMMERY FY KE HISAB SE NIKL KE AAYE OR
// SELECT KARNE KA OPTION HO": a FY picker. "All time" (the default) keeps the
// previous open-balance view unchanged; picking a FY turns each row into a
// proper FY statement:
//
//     opening (as on 1 April)
//   + bills raised in that FY
//   − credit notes / adjustments in that FY
//   − payments received in that FY
//   = closing balance (as on today for the current FY, 31 March for a past one)
//
// Dating comes from the real documents wherever they exist: a bill posts on
// invoice_date (else invoice_recv_date, else created_at), a payment on
// payment_date, a credit/debit adjustment on created_at. Legacy rows whose
// payments/adjustments were entered as aggregate numbers on the bill (no child
// rows) fall back to the BILL's own date — so the closing figure always equals
// the live balance_due, whichever FY you look at. Nothing is estimated.
//
// A negative closing balance is shown as ADVANCE (we paid more than we owe) and
// kept separate from PAYABLE — netting an advance against a different
// invoice's outstanding would misstate what is actually due today.

type Row = SummaryRow;

type RegisterRow = {
  id: string;
  party_id: string | null;
  company_id: string;
  total_amt: number;
  credit_note_amt: number;
  adj_amt: number;
  total_paid: number;
  balance_due: number;
  due_date: string | null;
  /** The date this bill posts on: invoice_date → invoice_recv_date → created_at. */
  bill_date: string;
};

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
): Promise<{ rows: RegisterRow[]; error: string | null }> {
  if (companyIds.length === 0) return { rows: [], error: null };
  const pageSize = 1000;
  const rows: RegisterRow[] = [];
  for (let from = 0; from < 50000; from += pageSize) {
    const { data, error } = await supabase
      .from("bill_pass_register")
      .select(
        "id, party_id, company_id, total_amt, credit_note_amt, adj_amt, total_paid, balance_due, due_date, invoice_date, invoice_recv_date, created_at"
      )
      .in("company_id", companyIds)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) return { rows, error: error.message };
    for (const r of data ?? []) {
      rows.push({
        id: r.id,
        party_id: r.party_id,
        company_id: r.company_id,
        total_amt: Number(r.total_amt ?? 0),
        credit_note_amt: Number(r.credit_note_amt ?? 0),
        adj_amt: Number(r.adj_amt ?? 0),
        total_paid: Number(r.total_paid ?? 0),
        balance_due: Number(r.balance_due ?? 0),
        due_date: r.due_date,
        bill_date: (r.invoice_date ?? r.invoice_recv_date ?? r.created_at ?? "").slice(0, 10),
      });
    }
    if (!data || data.length < pageSize) break;
  }
  return { rows, error: null };
}

type DatedAmount = { amount: number; date: string };

/**
 * Child rows of the bills on this page: payments (payment_date) and
 * CN/DN adjustments (created_at). Loaded only when the user is looking at an
 * FY, because the all-time view needs neither — it reads the generated
 * balance_due directly.
 *
 * Chunked: `.in()` with tens of thousands of ids would blow the URL length.
 */
async function loadSettlementData(
  supabase: ReturnType<typeof createServiceRoleClient>,
  billIds: string[]
): Promise<{
  paymentsByBill: Map<string, DatedAmount[]>;
  adjustmentsByBill: Map<string, DatedAmount[]>;
  error: string | null;
}> {
  const paymentsByBill = new Map<string, DatedAmount[]>();
  const adjustmentsByBill = new Map<string, DatedAmount[]>();
  const chunkSize = 200;

  for (let i = 0; i < billIds.length; i += chunkSize) {
    const chunk = billIds.slice(i, i + chunkSize);
    const [paymentsRes, adjustmentsRes] = await Promise.all([
      supabase
        .from("bill_pass_register_payments")
        .select("bill_pass_register_id, amount, payment_date")
        .in("bill_pass_register_id", chunk),
      supabase
        .from("bill_pass_register_adjustments")
        .select("bill_pass_register_id, amount, created_at")
        .in("bill_pass_register_id", chunk),
    ]);
    if (paymentsRes.error) return { paymentsByBill, adjustmentsByBill, error: paymentsRes.error.message };
    if (adjustmentsRes.error) return { paymentsByBill, adjustmentsByBill, error: adjustmentsRes.error.message };

    for (const p of paymentsRes.data ?? []) {
      const list = paymentsByBill.get(p.bill_pass_register_id) ?? [];
      list.push({ amount: Number(p.amount ?? 0), date: (p.payment_date ?? "").slice(0, 10) });
      paymentsByBill.set(p.bill_pass_register_id, list);
    }
    for (const a of adjustmentsRes.data ?? []) {
      const list = adjustmentsByBill.get(a.bill_pass_register_id) ?? [];
      list.push({ amount: Number(a.amount ?? 0), date: (a.created_at ?? "").slice(0, 10) });
      adjustmentsByBill.set(a.bill_pass_register_id, list);
    }
  }

  return { paymentsByBill, adjustmentsByBill, error: null };
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

  // 2026-10-24 (c) — FY picker. Default = the RUNNING financial year
  // ("FY ke hisaab se nikal ke aaye"); an explicit empty `fy=` is the
  // "All time" option and keeps the old open-balance view.
  //
  // Numbers check out either way: for the running FY the closing balance is
  // all history − everything paid = the live balance_due, so defaulting to it
  // can never disagree with Bill Payment / Party Ledger. Only a CLOSED FY
  // shows a different (historical) balance, which is the whole point.
  const fyParamPresent = "fy" in sp;
  const fyParam = str("fy");
  const currentFyStart = fyStartYear(today);
  const fyLabelToUse = fyParamPresent ? fyParam : fyWindow(currentFyStart).label;
  const fyMatch = /^(\d{4})-\d{2}$/.exec(fyLabelToUse);
  const requestedFyStart = fyMatch ? Number(fyMatch[1]) : null;

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

  // FY options must cover the oldest bill on this scope — computed from the
  // data, never a hardcoded year list.
  const earliestBillDate = registerRows.reduce<string | null>((min, r) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.bill_date)) return min;
    return !min || r.bill_date < min ? r.bill_date : min;
  }, null);
  const earliestFyStart = earliestBillDate ? fyStartYear(earliestBillDate) : null;
  const fyChoices = fyOptions(
    earliestFyStart != null && requestedFyStart != null ? Math.min(earliestFyStart, requestedFyStart) : earliestFyStart,
    new Date(`${today}T00:00:00Z`)
  );

  // A hand-typed / bookmarked FY outside the generated list is still honoured
  // (the window maths needs no data), it just gets added to the dropdown.
  const fyStartYearSelected =
    requestedFyStart != null && requestedFyStart >= 2000 && requestedFyStart <= currentFyStart + 1 ? requestedFyStart : null;
  const fy = fyStartYearSelected != null ? fyWindow(fyStartYearSelected) : null;
  if (fy && !fyChoices.some((o) => o.value === fy.label)) {
    fyChoices.unshift({
      startYear: fyStartYearSelected as number,
      value: fy.label,
      label: `FY ${fy.label}${fyStartYearSelected === currentFyStart ? " (current)" : ""}`,
    });
    // Newest first; deliberately NOT trimmed to MAX_FY_OPTIONS here — the
    // selected FY must always stay selectable, even a very old bookmarked one.
    fyChoices.sort((a, b) => b.startYear - a.startYear);
  }
  // "As on" date: today for the running FY, the FY's own 31 March for a closed
  // one. Anything dated after it is not part of that statement.
  const asOn = fy ? (fyStartYearSelected === currentFyStart ? (today < fy.end ? today : fy.end) : fy.end) : today;

  const settlements = fy
    ? await loadSettlementData(
        supabase,
        registerRows.map((r) => r.id)
      )
    : { paymentsByBill: new Map<string, DatedAmount[]>(), adjustmentsByBill: new Map<string, DatedAmount[]>(), error: null };

  const grouped = new Map<string, Row>();
  const companiesByParty = new Map<string, Set<string>>();

  // Adds one dated amount to the right bucket: before the FY start it belongs
  // to the opening balance, inside the FY to this FY's movements, after the
  // "as on" date it is simply not part of this statement yet.
  const bucket = (date: string, start: string, end: string) => (date < start ? "opening" : date <= end ? "period" : "future");

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
        opening: 0,
        credited: 0,
        closing: 0,
      } satisfies Row);
    grouped.set(key, row);
    if (combine) {
      const set = companiesByParty.get(r.party_id) ?? new Set<string>();
      set.add(companyName.get(r.company_id) ?? "—");
      companiesByParty.set(r.party_id, set);
    }

    if (!fy) {
      // All-time view — byte-for-byte the previous behaviour.
      row.bills += 1;
      row.billed += r.total_amt;
      row.paid += r.total_paid;
      row.balance += r.balance_due;
      if (r.balance_due > 0 && r.due_date && r.due_date < today) {
        row.overdue += r.balance_due;
        if (!row.oldestDue || r.due_date < row.oldestDue) row.oldestDue = r.due_date;
      }
      continue;
    }

    // ── FY view ────────────────────────────────────────────────────────────
    const date = /^\d{4}-\d{2}-\d{2}$/.test(r.bill_date) ? r.bill_date : fy.start;
    const where = bucket(date, fy.start, asOn);
    if (where === "future") continue;
    if (where === "period") row.bills += 1;

    // Bills raise the payable, so they are the "credit" side of the statement.
    if (where === "opening") row.opening = (row.opening ?? 0) + r.total_amt;
    else row.billed += r.total_amt;

    // Credit notes / adjustments reduce it. Child rows carry their own date;
    // any part of the bill's stored credit_note_amt + adj_amt that has no child
    // rows is a legacy aggregate and posts on the bill's own date.
    const adjRows = settlements.adjustmentsByBill.get(r.id) ?? [];
    const adjFromRows = adjRows.reduce((s, a) => s + a.amount, 0);
    const legacyAdj = Math.max(0, r.credit_note_amt + r.adj_amt - adjFromRows);
    const applyAdjustment = (amount: number, when: string) => {
      if (amount === 0) return;
      const at = bucket(when, fy.start, asOn);
      if (at === "future") return;
      if (at === "opening") row.opening = (row.opening ?? 0) - amount;
      else row.credited = (row.credited ?? 0) + amount;
    };
    for (const a of adjRows) applyAdjustment(a.amount, /^\d{4}-\d{2}-\d{2}$/.test(a.date) ? a.date : date);
    applyAdjustment(legacyAdj, date);

    // Payments reduce it too, with the same legacy fallback (total_paid minus
    // whatever dated payment rows exist).
    const payRows = settlements.paymentsByBill.get(r.id) ?? [];
    const payFromRows = payRows.reduce((s, p) => s + p.amount, 0);
    const legacyPaid = Math.max(0, r.total_paid - payFromRows);
    const applyPayment = (amount: number, when: string) => {
      if (amount === 0) return;
      const at = bucket(when, fy.start, asOn);
      if (at === "future") return;
      if (at === "opening") row.opening = (row.opening ?? 0) - amount;
      else row.paid += amount;
    };
    for (const p of payRows) applyPayment(p.amount, /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : date);
    applyPayment(legacyPaid, date);

    // Overdue is a TODAY fact. A closed FY's statement is a historical
    // position, so it deliberately reports none.
    if (fyStartYearSelected === currentFyStart && r.balance_due > 0 && r.due_date && r.due_date < today) {
      row.overdue += r.balance_due;
      if (!row.oldestDue || r.due_date < row.oldestDue) row.oldestDue = r.due_date;
    }
  }

  const allRows = Array.from(grouped.values());
  for (const r of allRows) {
    if (fy) {
      r.opening = round2(r.opening ?? 0);
      r.billed = round2(r.billed);
      r.paid = round2(r.paid);
      r.credited = round2(r.credited ?? 0);
      r.closing = round2((r.opening ?? 0) + r.billed - (r.credited ?? 0) - r.paid);
      if (r.closing < 0) {
        r.advance = -r.closing;
        r.balance = 0;
      } else {
        r.balance = r.closing;
      }
    } else {
      if (r.balance < 0) {
        r.advance = -r.balance;
        r.balance = 0;
      }
      r.billed = round2(r.billed);
      r.paid = round2(r.paid);
    }
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
    .filter((r) => (fy && !onlyDue ? r.bills > 0 || r.balance > 0 || r.advance > 0 || (r.opening ?? 0) !== 0 : true))
    .sort((a, b) => b.balance - a.balance || a.partyName.localeCompare(b.partyName));

  const totals = {
    bills: rows.reduce((s, r) => s + r.bills, 0),
    opening: round2(rows.reduce((s, r) => s + (r.opening ?? 0), 0)),
    billed: round2(rows.reduce((s, r) => s + r.billed, 0)),
    credited: round2(rows.reduce((s, r) => s + (r.credited ?? 0), 0)),
    paid: round2(rows.reduce((s, r) => s + r.paid, 0)),
    payable: round2(rows.reduce((s, r) => s + r.balance, 0)),
    overdue: round2(rows.reduce((s, r) => s + r.overdue, 0)),
    advance: round2(rows.reduce((s, r) => s + r.advance, 0)),
  };

  const scopeLabel =
    companyParam === "all" || combine ? "All companies" : companyName.get(scopeIds[0] ?? "") ?? "—";
  const inputClass =
    "rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
  const fyCaption = fy
    ? `FY ${fy.label} · ${fy.start} to ${fy.end} · closing as on ${asOn}${fyStartYearSelected === currentFyStart ? " (running FY, today)" : ""}`
    : null;

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
        {/* 2026-10-24 (c) — FY picker. "All time" keeps the old open-balance view. */}
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="fy">
            Financial year
          </label>
          <select id="fy" name="fy" defaultValue={fy?.label ?? ""} className={inputClass} title="Opening + this FY's bills/payments = closing balance">
            <option value="">All time (as on today)</option>
            {fyChoices.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
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

      {fyCaption && (
        <p className="mb-3 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 print:hidden">
          <strong>FY view:</strong> {fyCaption}. Opening + is FY ke bills − credit notes − payments = closing. Jagah jagah ki
          balance waisi hi dikhegi jaisi Party Ledger me hai.
        </p>
      )}

      {loadError && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          Could not read the bill pass register: {loadError}
        </p>
      )}
      {settlements.error && (
        <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
          Could not read payments/adjustments for this FY, so only bills dated inside it are counted: {settlements.error}
        </p>
      )}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {fy ? (
          <>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-xs font-medium text-slate-500">Opening (as on {fy.start})</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">₹{money(totals.opening)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-xs font-medium text-slate-500">Bills in FY</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">₹{money(totals.billed)}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <p className="text-xs font-medium text-slate-500">Paid in FY</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">₹{money(totals.paid)}</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-medium text-amber-700">Closing payable</p>
              <p className="mt-1 text-lg font-semibold text-amber-900">₹{money(totals.payable)}</p>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xs font-medium text-emerald-700">Advance held by us</p>
              <p className="mt-1 text-lg font-semibold text-emerald-900">₹{money(totals.advance)}</p>
            </div>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>

      <PartyBalanceSummaryTable
        rows={rows}
        scopeLabel={scopeLabel}
        today={asOn}
        showCompany={companyParam === "all" || combine}
        combined={combine}
        totals={totals}
        fy={fy ? { label: fy.label, start: fy.start, end: fy.end, asOn, running: fyStartYearSelected === currentFyStart } : null}
      />
    </div>
  );
}
