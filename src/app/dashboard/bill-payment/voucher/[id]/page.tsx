import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";
import { amountInWords } from "@/lib/invoices/number-to-words";

// 2026-10-29d — "WORK FLOW DEKH KE NAYA FEATURE ADD KARO": the store's books
// already record every vendor payment (bill_pass_register_payments) and the
// Bill Statement lists them, but there was no document to PRINT and hand over
// for a payment — the reference billing app ships a Payment Receipt paperwork
// for exactly this step ("Payment Receipts & Vouchers ... amount in words").
//
// This is the payable-side equivalent: one A4 PAYMENT VOUCHER per recorded
// payment, carrying
//   • the letterhead of the company that OWNS the bill (never the company
//     picked in the top-nav switcher — same rule every bill sheet follows),
//   • the party paid, the vendor invoice it settles, mode / UTR / remark,
//   • the amount in figures AND in words (the Indian cheque-writing standard),
//   • live "paid so far / balance still due" pulled from the bill's own
//     ledger — never the stale snapshot stored on the payment row,
//   • blank Prepared / Checked / Authorised signature blocks.
//
// Access: same `bill_payment` capability as the Bill Payment screen, and the
// bill's company must be in the caller's company list — a payment id from
// another company's books must not open here (same rule the Bill Statement
// loader enforces).
//
// No new table, no new column: this is a read-only view over rows that already
// exist, so nothing needs a SQL migration and no accounting figure changes.

export default async function PaymentVoucherPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    return await PaymentVoucherInner(await params);
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

