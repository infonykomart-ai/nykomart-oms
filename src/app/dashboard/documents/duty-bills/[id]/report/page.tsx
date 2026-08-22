import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";

// 2026-08-12 (round 10): mirrors freight-bills/[id]/report — matches the
// Duty Tax Bill Excel the user supplied (New_Microsoft_Excel_Worksheet.
// xlsx, 2026-08-12): per-shipment rows + a bottom summary block
// (DISBURSEMENT FEE / COURIER DUTY CHARGES / GST 18% / TOTAL PAYABLE
// AMT — the same 4 manual fields captured on the bill header, since the
// real bill's bottom line doesn't reconcile to a clean formula from the
// per-row figures; see schema.sql's comment on duty_tax_bills.total_
// payable_amt).
export default async function DutyBillReportPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    return await DutyBillReportInner(await params);
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

async function DutyBillReportInner({ id }: { id: string }) {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: billRaw } = await supabase
    .from("duty_tax_bills")
    .select(
      "id, invoice_no, invoice_date, duty_tax_amt_usd, duty_tax_amt_inr, gst_18pct_amt, gross_total_amt, credit_note_no, credit_note_date, credit_note_amt, disbursement_fee, courier_duty_charges_adj, total_payable_amt"
    )
    .eq("id", id)
    .maybeSingle();
  if (!billRaw) notFound();
  // Postgres numeric columns come back as strings over PostgREST — normalize
  // once here rather than trusting the generated `number` type (same
  // convention as documents/page.tsx's mapping).
  const bill = {
    ...billRaw,
    duty_tax_amt_usd: billRaw.duty_tax_amt_usd != null ? Number(billRaw.duty_tax_amt_usd) : null,
    duty_tax_amt_inr: Number(billRaw.duty_tax_amt_inr),
    gst_18pct_amt: Number(billRaw.gst_18pct_amt),
    gross_total_amt: billRaw.gross_total_amt != null ? Number(billRaw.gross_total_amt) : null,
    credit_note_amt: Number(billRaw.credit_note_amt ?? 0),
    disbursement_fee: Number(billRaw.disbursement_fee ?? 0),
    courier_duty_charges_adj: Number(billRaw.courier_duty_charges_adj ?? 0),
    total_payable_amt: billRaw.total_payable_amt != null ? Number(billRaw.total_payable_amt) : null,
  };

  const { data: assignments } = await supabase
    .from("duty_bill_awb_assignments")
    .select("id, order_id, order_shipment_id, duty_tax_amt_usd, duty_tax_amt_inr, other_charge, gst_18pct, credit_note_no, credit_note_amt, debit_note_no, debit_note_amt, remark")
    .eq("duty_tax_bill_id", id);

  const orderIds = (assignments ?? []).map((a) => a.order_id);
  const shipmentIds = (assignments ?? []).map((a) => a.order_shipment_id);
  // Gap 1 (2026-08-20): awb_no comes from the SPECIFIC order_shipments row
  // this assignment points at — see claude/gap1-multipackage-design-
  // 2026-08-20.md and the identical fix in freight-bills/[id]/report.
  //
  // 2026-08-20 (order-value fix): "Sale Amt (INR)" now comes from
  // orders.order_value_inr, not the dead dispatch_invoices.org_sale_amt_inr
  // — same fix as freight-bills/[id]/report, see its comment for the why.
  const [{ data: orders }, { data: dispatches }, { data: shipments }] = await Promise.all([
    orderIds.length
      ? supabase.from("orders").select("id, ref_no, size_label, order_value_inr, item_categories(name)").in("id", orderIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? supabase.from("dispatch_invoices").select("order_id, buyer_country, our_freight_amt").in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
    shipmentIds.length ? supabase.from("order_shipments").select("id, awb_no").in("id", shipmentIds) : Promise.resolve({ data: [] }),
  ]);

  const orderById = new Map((orders ?? []).map((o) => [o.id, o]));
  const dispatchByOrder = new Map((dispatches ?? []).map((d) => [d.order_id, d]));
  const shipmentById = new Map((shipments ?? []).map((s) => [s.id, s]));

  const rows = (assignments ?? []).map((a, i) => {
    const order = orderById.get(a.order_id);
    const dispatch = dispatchByOrder.get(a.order_id);
    const shipment = shipmentById.get(a.order_shipment_id);
    const category = order?.item_categories as unknown as { name: string } | { name: string }[] | null;
    const categoryName = Array.isArray(category) ? category[0]?.name ?? "—" : category?.name ?? "—";
    const orgSale = Number(order?.order_value_inr ?? 0);
    const shippingAmt = Number(dispatch?.our_freight_amt ?? 0);
    const dutyInr = Number(a.duty_tax_amt_inr ?? 0);
    const otherCharge = Number(a.other_charge ?? 0);
    const gst = Number(a.gst_18pct ?? 0);
    const dutyGross = dutyInr + otherCharge + gst;
    const shippingAndDuty = shippingAmt + dutyGross;
    const shippingAndDutyPct = orgSale > 0 ? (shippingAndDuty / orgSale) * 100 : null;
    const shippingPct = orgSale > 0 ? (shippingAmt / orgSale) * 100 : null;
    const dutyPct = orgSale > 0 ? (dutyGross / orgSale) * 100 : null;
    return {
      sr: i + 1,
      invoiceNo: bill.invoice_no,
      refNo: order?.ref_no ?? "—",
      category: categoryName,
      size: order?.size_label ?? "—",
      awb: shipment?.awb_no ?? "—",
      buyerCountry: dispatch?.buyer_country ?? "—",
      orgSale,
      shippingAmt,
      dutyUsd: a.duty_tax_amt_usd != null ? Number(a.duty_tax_amt_usd) : null,
      dutyInr,
      otherCharge,
      gst,
      dutyGross,
      shippingAndDuty,
      shippingAndDutyPct,
      shippingPct,
      dutyPct,
      remark: [a.remark, a.credit_note_no ? `CN ${a.credit_note_no} -₹${a.credit_note_amt}` : null, a.debit_note_no ? `DN ${a.debit_note_no} +₹${a.debit_note_amt}` : null]
        .filter(Boolean)
        .join(" · "),
    };
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/dashboard/documents" className="text-sm text-slate-500 hover:underline">← Back to Document Entry</Link>
        <PrintButton label="🖨 Download PDF" />
      </div>

      <PrintArea id="duty-report-area">
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-xs print:border-0 print:p-0">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-slate-900">Duty &amp; Tax Bill Report</h1>
              <p className="text-slate-500">Invoice {bill.invoice_no} · {bill.invoice_date ?? "—"}</p>
            </div>
            <div className="text-right text-slate-600">
              <p>Duty ₹{bill.duty_tax_amt_inr} + GST ₹{bill.gst_18pct_amt}{bill.duty_tax_amt_usd ? ` (≈ $${bill.duty_tax_amt_usd})` : ""}</p>
              <p className="font-semibold text-slate-900">Gross Total ₹{bill.gross_total_amt ?? bill.duty_tax_amt_inr}</p>
              {bill.credit_note_amt > 0 && <p className="text-purple-700">CN {bill.credit_note_no} · −₹{bill.credit_note_amt}</p>}
            </div>
          </div>

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300 text-[10px] uppercase text-slate-500">
                <th className="py-1 pr-2">Sr.</th>
                <th className="py-1 pr-2">Invoice No.</th>
                <th className="py-1 pr-2">Type</th>
                <th className="py-1 pr-2">Size</th>
                <th className="py-1 pr-2">AWB</th>
                <th className="py-1 pr-2">Buyer Country</th>
                <th className="py-1 pr-2 text-right">Sale Amt (INR)</th>
                <th className="py-1 pr-2 text-right">Shipping Amt</th>
                <th className="py-1 pr-2 text-right">Duty USD</th>
                <th className="py-1 pr-2 text-right">Duty INR</th>
                <th className="py-1 pr-2 text-right">Other</th>
                <th className="py-1 pr-2 text-right">GST 18%</th>
                <th className="py-1 pr-2 text-right">Duty Gross</th>
                <th className="py-1 pr-2 text-right">Shipping+Duty</th>
                <th className="py-1 pr-2 text-right">S+D %</th>
                <th className="py-1 pr-2 text-right">Shipping %</th>
                <th className="py-1 pr-2 text-right">Duty %</th>
                <th className="py-1 pr-2">Remark</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sr} className="border-b border-slate-100 text-slate-700">
                  <td className="py-1 pr-2">{r.sr}</td>
                  <td className="py-1 pr-2 font-medium text-slate-900">{r.refNo}</td>
                  <td className="py-1 pr-2">{r.category}</td>
                  <td className="py-1 pr-2">{r.size}</td>
                  <td className="py-1 pr-2">{r.awb}</td>
                  <td className="py-1 pr-2">{r.buyerCountry}</td>
                  <td className="py-1 pr-2 text-right">{r.orgSale.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right">{r.shippingAmt.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right">{r.dutyUsd ?? "—"}</td>
                  <td className="py-1 pr-2 text-right">{r.dutyInr.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right">{r.otherCharge.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right">{r.gst.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right font-medium">{r.dutyGross.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right">{r.shippingAndDuty.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right">{r.shippingAndDutyPct != null ? `${r.shippingAndDutyPct.toFixed(1)}%` : "—"}</td>
                  <td className="py-1 pr-2 text-right">{r.shippingPct != null ? `${r.shippingPct.toFixed(1)}%` : "—"}</td>
                  <td className="py-1 pr-2 text-right">{r.dutyPct != null ? `${r.dutyPct.toFixed(1)}%` : "—"}</td>
                  <td className="py-1 pr-2 text-slate-500">{r.remark || "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={18} className="py-3 text-center text-slate-400">No AWBs assigned to this bill yet.</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="mt-4 flex justify-end border-t border-slate-300 pt-3">
            <div className="w-64 space-y-1 text-right">
              <p className="text-slate-600">DISBURSEMENT FEE: ₹{bill.disbursement_fee.toFixed(2)}</p>
              <p className="text-slate-600">COURIER DUTY CHARGES: ₹{bill.courier_duty_charges_adj.toFixed(2)}</p>
              <p className="text-slate-600">GST 18%: ₹{bill.gst_18pct_amt.toFixed(2)}</p>
              <p className="font-semibold text-slate-900">
                TOTAL PAYABLE AMT: {bill.total_payable_amt != null ? `₹${bill.total_payable_amt.toFixed(2)}` : "— not entered —"}
              </p>
            </div>
          </div>
        </div>
      </PrintArea>
    </div>
  );
}
