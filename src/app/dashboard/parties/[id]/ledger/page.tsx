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
    .in("company_id", employee.companyIds)
    .order("invoice_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });

  const { data: companies } = await supabase.from("companies").select("id, name");
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));

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

  type LedgerEntry = (typeof entriesRaw extends (infer T)[] | null ? T : never) & {
    total_amt: number;
    credit_note_amt: number;
    to_be_pay: number;
    total_paid: number;
    balance_due: number;
    companyName: string;
    payments: LedgerPayment[];
    runningBalance: number;
  };

  // Running balance — cumulative "to be pay" (bill amount net of its own
  // credit note) minus cumulative paid, in the same oldest-first order the
  // table is sorted in. This is a plain running total, not a stored
  // column — bill_pass_register only stores each row's OWN balance_due.
  // Built via reduce (not an outer-scope running-total variable mutated
  // inside .map) so this Server Component's render function stays free of
  // reassignment across iterations.
  const entries = (entriesRaw ?? []).reduce<LedgerEntry[]>((acc, e) => {
    const toBePay = Number(e.to_be_pay);
    const totalPaid = Number(e.total_paid);
    const prevBalance = acc.length ? acc[acc.length - 1].runningBalance : 0;
    acc.push({
      ...e,
      total_amt: Number(e.total_amt),
      credit_note_amt: Number(e.credit_note_amt),
      to_be_pay: toBePay,
      total_paid: totalPaid,
      balance_due: Number(e.balance_due),
      companyName: companyName.get(e.company_id) ?? "—",
      payments: paymentsByBill.get(e.id) ?? [],
      runningBalance: prevBalance + toBePay - totalPaid,
    });
    return acc;
  }, []);

  const totalBilled = entries.reduce((s, e) => s + e.total_amt, 0);
  const totalCredited = entries.reduce((s, e) => s + e.credit_note_amt, 0);
  const totalPaid = entries.reduce((s, e) => s + e.total_paid, 0);
  const totalOutstanding = entries.reduce((s, e) => s + e.balance_due, 0);

  const sourceLabel: Record<string, string> = {
    purchase_bill: "Purchase Bill",
    freight_bill: "Courier Bill",
    duty_tax_bill: "Duty & Tax Bill",
  };

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
            </div>
            <div className="text-right text-slate-600">
              <p>Total Billed ₹{totalBilled.toFixed(2)} − Credit Notes ₹{totalCredited.toFixed(2)}</p>
              <p>Paid ₹{totalPaid.toFixed(2)}</p>
              <p className="font-semibold text-slate-900">Outstanding ₹{totalOutstanding.toFixed(2)}</p>
            </div>
          </div>

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300 text-[10px] uppercase text-slate-500">
                <th className="py-1 pr-2">Date</th>
                <th className="py-1 pr-2">Type</th>
                <th className="py-1 pr-2">Invoice No.</th>
                <th className="py-1 pr-2">Company</th>
                <th className="py-1 pr-2 text-right">Total Amt</th>
                <th className="py-1 pr-2 text-right">Credit Note</th>
                <th className="py-1 pr-2 text-right">To Be Pay</th>
                <th className="py-1 pr-2 text-right">Paid</th>
                <th className="py-1 pr-2 text-right">Balance Due</th>
                <th className="py-1 pr-2 text-right">Running Balance</th>
                <th className="py-1 pr-2">Status</th>
                <th className="py-1 pr-2">Remark / Payments</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-slate-100 align-top">
                  <td className="py-1 pr-2">{e.invoice_date ?? e.invoice_recv_date ?? "—"}</td>
                  <td className="py-1 pr-2">{sourceLabel[e.source ?? ""] ?? e.invoice_type ?? "—"}</td>
                  <td className="py-1 pr-2 font-medium text-slate-900">{e.vendor_invoice_no ?? e.invoice_no ?? "—"}</td>
                  <td className="py-1 pr-2">{e.companyName}</td>
                  <td className="py-1 pr-2 text-right">{e.total_amt.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right">{e.credit_note_amt.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right">{e.to_be_pay.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right">{e.total_paid.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right font-medium">{e.balance_due.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right font-medium">{e.runningBalance.toFixed(2)}</td>
                  <td className="py-1 pr-2">{e.approval_status}</td>
                  <td className="py-1 pr-2 text-slate-500">
                    {e.remark && <div>{e.remark}</div>}
                    {e.payments.map((p) => (
                      <div key={p.id}>
                        ✓ ₹{p.amount.toFixed(2)} on {p.payment_date}{p.payment_mode ? ` (${p.payment_mode})` : ""}
                        {p.reference_no ? ` · ${p.reference_no}` : ""}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
              {entries.length === 0 && (
                <tr>
                  <td colSpan={12} className="py-3 text-center text-slate-400">
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
