import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";

// 2026-08-29 (evening) — Journal Voucher print/report page. Same shape as
// the Debit Note / Credit Note / Internal Invoice report pages (see
// debit-notes/[id]/report's header comment for the general pattern and the
// 3-row header restructure), adapted to the paper JV template the user
// shared: "JV No. / Date", "Vendor / Invoice No. / Date", "Debit Amount /
// Item Details / Passed Amount", "Qty / Qlty / Particulars / Remarks",
// "Prepared By / Check By / Approved By" (blank print labels only, per the
// user's own answer — no approval-status workflow).
//
// Passed Amount: when this JV is linked to a bill (bill_pass_register_id
// set), the LIVE bill_pass_register.to_be_pay is shown instead of the
// stored passed_amount column — to_be_pay already nets out any Debit/
// Credit Note raised against the bill, including ones raised AFTER this JV
// was created, so the printed JV never shows a stale figure. See
// db/2026-08-29-journal-voucher.sql for the full rationale.
export default async function JournalVoucherReportPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    return await JournalVoucherReportInner(await params);
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

async function JournalVoucherReportInner({ id }: { id: string }) {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: jvRaw } = await supabase
    .from("journal_vouchers")
    .select(
      "id, company_id, jv_no, jv_date, bill_pass_register_id, party_id, vendor_invoice_no, invoice_date, debit_amount, passed_amount, item_details, qty, qty_unit, qlty, particulars, remark"
    )
    .eq("id", id)
    .maybeSingle();
  if (!jvRaw) notFound();

  const jv = {
    ...jvRaw,
    debit_amount: Number(jvRaw.debit_amount),
    passed_amount: jvRaw.passed_amount != null ? Number(jvRaw.passed_amount) : null,
    qty: jvRaw.qty != null ? Number(jvRaw.qty) : null,
  };

  const [{ data: company }, { data: profile }, { data: party }, billResult] = await Promise.all([
    supabase.from("companies").select("id, name, logo_url").eq("id", jv.company_id).single(),
    supabase.from("company_profiles").select("address, phone, email").eq("company_id", jv.company_id).maybeSingle(),
    jv.party_id ? supabase.from("parties").select("name, address, gst, contact_no").eq("id", jv.party_id).maybeSingle() : Promise.resolve({ data: null }),
    jv.bill_pass_register_id
      ? supabase
          .from("bill_pass_register")
          .select("company_id, party_id, vendor_invoice_no, source, to_be_pay, credit_note_amt, adj_amt")
          .eq("id", jv.bill_pass_register_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const bill = billResult.data;

  // 2026-08-29 (later, same evening) — this JV's bill_pass_register_id is
  // only a REPRESENTATIVE row when it's linked to a multi-item/multi-order
  // Purchase Bill (one real vendor invoice split across N bill_pass_register
  // rows, one per item — see src/lib/bill-grouping.ts and
  // actions.ts's createJournalVoucherForBill). Sum the live balance across
  // every sibling row sharing the same invoice (identical grouping
  // key/condition as groupBills() elsewhere) so Passed Amount reflects the
  // WHOLE invoice per "INVOICE ME JO ITEM HOGA UN SABKI EK HI JV BANEGI",
  // not just its first item. Courier/Duty Bill and manual entries are never
  // grouped, so this is a no-op single-row sum for them.
  let billTotals: { to_be_pay: number; credit_note_amt: number; adj_amt: number } | null = bill
    ? { to_be_pay: Number(bill.to_be_pay ?? 0), credit_note_amt: Number(bill.credit_note_amt ?? 0), adj_amt: Number(bill.adj_amt ?? 0) }
    : null;
  if (bill && bill.source === "purchase_bill" && bill.vendor_invoice_no && bill.party_id) {
    const { data: siblings } = await supabase
      .from("bill_pass_register")
      .select("to_be_pay, credit_note_amt, adj_amt")
      .eq("company_id", bill.company_id)
      .eq("party_id", bill.party_id)
      .eq("source", "purchase_bill")
      .eq("vendor_invoice_no", bill.vendor_invoice_no);
    if (siblings && siblings.length > 0) {
      const summed = { to_be_pay: 0, credit_note_amt: 0, adj_amt: 0 };
      for (const s of siblings) {
        summed.to_be_pay += Number(s.to_be_pay ?? 0);
        summed.credit_note_amt += Number(s.credit_note_amt ?? 0);
        summed.adj_amt += Number(s.adj_amt ?? 0);
      }
      billTotals = summed;
    }
  }

  // Prefer the live bill balance when linked (see header comment) — falls
  // back to the stored column for a manual/unlinked JV.
  const passedAmount = billTotals ? billTotals.to_be_pay : jv.passed_amount;
  // 2026-09-02 — same live-vs-snapshot preference as Passed Amount above,
  // for the same reason: a note raised against this bill AFTER the JV was
  // created must still show up here rather than the printed JV going
  // stale. Also fixes a real bug — the stored jv.debit_amount from
  // createJournalVoucherForBill used to be the invoice's full total_amt
  // (always nonzero), not the actual adjusted amount; this live figure is
  // correct regardless of when the row was created.
  const debitAmount = billTotals ? billTotals.credit_note_amt + billTotals.adj_amt : jv.debit_amount;
  const hasAdjustment = billTotals != null && (billTotals.credit_note_amt > 0 || billTotals.adj_amt > 0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/dashboard/documents?tab=journal-voucher" className="text-sm text-slate-500 hover:underline">
          ← Back to Document Entry
        </Link>
        <PrintButton label="🖨 Download PDF" />
      </div>

      <PrintArea id="journal-voucher-report-area">
        <div className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-900 shadow-sm print:border-0 print:p-0" style={{ fontFamily: "Georgia, serif" }}>
          <div className="mb-4 flex items-center gap-3">
            {company?.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={company.logo_url} alt={company?.name ?? ""} className="h-14 w-14 object-contain" />
            )}
            <div>
              <div className="text-lg font-bold">{company?.name ?? "—"}</div>
              <div className="text-xs text-slate-500">
                {[profile?.address, profile?.phone, profile?.email].filter(Boolean).join(" | ")}
              </div>
            </div>
          </div>
          <div className="mb-6 border-b border-slate-300 pb-4 text-center">
            <div className="text-xl font-bold tracking-wide text-slate-800">JOURNAL VOUCHER</div>
            <div className="text-xs text-slate-500">
              JV No.: <span className="font-semibold text-slate-800">{jv.jv_no ?? "—"}</span>
            </div>
            <div className="text-xs text-slate-500">Date: {jv.jv_date}</div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-6 text-xs">
            <div>
              <div className="mb-1 font-semibold text-slate-700">Vendor</div>
              <div className="text-slate-900">{party?.name ?? "—"}</div>
              {party?.address && <div className="text-slate-500">{party.address}</div>}
              {party?.gst && <div className="text-slate-500">GSTIN: {party.gst}</div>}
              {party?.contact_no && <div className="text-slate-500">{party.contact_no}</div>}
            </div>
            <div className="text-right">
              <div className="text-slate-600">Invoice No.: {jv.vendor_invoice_no ?? "—"}</div>
              <div className="text-slate-600">Invoice Date: {jv.invoice_date ?? "—"}</div>
            </div>
          </div>

          {hasAdjustment && (
            <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-slate-700">
              <span className="font-semibold text-slate-700">Adjustment applied: </span>
              this bill has a linked Credit Note / adjustment reducing its payable — Passed Amount below already reflects it.
            </div>
          )}

          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-300 uppercase text-slate-500">
                <th className="py-1.5 pr-2 text-right">Debit Amount</th>
                <th className="py-1.5 pr-2">Item Details</th>
                <th className="py-1.5 pr-2 text-right">Passed Amount</th>
                <th className="py-1.5 pr-2 text-right">Qty</th>
                <th className="py-1.5 pr-2">Qlty</th>
                <th className="py-1.5 pr-2">Particulars</th>
                <th className="py-1.5 pl-2">Remarks</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-200">
                <td className="py-1.5 pr-2 text-right font-medium">{debitAmount.toFixed(2)}</td>
                <td className="py-1.5 pr-2">{jv.item_details ?? "—"}</td>
                <td className="py-1.5 pr-2 text-right font-semibold text-slate-900">
                  {passedAmount != null ? passedAmount.toFixed(2) : "—"}
                </td>
                <td className="py-1.5 pr-2 text-right">{jv.qty ?? "—"}{jv.qty != null && jv.qty_unit ? ` ${jv.qty_unit}` : ""}</td>
                <td className="py-1.5 pr-2">{jv.qlty ?? "—"}</td>
                <td className="py-1.5 pr-2">{jv.particulars ?? "—"}</td>
                <td className="py-1.5 pl-2">{jv.remark ?? "—"}</td>
              </tr>
            </tbody>
          </table>

          <div className="mt-12 grid grid-cols-3 gap-6 text-xs text-slate-600">
            <div>
              <div className="border-t border-slate-300 pt-2">Prepared By</div>
            </div>
            <div>
              <div className="border-t border-slate-300 pt-2">Check By</div>
            </div>
            <div>
              <div className="border-t border-slate-300 pt-2">Approved By</div>
            </div>
          </div>
        </div>
      </PrintArea>
    </div>
  );
}
