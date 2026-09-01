import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";

// 2026-08-12 (round 10): "BILL PASS VALE SECTION ME CHALA JAYE US BILL KI
// REPORT NIKALE KI KITNA KYA KYA KESE KESE JESE ME EK FILE DE RAHA HU
// USKE ACCORDING EK FILE GENRATE HOYEGI" — a printable report for one
// Courier Bill, laid out to match the real Freight/Courier Bill Excel the
// user supplied (276431293.xlsx, 2026-08-12): per-shipment rows (PO No,
// Invoice No, Type, Sizes, AWB, Buyer Country, sale/shipping amounts,
// weights, difference) + a bottom summary (per item-category sale/
// shipping breakdown + OUR SHIPPING CHARGE / COURIER SHIPPING CHARGE /
// DIFFERENCE). Figures come from `orders` + `dispatch_invoices` (the
// "OUR" side, already on file) joined against this bill's own
// freight_bill_awb_assignments (the "BILL"/actual side, entered when the
// courier's invoice arrives) — nothing here is guessed; anything not
// derivable from either source (e.g. Dimensional Weight) is the manual
// figure entered at assignment time.
export default async function FreightBillReportPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    return await FreightBillReportInner(await params);
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

async function FreightBillReportInner({ id }: { id: string }) {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: billRaw } = await supabase
    .from("freight_bills")
    .select(
      "id, invoice_no, invoice_date, bill_weight_kg, freight_amt, fuel_amt, other_charges, total_amt, gst_18pct_amt, gross_total_amt, credit_note_no, credit_note_date, credit_note_amt"
    )
    .eq("id", id)
    .maybeSingle();
  if (!billRaw) notFound();
  // Postgres numeric columns come back as strings over PostgREST — normalize
  // once here rather than trusting the generated `number` type (same
  // convention as documents/page.tsx's mapping).
  const bill = {
    ...billRaw,
    freight_amt: Number(billRaw.freight_amt),
    fuel_amt: Number(billRaw.fuel_amt),
    other_charges: Number(billRaw.other_charges),
    total_amt: billRaw.total_amt != null ? Number(billRaw.total_amt) : null,
    gst_18pct_amt: billRaw.gst_18pct_amt != null ? Number(billRaw.gst_18pct_amt) : null,
    gross_total_amt: billRaw.gross_total_amt != null ? Number(billRaw.gross_total_amt) : null,
    credit_note_amt: Number(billRaw.credit_note_amt ?? 0),
  };

  const { data: assignments } = await supabase
    .from("freight_bill_awb_assignments")
    // 2026-09-01: billed_freight_amt added — booking-cost-vs-billed-cost
    // recheck, see db/2026-09-01-multi-courier-booking-and-freight-recon.sql.
    .select(
      "id, order_id, order_shipment_id, bill_weight_kg, dimensional_weight_kg, difference_amt, billed_freight_amt, credit_note_no, credit_note_amt, debit_note_no, debit_note_amt, remark"
    )
    .eq("freight_bill_id", id);

  const orderIds = (assignments ?? []).map((a) => a.order_id);
  const shipmentIds = (assignments ?? []).map((a) => a.order_shipment_id);
  // Gap 1 (2026-08-20): awb_no/weight come from the SPECIFIC order_shipments/
  // order_packages row this assignment points at (accurate per-AWB, an order
  // can have more than one now), not dispatch_invoices' order-level summary
  // — see claude/gap1-multipackage-design-2026-08-20.md. dispatch_invoices
  // stays the source for order-level billing figures (our_freight_amt,
  // charges, gst) — out of scope for this round.
  //
  // 2026-08-20 (order-value fix): "Sale Amt (INR)" now comes from
  // orders.order_value_inr, NOT dispatch_invoices.org_sale_amt_inr.
  // org_sale_amt_inr is a dead column — nothing in the app writes it, it
  // only ever got a value from the one-time historical import, so every
  // order dispatched since then showed 0.00 here (see the user-supplied
  // screenshot in that round's chat). order_value_inr is app-computed on
  // every order insert/edit (see orders table comment in schema.sql) and
  // is the one true "order value" — sales_invoices.invoice_value_usd/inr
  // stays separate, that's the invoice DOCUMENT's own figure, not this.
  const [{ data: orders }, { data: dispatches }, { data: shipments }, { data: packages }] = await Promise.all([
    orderIds.length
      ? supabase.from("orders").select("id, ref_no, size_label, order_value_inr, item_categories(name)").in("id", orderIds)
      : Promise.resolve({ data: [] }),
    orderIds.length
      ? supabase
          .from("dispatch_invoices")
          .select("order_id, buyer_country, our_freight_amt, demand_surcharge_other_charge, gst_18pct")
          .in("order_id", orderIds)
      : Promise.resolve({ data: [] }),
    // 2026-09-01: booked_freight_amt/currency/source added — see the
    // reconciliation migration's comment.
    shipmentIds.length
      ? supabase.from("order_shipments").select("id, awb_no, booked_freight_amt, booked_currency, booked_amount_source").in("id", shipmentIds)
      : Promise.resolve({ data: [] }),
    shipmentIds.length ? supabase.from("order_packages").select("order_shipment_id, weight_kg").in("order_shipment_id", shipmentIds) : Promise.resolve({ data: [] }),
  ]);

  const orderById = new Map((orders ?? []).map((o) => [o.id, o]));
  const dispatchByOrder = new Map((dispatches ?? []).map((d) => [d.order_id, d]));
  const shipmentById = new Map((shipments ?? []).map((s) => [s.id, s]));
  const weightByShipment = new Map<string, number>();
  for (const p of packages ?? []) {
    if (p.weight_kg == null) continue;
    weightByShipment.set(p.order_shipment_id, (weightByShipment.get(p.order_shipment_id) ?? 0) + Number(p.weight_kg));
  }

  const rows = (assignments ?? []).map((a, i) => {
    const order = orderById.get(a.order_id);
    const dispatch = dispatchByOrder.get(a.order_id);
    const shipment = shipmentById.get(a.order_shipment_id);
    const category = order?.item_categories as unknown as { name: string } | { name: string }[] | null;
    const categoryName = Array.isArray(category) ? category[0]?.name ?? "—" : category?.name ?? "—";
    const ourShipping = Number(dispatch?.our_freight_amt ?? 0);
    const otherCharges = Number(dispatch?.demand_surcharge_other_charge ?? 0);
    const totalShipping = ourShipping + otherCharges;
    const gst = Number(dispatch?.gst_18pct ?? 0);
    const grossShipping = totalShipping + gst;
    const orgSale = Number(order?.order_value_inr ?? 0);
    const shippingPct = orgSale > 0 ? (grossShipping / orgSale) * 100 : null;
    return {
      sr: i + 1,
      refNo: order?.ref_no ?? "—",
      category: categoryName,
      size: order?.size_label ?? "—",
      awb: shipment?.awb_no ?? "—",
      buyerCountry: dispatch?.buyer_country ?? "—",
      orgSale,
      ourShipping,
      otherCharges,
      totalShipping,
      gst,
      grossShipping,
      ourWeight: weightByShipment.has(a.order_shipment_id) ? weightByShipment.get(a.order_shipment_id)! : null,
      billWeight: a.bill_weight_kg != null ? Number(a.bill_weight_kg) : null,
      dimWeight: a.dimensional_weight_kg != null ? Number(a.dimensional_weight_kg) : null,
      differenceAmt: a.difference_amt != null ? Number(a.difference_amt) : null,
      shippingPct,
      // 2026-09-01: non-blocking booking-cost-vs-billed-cost "recheck" note
      // — see db/2026-09-01-multi-courier-booking-and-freight-recon.sql.
      remark: [
        a.remark,
        a.credit_note_no ? `CN ${a.credit_note_no} -₹${a.credit_note_amt}` : null,
        a.debit_note_no ? `DN ${a.debit_note_no} +₹${a.debit_note_amt}` : null,
        shipment?.booked_freight_amt != null
          ? `Booked ${shipment.booked_currency} ${Number(shipment.booked_freight_amt).toFixed(2)}${
              shipment.booked_amount_source === "rate_card_estimate" ? " (est.)" : ""
            }${
              a.billed_freight_amt != null
                ? ` vs Billed ${shipment.booked_currency} ${Number(a.billed_freight_amt).toFixed(2)} (Diff ${(
                    Number(a.billed_freight_amt) - Number(shipment.booked_freight_amt)
                  ).toFixed(2)})`
                : ""
            }`
          : null,
      ]
        .filter(Boolean)
        .join(" · "),
    };
  });

  // Bottom summary — per item-category sale/shipping breakdown (whatever
  // categories actually appear, not a hardcoded Jute/Cotton/Tufted list —
  // those were just what happened to be in the one example file).
  const byCategory = new Map<string, { sale: number; shipping: number }>();
  for (const r of rows) {
    const cur = byCategory.get(r.category) ?? { sale: 0, shipping: 0 };
    cur.sale += r.orgSale;
    cur.shipping += r.grossShipping;
    byCategory.set(r.category, cur);
  }
  // "Difference Amt" is the courier bill's own manual reconciliation
  // figure (our estimate vs what they actually billed) — see schema.sql's
  // comment on this column ("original author explicitly could NOT
  // reverse-engineer a formula for it"). Courier's actual charge = our
  // gross shipping + that difference.
  const ourShippingCharge = rows.reduce((s, r) => s + r.grossShipping, 0);
  const courierShippingCharge = rows.reduce((s, r) => s + r.grossShipping + (r.differenceAmt ?? 0), 0);
  const difference = courierShippingCharge - ourShippingCharge;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/dashboard/documents" className="text-sm text-slate-500 hover:underline">← Back to Document Entry</Link>
        <PrintButton label="🖨 Download PDF" />
      </div>

      <PrintArea id="freight-report-area">
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-xs print:border-0 print:p-0">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-slate-900">Courier Bill Report</h1>
              <p className="text-slate-500">Invoice {bill.invoice_no} · {bill.invoice_date ?? "—"}</p>
            </div>
            <div className="text-right text-slate-600">
              <p>Freight ₹{bill.freight_amt} + Fuel ₹{bill.fuel_amt} + Other ₹{bill.other_charges}</p>
              <p className="font-semibold text-slate-900">Gross Total ₹{bill.gross_total_amt ?? bill.total_amt ?? 0}</p>
              {bill.credit_note_amt > 0 && <p className="text-purple-700">CN {bill.credit_note_no} · −₹{bill.credit_note_amt}</p>}
            </div>
          </div>

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300 text-[10px] uppercase text-slate-500">
                <th className="py-1 pr-2">Sr.</th>
                <th className="py-1 pr-2">PO No.</th>
                <th className="py-1 pr-2">Type</th>
                <th className="py-1 pr-2">Size</th>
                <th className="py-1 pr-2">AWB</th>
                <th className="py-1 pr-2">Buyer Country</th>
                <th className="py-1 pr-2 text-right">Sale Amt (INR)</th>
                <th className="py-1 pr-2 text-right">Our Shipping</th>
                <th className="py-1 pr-2 text-right">Other</th>
                <th className="py-1 pr-2 text-right">GST 18%</th>
                <th className="py-1 pr-2 text-right">Gross Shipping</th>
                <th className="py-1 pr-2 text-right">Our Wt.</th>
                <th className="py-1 pr-2 text-right">Bill Wt.</th>
                <th className="py-1 pr-2 text-right">Dim. Wt.</th>
                <th className="py-1 pr-2 text-right">Diff Amt</th>
                <th className="py-1 pr-2 text-right">Shipping %</th>
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
                  <td className="py-1 pr-2 text-right">{r.ourShipping.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right">{r.otherCharges.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right">{r.gst.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right font-medium">{r.grossShipping.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right">{r.ourWeight ?? "—"}</td>
                  <td className="py-1 pr-2 text-right">{r.billWeight ?? "—"}</td>
                  <td className="py-1 pr-2 text-right">{r.dimWeight ?? "—"}</td>
                  <td className="py-1 pr-2 text-right">{r.differenceAmt ?? "—"}</td>
                  <td className="py-1 pr-2 text-right">{r.shippingPct != null ? `${r.shippingPct.toFixed(1)}%` : "—"}</td>
                  <td className="py-1 pr-2 text-slate-500">{r.remark || "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={17} className="py-3 text-center text-slate-400">No AWBs assigned to this bill yet.</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="mt-4 grid grid-cols-2 gap-6 border-t border-slate-300 pt-3">
            <div>
              <p className="mb-1 font-semibold text-slate-700">By Category</p>
              {Array.from(byCategory.entries()).map(([cat, v]) => (
                <p key={cat} className="text-slate-600">
                  {cat}: Sale ₹{v.sale.toFixed(2)} · Shipping ₹{v.shipping.toFixed(2)}
                </p>
              ))}
            </div>
            <div className="text-right">
              <p className="text-slate-600">OUR SHIPPING CHARGE: ₹{ourShippingCharge.toFixed(2)}</p>
              <p className="text-slate-600">COURIER SHIPPING CHARGE: ₹{courierShippingCharge.toFixed(2)}</p>
              <p className="font-semibold text-slate-900">DIFFERENCE: ₹{difference.toFixed(2)}</p>
            </div>
          </div>
        </div>
      </PrintArea>
    </div>
  );
}
