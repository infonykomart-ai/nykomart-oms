import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";

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
export default async function PartyLedgerPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    return await PartyLedgerInner(await params);
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

async function PartyLedgerInner({ id }: { id: string }) {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();

  const { data: party } = await supabase.from("parties").select("id, name, party_type").eq("id", id).maybeSingle();
  if (!party) notFound();

  const { data: entriesRaw } = await supabase
    .from("bill_pass_register")
    .select(
      "id, company_id, invoice_no, vendor_invoice_no, invoice_type, invoice_date, invoice_recv_date, total_amt, credit_note_amt, to_be_pay, total_paid, balance_due, due_date, approval_status, remark, source, source_id, created_at"
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
  // claude/onpoint-express-ledger-reconciliation-2026-08-18.md). Every bill
  // becomes its own Debit line, every credit note becomes its own Credit
  // line, every payment becomes its own Credit line — all merged into one
  // list and sorted strictly by date, so debits and credits genuinely
  // alternate in the order money actually moved, not grouped by invoice.
  type Txn = {
    date: string;
    particulars: string;
    type: "Debit" | "Credit";
    debit: number;
    credit: number;
    sortKey: string; // date + a same-day tiebreaker so a bill sorts before its own same-day payment
  };

  const txns: Txn[] = [];
  for (const e of entriesRaw ?? []) {
    const ref = e.vendor_invoice_no ?? e.invoice_no ?? "—";
    const label = sourceLabel[e.source ?? ""] ?? e.invoice_type ?? "Bill";
    const billDate = e.invoice_date ?? e.invoice_recv_date ?? e.created_at.slice(0, 10);
    const totalAmt = Number(e.total_amt);
    const creditNoteAmt = Number(e.credit_note_amt);
    if (totalAmt !== 0) {
      txns.push({
        date: billDate,
        particulars: `${label} ${ref}`,
        type: "Debit",
        debit: totalAmt,
        credit: 0,
        sortKey: `${billDate}_0`,
      });
    }
    if (creditNoteAmt > 0) {
      txns.push({
        date: billDate,
        particulars: `Credit Note against ${ref}`,
        type: "Credit",
        debit: 0,
        credit: creditNoteAmt,
        sortKey: `${billDate}_1`,
      });
    }
    for (const p of paymentsByBill.get(e.id) ?? []) {
      txns.push({
        date: p.payment_date,
        particulars: `Payment against ${ref}${p.payment_mode ? ` (${p.payment_mode})` : ""}${p.reference_no ? ` · ${p.reference_no}` : ""}`,
        type: "Credit",
        debit: 0,
        credit: p.amount,
        sortKey: `${p.payment_date}_2`,
      });
    }
  }
  txns.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  type LedgerLine = Txn & { balance: number };
  const ledgerLines = txns.reduce<LedgerLine[]>((acc, t) => {
    const prevBalance = acc.length ? acc[acc.length - 1].balance : 0;
    acc.push({ ...t, balance: prevBalance + t.debit - t.credit });
    return acc;
  }, []);

  const totalDebit = ledgerLines.reduce((s, t) => s + t.debit, 0);
  const totalCredit = ledgerLines.reduce((s, t) => s + t.credit, 0);
  const closingBalance = ledgerLines.length ? ledgerLines[ledgerLines.length - 1].balance : 0;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/dashboard/parties" className="text-sm text-slate-500 hover:underline">← Back to Party Master</Link>
        <PrintButton label="🖨 Download PDF" />
      </div>

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
              {ledgerLines.map((t, i) => (
                <tr key={i} className="border-b border-slate-100 align-top text-slate-700">
                  <td className="py-1 pr-2">{t.date}</td>
                  <td className="py-1 pr-2 font-medium text-slate-900">{t.particulars}</td>
                  <td className="py-1 pr-2 text-right">{t.debit > 0 ? t.debit.toFixed(2) : ""}</td>
                  <td className="py-1 pr-2 text-right">{t.credit > 0 ? t.credit.toFixed(2) : ""}</td>
                  <td className="py-1 pr-2 text-right font-medium">{t.balance.toFixed(2)}</td>
                </tr>
              ))}
              {ledgerLines.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-slate-400">
                    No bills against this party yet.
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
