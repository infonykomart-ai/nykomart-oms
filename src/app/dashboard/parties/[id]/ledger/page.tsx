import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea } from "@/components/print-view";
import { groupBills } from "@/lib/bill-grouping";
import { LedgerExportBar } from "./ledger-export-bar";

// Party Ledger (2026-08-17) — "SABHI PARTY KE LADGER BHI NAHI BANE ABHI TAK
// MERE HISAB SE". Investigated first (see db/2026-08-17-freight-duty-bills-
// vendor-party.sql's header comment): no per-party running statement page
// existed anywhere — Party Master is pure CRUD, and Bill Payment only lists
// outstanding bills flat across every party at once. bill_pass_register
// already has everything a real ledger needs (party_id, total_amt,
// credit_note_amt, total_paid, balance_due, due_date) since it's already
// the shared landing table for Purchase Bills (auto-posted, party_id always
// set) and — as of this same round — Courier/Duty bills too (previously
// party_id stayed NULL for those even when sent to Finance). This page is
// simply that table filtered to one party, oldest-first, with a running
// balance and each entry's payment history from bill_pass_register_payments.
export default async function PartyLedgerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  try {
    return await PartyLedgerInner(await params, await searchParams);
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

async function PartyLedgerInner(
  { id }: { id: string },
  sp: { [key: string]: string | string[] | undefined }
) {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();

  const { data: party } = await supabase.from("parties").select("id, name, party_type").eq("id", id).maybeSingle();
  if (!party) notFound();

  const { data: entriesRaw } = await supabase
    .from("bill_pass_register")
    .select(
      "id, company_id, party_id, invoice_no, vendor_invoice_no, invoice_type, invoice_date, invoice_recv_date, total_amt, credit_note_amt, adj_amt, to_be_pay, total_paid, balance_due, due_date, approval_status, remark, source, source_id, created_at"
    )
    .eq("party_id", id)
    .eq("company_id", employee.currentCompanyId)
    .order("invoice_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  // 2026-08-17 fix — "RUGARA ME RUG ARA KI SUMMERY DIKHNI CHAHIYE NYKO MART
  // ME KYU AARI HAI": `parties` is deliberately NOT company-scoped (one
  // party can have bills against more than one company, e.g. a courier or
  // "Prachi Rugs" appearing in both the Nyko Mart and Rug Ara historical
  // imports) — so this page must filter bill_pass_register down to
  // `employee.currentCompanyId` (the company picked in the top-nav
  // switcher), NOT `employee.companyIds` (every company this login can
  // access). The old `.in(..., companyIds)` leaked another company's bills
  // for the same party into whichever company happened to be selected —
  // matches the pattern every other per-company page in this app already
  // uses (orders/new, shipglobal, attendance, etc.).
  const { data: companies } = await supabase.from("companies").select("id, name");
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const currentCompanyName = companyName.get(employee.currentCompanyId) ?? "—";

  const billIds = (entriesRaw ?? []).map((e) => e.id);
  const { data: paymentsRaw } = billIds.length
    ? await supabase
        .from("bill_pass_register_payments")
        .select("id, bill_pass_register_id, amount, payment_date, payment_mode, reference_no, remark")
        .in("bill_pass_register_id", billIds)
        .order("payment_date", { ascending: true })
    : { data: [] };
  type LedgerPayment = { id: string; amount: number; payment_date: string; payment_mode: string | null; reference_no: string | null; remark: string | null };
  const paymentsByBill = new Map<string, LedgerPayment[]>();
  for (const p of paymentsRaw ?? []) {
    const list = paymentsByBill.get(p.bill_pass_register_id) ?? [];
    list.push({ ...p, amount: Number(p.amount) });
    paymentsByBill.set(p.bill_pass_register_id, list);
  }

  const sourceLabel: Record<string, string> = {
    purchase_bill: "Purchase Bill",
    freight_bill: "Courier Bill",
    duty_tax_bill: "Duty & Tax Bill",
  };

  // 2026-08-18 — "ek entry debit ki dikh rahi hai phir credit ki dikh rahi
  // hai, ese ladger format apne system me": redesigned from "one row per
  // invoice, with its payments nested inside" to a real chronological
  // Debit/Credit/Balance ledger — the classic passbook format, same shape
  // as the vendor statements this gets reconciled against (see
  // claude/onpoint-express-ledger-reconciliation-2026-08-18.md).
  //
  // 2026-08-20 — Debit/Credit swap ("purchase/courier party se service
  // lete hain to credit hoga ya debit... mere hisab se credit me jayega"):
  // every party on this ledger is a vendor/supplier — a Creditor in
  // standard (Tally-style) bookkeeping. Standard convention posts a bill
  // (liability increases — we now owe them) to the CREDIT side of the
  // party's account, and a payment (liability decreases) to the DEBIT
  // side. The original 2026-08-18 build had these swapped (Bill=Debit,
  // Payment=Credit) — functionally consistent internally, but backwards
  // from the standard Dr/Cr convention the user actually expects. Fixed
  // here: Bill → Credit line, Credit Note → Debit line (it reduces what we
  // owe, same direction as a payment), Payment → Debit line. The
  // underlying "amount payable" math is unchanged (still bill amount minus
  // credit notes minus payments) — only which column each line's amount
  // lands in, and therefore Total Debit/Total Credit, is swapped. See
  // `balance` below: now `credit - debit` (was `debit - credit`) so
  // `closingBalance > 0` still means "we owe the party this much".
  type Txn = {
    date: string;
    particulars: string;
    type: "Debit" | "Credit";
    debit: number;
    credit: number;
    sortKey: string; // date + a same-day tiebreaker so a bill sorts before its own same-day payment
  };

  // 2026-08-27 — "party ladger me bhi ese hi dikh raha hai" (same N-rows-
  // per-invoice bug as Approvals/Bill Payment): a multi-item/multi-order
  // Purchase Bill's several bill_pass_register rows are grouped (see
  // src/lib/bill-grouping.ts) into ONE "Credit" ledger line per invoice
  // (summed total_amt) and ONE combined "Debit" line for any credit-note/
  // adjustment amount, BEFORE building txns — every member row's own
  // payments still post individually (a payment is its own real-world
  // event, not something to merge), just all labeled against the shared
  // invoice ref.
  const txns: Txn[] = [];
  const partyIdEntries = (entriesRaw ?? []).filter((e): e is typeof e & { party_id: string } => !!e.party_id);
  for (const eg of groupBills(partyIdEntries)) {
    const first = eg.bills[0];
    const ref = first.vendor_invoice_no ?? first.invoice_no ?? "—";
    const label = sourceLabel[first.source ?? ""] ?? first.invoice_type ?? "Bill";
    const billDate = first.invoice_date ?? first.invoice_recv_date ?? first.created_at.slice(0, 10);
    const totalAmt = eg.bills.reduce((sum, b) => sum + Number(b.total_amt), 0);
    const creditNoteAmt = eg.bills.reduce((sum, b) => sum + Number(b.credit_note_amt), 0);
    const adjAmt = eg.bills.reduce((sum, b) => sum + Number(b.adj_amt ?? 0), 0);
    const itemsSuffix = eg.isGroup ? ` (${eg.bills.length} items)` : "";
    if (totalAmt !== 0) {
      txns.push({
        date: billDate,
        particulars: `${label} ${ref}${itemsSuffix}`,
        type: "Credit",
        debit: 0,
        credit: totalAmt,
        sortKey: `${billDate}_0`,
      });
    }
    if (creditNoteAmt > 0) {
      txns.push({
        date: billDate,
        particulars: `Credit Note against ${ref}`,
        type: "Debit",
        debit: creditNoteAmt,
        credit: 0,
        sortKey: `${billDate}_1`,
      });
    }
    if (adjAmt > 0) {
      txns.push({
        date: billDate,
        particulars: `Debit/Credit Note adjustment against ${ref}`,
        type: "Debit",
        debit: adjAmt,
        credit: 0,
        sortKey: `${billDate}_1`,
      });
    }
    for (const b of eg.bills) {
      for (const p of paymentsByBill.get(b.id) ?? []) {
        txns.push({
          date: p.payment_date,
          particulars: `Payment against ${ref}${p.payment_mode ? ` (${p.payment_mode})` : ""}${p.reference_no ? ` · ${p.reference_no}` : ""}`,
          type: "Debit",
          debit: p.amount,
          credit: 0,
          sortKey: `${p.payment_date}_2`,
        });
      }
    }
  }
  txns.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  type LedgerLine = Txn & { balance: number };
  const ledgerLines = txns.reduce<LedgerLine[]>((acc, t) => {
    const prevBalance = acc.length ? acc[acc.length - 1].balance : 0;
    acc.push({ ...t, balance: prevBalance + t.credit - t.debit });
    return acc;
  }, []);

  // Total Debit / Total Credit / Closing Balance always reflect the FULL,
  // unfiltered history — same as a real bank passbook: filtering the view
  // below to a date range or Debit/Credit-only doesn't change what's
  // actually still owed, it just changes which rows are shown. Each row's
  // own `balance` value (computed above, before filtering) is likewise
  // always the true running balance at that point in time, not recomputed
  // against the filtered subset — filtering out earlier rows must not make
  // a later row's Balance column look wrong.
  const totalDebit = ledgerLines.reduce((s, t) => s + t.debit, 0);
  const totalCredit = ledgerLines.reduce((s, t) => s + t.credit, 0);
  const closingBalance = ledgerLines.length ? ledgerLines[ledgerLines.length - 1].balance : 0;

  // 2026-08-19 — "kaha pata chal raha hai ki apne ko ab kitna payment
  // karna hai" + "ladger me bhi to filter hona chaihiye credit debit date
  // sabhi filter ka" + "sabhi party ke ladger me hona chahiye": the
  // Closing Balance figure above IS that answer (it's total_amt minus
  // every credit note and every payment, running the same way
  // balance_due does on Bill Payment) — but it wasn't called out clearly,
  // and this page had no filter UI at all despite every other list page
  // in the app having one. This is the single shared page every party's
  // ledger renders through (`/dashboard/parties/[id]/ledger`), so both
  // fixes apply to every party automatically, not just this one.
  const fromDate = typeof sp.from === "string" ? sp.from : "";
  const toDate = typeof sp.to === "string" ? sp.to : "";
  const txnType = typeof sp.type === "string" ? sp.type : "";

  const displayedLines = ledgerLines.filter((t) => {
    if (fromDate && t.date < fromDate) return false;
    if (toDate && t.date > toDate) return false;
    if (txnType === "debit" && !(t.debit > 0)) return false;
    if (txnType === "credit" && !(t.credit > 0)) return false;
    return true;
  });
  const filtersActive = Boolean(fromDate || toDate || txnType);
  const shownDebit = displayedLines.reduce((s, t) => s + t.debit, 0);
  const shownCredit = displayedLines.reduce((s, t) => s + t.credit, 0);

  const isPayable = closingBalance > 0.005;
  const isCredit = closingBalance < -0.005;

  // 2026-08-19 — "print ka option bhi karo... export ka option bhi karo
  // jisme chose karne par option mange ki file ko kisme export karni hai
  // pdf ya xls": exports whatever's currently shown (respects the active
  // filter above, same as the printed view does) — CSV/Excel/Word/
  // PDF-via-Print/Email/WhatsApp, via the app's existing Universal Export
  // system (see ledger-export-bar.tsx).
  const exportRows = displayedLines.map((t) => ({
    date: t.date,
    particulars: t.particulars,
    debit: t.debit,
    credit: t.credit,
    balance: t.balance,
  }));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/dashboard/parties" className="text-sm text-slate-500 hover:underline">← Back to Party Master</Link>
        <LedgerExportBar partyName={party.name} rows={exportRows} printAreaId="party-ledger-area" />
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4 text-sm print:hidden">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={fromDate} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={toDate} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="type">Type</label>
          <select id="type" name="type" defaultValue={txnType} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500">
            <option value="">All (Debit + Credit)</option>
            <option value="debit">Debit only (bills)</option>
            <option value="credit">Credit only (credit notes + payments)</option>
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
          Filter
        </button>
        {filtersActive && (
          <a href={`/dashboard/parties/${id}/ledger`} className="text-xs text-slate-400 underline">Clear</a>
        )}
      </form>

      <PrintArea id="party-ledger-area">
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-xs print:border-0 print:p-0">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-slate-900">Party Ledger</h1>
              <p className="text-slate-500">{party.name}{party.party_type ? ` · ${party.party_type}` : ""}</p>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">{currentCompanyName}</p>
            </div>
            <div className="text-right text-slate-600">
              <p>Total Debit ₹{totalDebit.toFixed(2)}</p>
              <p>Total Credit ₹{totalCredit.toFixed(2)}</p>
              <p className="font-semibold text-slate-900">Closing Balance ₹{closingBalance.toFixed(2)}</p>
            </div>
          </div>

          {/* Direct, unambiguous answer to "ab kitna payment karna hai":
              closingBalance > 0 means we owe the party that much; < 0
              means the party is in credit with us (an advance/overpayment
              sitting on our books, same convention used for RJ2425004810's
              overpayment adjustment). */}
          {(isPayable || isCredit) && (
            <div
              className={`mb-4 rounded-lg border px-4 py-2.5 text-sm font-semibold ${
                isPayable
                  ? "border-red-200 bg-red-50 text-red-700"
                  : "border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
            >
              {isPayable
                ? `Amount payable to ${party.name}: ₹${closingBalance.toFixed(2)}`
                : `${party.name} is in credit with us: ₹${Math.abs(closingBalance).toFixed(2)} (advance/overpayment)`}
            </div>
          )}

          {filtersActive && (
            <p className="mb-2 text-[11px] text-slate-500 print:hidden">
              Showing {displayedLines.length} of {ledgerLines.length} entries
              {fromDate ? ` from ${fromDate}` : ""}{toDate ? ` to ${toDate}` : ""}
              {txnType ? ` · ${txnType} only` : ""} — Debit ₹{shownDebit.toFixed(2)}, Credit ₹{shownCredit.toFixed(2)} in this range.
              Closing Balance above is always the full, unfiltered total.
            </p>
          )}

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300 text-[10px] uppercase text-slate-500">
                <th className="py-1 pr-2">Date</th>
                <th className="py-1 pr-2">Particulars</th>
                <th className="py-1 pr-2 text-right">Debit</th>
                <th className="py-1 pr-2 text-right">Credit</th>
                <th className="py-1 pr-2 text-right">Balance</th>
              </tr>
            </thead>
            <tbody>
              {displayedLines.map((t, i) => (
                <tr key={i} className="border-b border-slate-100 align-top text-slate-700">
                  <td className="py-1 pr-2">{t.date}</td>
                  <td className="py-1 pr-2 font-medium text-slate-900">{t.particulars}</td>
                  <td className="py-1 pr-2 text-right">{t.debit > 0 ? t.debit.toFixed(2) : ""}</td>
                  <td className="py-1 pr-2 text-right">{t.credit > 0 ? t.credit.toFixed(2) : ""}</td>
                  <td className="py-1 pr-2 text-right font-medium">{t.balance.toFixed(2)}</td>
                </tr>
              ))}
              {displayedLines.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-slate-400">
                    {ledgerLines.length === 0 ? "No bills against this party yet." : "No entries match the selected filter."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </PrintArea>
    </div>
  );
}