async function PaymentVoucherInner({ id }: { id: string }) {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();

  const { data: payment } = await supabase
    .from("bill_pass_register_payments")
    .select("id, bill_pass_register_id, amount, payment_date, payment_mode, reference_no, remark, entered_by, entered_on")
    .eq("id", id)
    .maybeSingle();
  if (!payment) notFound();

  const { data: bill } = await supabase
    .from("bill_pass_register")
    .select("id, company_id, party_id, invoice_no, vendor_invoice_no, invoice_type, invoice_date, source, total_amt, total_paid, to_be_pay, balance_due, credit_note_amt, adj_amt")
    .eq("id", payment.bill_pass_register_id)
    .maybeSingle();
  if (!bill || !employee.companyIds.includes(bill.company_id)) notFound();

  const [{ data: company }, { data: profile }, { data: party }, { data: enteredBy }] = await Promise.all([
    supabase.from("companies").select("id, name, logo_url").eq("id", bill.company_id).maybeSingle(),
    supabase.from("company_profiles").select("address, phone, email, gstin").eq("company_id", bill.company_id).maybeSingle(),
    bill.party_id
      ? supabase.from("parties").select("name, address, gst, contact_no, email").eq("id", bill.party_id).maybeSingle()
      : Promise.resolve({ data: null }),
    payment.entered_by
      ? supabase.from("employees").select("name").eq("id", payment.entered_by).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const amount = Number(payment.amount ?? 0);
  const invoiceNo = bill.vendor_invoice_no ?? bill.invoice_no ?? "—";
  // Deterministic voucher number — the payment row's own id, not a new
  // sequence row, so printing the voucher twice never mints a second number.
  const voucherNo = `PV-${(payment.payment_date ?? "").replace(/-/g, "")}-${payment.id.slice(0, 6).toUpperCase()}`;
  const paidSoFar = Number(bill.total_paid ?? 0);
  const balanceDue = Number(bill.balance_due ?? 0);
  const inr = (n: number) => `₹${n.toFixed(2)}`;
  const amountWords = amountInWords(amount, "INR").replace(/^INR\s+/, "");

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/dashboard/bill-payment" className="text-sm text-slate-500 hover:underline">
          ← Back to Bill Payment
        </Link>
        <PrintButton label="🖨 Download PDF" />
      </div>

      <PrintArea id="payment-voucher-area" companyName={company?.name} companyLogoUrl={company?.logo_url}>
        <div
          className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-900 shadow-sm print:border-0 print:p-0"
          style={{ fontFamily: "Georgia, serif" }}
        >
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              {company?.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={company.logo_url} alt={company?.name ?? ""} className="h-14 w-14 object-contain" />
              )}
              <div>
                <div className="text-lg font-bold">{company?.name ?? "—"}</div>
                <div className="text-xs text-slate-500">
                  {[profile?.address, profile?.phone, profile?.email].filter(Boolean).join(" | ")}
                </div>
                {profile?.gstin && <div className="text-xs text-slate-500">GSTIN: {profile.gstin}</div>}
              </div>
            </div>
            <div className="text-right text-xs text-slate-500">
              <div className="text-xs uppercase tracking-wide">Voucher No.</div>
              <div className="font-mono text-sm font-semibold text-slate-800">{voucherNo}</div>
            </div>
          </div>

          <div className="mb-6 border-y-2 border-slate-800 py-2 text-center">
            <div className="text-xl font-bold tracking-wide">PAYMENT VOUCHER</div>
            <div className="text-xs text-slate-500">Payment Date: {payment.payment_date ?? "—"}</div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-6 text-xs">
            <div>
              <div className="mb-1 font-semibold text-slate-700">Paid To</div>
              <div className="text-slate-900">{party?.name ?? "—"}</div>
              {party?.address && <div className="text-slate-500">{party.address}</div>}
              {party?.gst && <div className="text-slate-500">GSTIN: {party.gst}</div>}
              {party?.contact_no && <div className="text-slate-500">{party.contact_no}</div>}
            </div>
            <div className="text-right">
              <div className="text-slate-600">Invoice No.: <span className="font-semibold">{invoiceNo}</span></div>
              <div className="text-slate-600">Invoice Type: {bill.invoice_type ?? "—"}</div>
              <div className="text-slate-600">Invoice Date: {bill.invoice_date ?? "—"}</div>
              <div className="text-slate-600">Invoice Total: {inr(Number(bill.total_amt ?? 0))}</div>
            </div>
          </div>

          <table className="mb-4 w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-300 uppercase text-slate-500">
                <th className="py-1.5 pr-2">Particulars</th>
                <th className="py-1.5 pr-2">Mode</th>
                <th className="py-1.5 pr-2">UTR / Cheque / Ref No.</th>
                <th className="py-1.5 pl-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-200">
                <td className="py-1.5 pr-2">
                  Payment against vendor invoice {invoiceNo}
                  {payment.remark ? <span className="block text-slate-500">{payment.remark}</span> : null}
                </td>
                <td className="py-1.5 pr-2">{payment.payment_mode ?? "—"}</td>
                <td className="py-1.5 pr-2 font-mono">{payment.reference_no ?? "—"}</td>
                <td className="py-1.5 pl-2 text-right font-semibold">{inr(amount)}</td>
              </tr>
            </tbody>
          </table>

          <div className="mb-1 rounded-lg bg-slate-50 px-3 py-2 text-xs">
            <span className="font-semibold uppercase text-slate-600">Amount in words: </span>
            <span className="text-slate-900">{amountWords}</span>
          </div>

          <div className="mb-6 grid grid-cols-3 gap-4 text-xs text-slate-600">
            <div>Total Paid on this invoice: <span className="font-semibold text-slate-900">{inr(paidSoFar)}</span></div>
            <div>Credit / Note adjustments: <span className="font-semibold text-slate-900">{inr(Number(bill.credit_note_amt ?? 0) + Number(bill.adj_amt ?? 0))}</span></div>
            <div className="text-right">Balance still due: <span className="font-semibold text-slate-900">{inr(balanceDue)}</span></div>
          </div>

          <div className="mt-12 grid grid-cols-3 gap-6 text-xs text-slate-600">
            <div>
              <div className="border-t border-slate-300 pt-2">Prepared By{enteredBy?.name ? ` (${enteredBy.name})` : ""}</div>
            </div>
            <div>
              <div className="border-t border-slate-300 pt-2">Checked By</div>
            </div>
            <div>
              <div className="border-t border-slate-300 pt-2">For {company?.name ?? "—"} — Authorised Signatory</div>
            </div>
          </div>
        </div>
      </PrintArea>
    </div>
  );
}
