// 2026-09-21 — Courier Bill Report rewrite ("ab us sheet ko sahi optimise
// karo... charge sahi uth kar aane chahiye"):
//
//   AWB          — order_shipments.awb_no (the real per-AWB number), NOT the
//                  stale order-level dispatch_invoices summary; fallback to
//                  the summary only for legacy rows.
//   Sale Amt     — orders.order_value_inr (unchanged).
//   Our Shipping — dispatch estimate: our_freight_amt + demand surcharge.
//   Our GST      — dispatch estimate's gst_18pct.
//   Bill Charges — what the COURIER actually billed this AWB, straight off
//                  the bill: Base / Fuel / Remote / Other → Total Shipping
//                  Amt (pre-GST), then GST, then Gross Shipping =
//                  Total + GST ("total shipping amt + 18 gst = gross
//                  shipping ammount... ye courier ke bill se aayega").
//                  Falls back to the dispatch estimate only when nothing
//                  was captured for that AWB (legacy rows).
//   Our Wt.      — booked package weight on this shipment.
//   Bill Wt.     — what the courier billed (assignment bill_weight_kg).
//   Dim. Wt.     — volumetric (L×W×H/5000): manual entry first, else the
//                  booked order_packages.volumetric_weight.
//   Diff Amt     — Over Shipping − Courier Shipping (per-AWB difference
//                  between our estimate and their bill).
//   Shipping %   — Gross Shipping ÷ order sale value × 100.
//   By Category  — per item category: sale, shipping, and the category's
//                  shipping % ("cotton ki sale itni hai shipping itni hai
//                  or shipping ka % itna hai").
//   Payables     — courier's bill total + GST vs what we'd estimated —
//                  "courier ka bill kitne ka hai or gst kitna laga hai or
//                  apne ko pay kitna karna hai".
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";

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
    // 2026-09-21: billed_base_amt/billed_fuel_amt/billed_remote_amt/
    // billed_other_amt/billed_gst_amt — the per-AWB charge breakup straight
    // off the courier bill (db/2026-09-21-freight-awb-billed-charge-
    // breakup.sql), so Total Shipping / GST / Gross are REAL bill figures.
    .select(
      "id, order_id, order_shipment_id, bill_weight_kg, dimensional_weight_kg, difference_amt, billed_freight_amt, billed_base_amt, billed_fuel_amt, billed_remote_amt, billed_other_amt, billed_gst_amt, credit_note_no, credit_note_amt, debit_note_no, debit_note_amt, remark"
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
  //
  // 2026-09-21: order_packages now also yields volumetric_weight so Dim.
  // Wt. fills from what was booked (L×W×H/5000) when the bill entry didn't
  // override it manually.
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
    shipmentIds.length
      ? supabase.from("order_shipments").select("id, awb_no, booked_freight_amt, booked_currency, booked_amount_source").in("id", shipmentIds)
      : Promise.resolve({ data: [] }),
    shipmentIds.length
      ? supabase.from("order_packages").select("order_shipment_id, weight_kg, volumetric_weight").in("order_shipment_id", shipmentIds)
      : Promise.resolve({ data: [] }),
  ]);

  const orderById = new Map((orders ?? []).map((o) => [o.id, o]));
  const dispatchByOrder = new Map((dispatches ?? []).map((d) => [d.order_id, d]));
  const shipmentById = new Map((shipments ?? []).map((s) => [s.id, s]));
  const weightByShipment = new Map<string, number>();
  const volByShipment = new Map<string, number>();
  for (const p of packages ?? []) {
    if (p.weight_kg != null) weightByShipment.set(p.order_shipment_id, (weightByShipment.get(p.order_shipment_id) ?? 0) + Number(p.weight_kg));
    if (p.volumetric_weight != null) volByShipment.set(p.order_shipment_id, (volByShipment.get(p.order_shipment_id) ?? 0) + Number(p.volumetric_weight));
  }

  const rowsBase = (assignments ?? []).map((a, i) => {
    const order = orderById.get(a.order_id);
    const dispatch = dispatchByOrder.get(a.order_id);
    const shipment = shipmentById.get(a.order_shipment_id);
    const category = order?.item_categories as unknown as { name: string } | { name: string }[] | null;
    const categoryName = Array.isArray(category) ? category[0]?.name ?? "—" : category?.name ?? "—";
    const orgSale = Number(order?.order_value_inr ?? 0);

    // OUR side — the dispatch-time estimate.
    // 2026-09-22 fix: our_freight_amt (ourBase) is ALREADY the fully-loaded
    // estimate total — Base Rate + Discount + Fuel + Demand Surcharge/Other
    // Charges + GST 18% (confirmed against the user's own manual
    // reconciliation of PO-A570). Adding demand_surcharge_other_charge again
    // here double-counted it — reported live: "dekho other charges ko 2 baar
    // count kar rhe ho", screenshot showing 36,830.70 (= 33,007.20 +
    // 3,823.50) instead of the correct 33,007.20. The pre-GST our-side
    // subtotal — comparable to the bill-side totalShipping, which is also
    // pre-GST — is our_freight_amt minus its own baked-in GST.
    const ourBase = Number(dispatch?.our_freight_amt ?? 0);
    const ourGst = Number(dispatch?.gst_18pct ?? 0);
    const ourShipping = ourBase - ourGst;

    // BILL side — what the courier actually charged this AWB. Total
    // pre-GST = billed_freight_amt when captured, else the sum of its
    // captured components, else fall back to the dispatch estimate so
    // legacy rows still show sane numbers.
    const breakupSum =
      (a.billed_base_amt != null ? Number(a.billed_base_amt) : 0) +
      (a.billed_fuel_amt != null ? Number(a.billed_fuel_amt) : 0) +
      (a.billed_remote_amt != null ? Number(a.billed_remote_amt) : 0) +
      (a.billed_other_amt != null ? Number(a.billed_other_amt) : 0);
    const anyBreakup = breakupSum > 0;
    const billTotal = a.billed_freight_amt != null ? Number(a.billed_freight_amt) : anyBreakup ? breakupSum : null;
    const billGst = a.billed_gst_amt != null ? Number(a.billed_gst_amt) : null;
    const hasBillFigures = billTotal != null || billGst != null;
    const totalShipping = billTotal ?? ourShipping;
    const gst = billGst ?? ourGst;
    const grossShipping = totalShipping + gst;

    // Diff Amt = Over Shipping − Courier Shipping, per AWB (the manual
    // override stays authoritative when entered).
    const diffAmt = a.difference_amt != null ? Number(a.difference_amt) : hasBillFigures ? ourShipping - totalShipping : null;

    return {
      sr: i + 1,
      refNo: order?.ref_no ?? "—",
      category: categoryName,
      size: order?.size_label ?? "—",
      // 2026-09-21: the shipment's own AWB — the dispatch summary is
      // order-level and goes stale once an order has multiple AWBs.
      awb: shipment?.awb_no ?? "—",
      buyerCountry: dispatch?.buyer_country ?? "—",
      orgSale,
      ourShipping,
      ourGst,
      billBase: a.billed_base_amt != null ? Number(a.billed_base_amt) : null,
      billFuel: a.billed_fuel_amt != null ? Number(a.billed_fuel_amt) : null,
      billRemote: a.billed_remote_amt != null ? Number(a.billed_remote_amt) : null,
      billOther: a.billed_other_amt != null ? Number(a.billed_other_amt) : null,
      totalShipping,
      gst,
      grossShipping,
      billSourced: hasBillFigures,
      ourWeight: weightByShipment.has(a.order_shipment_id) ? weightByShipment.get(a.order_shipment_id)! : null,
      billWeight: a.bill_weight_kg != null ? Number(a.bill_weight_kg) : null,
      dimWeight:
        a.dimensional_weight_kg != null
          ? Number(a.dimensional_weight_kg)
          : volByShipment.has(a.order_shipment_id)
            ? volByShipment.get(a.order_shipment_id)!
            : null,
      differenceAmt: diffAmt,
      // 2026-09-01: non-blocking booking-cost-vs-billed-cost "recheck" note
      // — see db/2026-09-01-multi-courier-booking-and-freight-recon.sql.
      remark: [
        a.remark,
        a.credit_note_no ? `CN ${a.credit_note_no} -₹${a.credit_note_amt}` : null,
        a.debit_note_no ? `DN ${a.debit_note_no} +₹${a.debit_note_amt}` : null,
        shipment?.booked_freight_amt != null
          ? `Booked ${shipment.booked_currency} ${Number(shipment.booked_freight_amt).toFixed(2)}${
              shipment.booked_amount_source === "rate_card_estimate" ? " (est.)" : shipment.booked_amount_source === "manual" ? " (manual)" : ""
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

  // Shipping % — 2026-09-22 fix, per user spec: "jo persent niklega dono
  // order ki value ko jod ke phir niklega" (the percent should be worked
  // out off the combined value of both/all orders, then computed). Split
  // shipments (PO-A560-1/3, -2/3, -3/3 style series) go out on one physical
  // AWB but each split order has its OWN order_shipments row — there's no
  // schema-level shared-shipment relationship (order_shipments.order_id is
  // NOT NULL), so the only way to find "the same shipment" is to match the
  // plain-text awb_no. Group rows sharing a real AWB and use their COMBINED
  // sale value as the % denominator instead of each split order's own
  // individual sale value; rows with no AWB on file ("—") fall back to
  // their own sale value.
  const saleByAwb = new Map<string, number>();
  for (const r of rowsBase) {
    if (r.awb === "—") continue;
    saleByAwb.set(r.awb, (saleByAwb.get(r.awb) ?? 0) + r.orgSale);
  }
  const rows = rowsBase.map((r) => {
    const denom = r.awb !== "—" ? saleByAwb.get(r.awb)! : r.orgSale;
    const shippingPct = denom > 0 ? (r.grossShipping / denom) * 100 : null;
    return { ...r, shippingPct };
  });

  // Bottom summary — per item-category sale/shipping breakdown (whatever
  // categories actually appear, not a hardcoded Jute/Cotton/Tufted list —
  // those were just what happened to be in the one example file).
  // 2026-09-21: each category also shows its own SHIPPING % — "cotton ki
  // sale itni hai shipping itni hai or shipping ka % itna hai".
  const byCategory = new Map<string, { sale: number; shipping: number }>();
  for (const r of rows) {
    const cur = byCategory.get(r.category) ?? { sale: 0, shipping: 0 };
    cur.sale += r.orgSale;
    cur.shipping += r.grossShipping;
    byCategory.set(r.category, cur);
  }

  // Payables block — "courier ka bill kitne ka hai or gst kitna laga hai or
  // apne ko pay kitna karna hai": the bill's own header figures, and the
  // over/under vs our dispatch estimates summed across the assigned AWBs.
  const billPreTax = bill.total_amt ?? bill.freight_amt + bill.fuel_amt + bill.other_charges;
  const billGstHeader = bill.gst_18pct_amt ?? (billPreTax != null ? billPreTax * 0.18 : null);
  const billGross = bill.gross_total_amt ?? (billPreTax != null && billGstHeader != null ? billPreTax + billGstHeader : null);
  const cnNet = billGross != null ? billGross - bill.credit_note_amt : null;
  const ourShippingTotal = rows.reduce((s, r) => s + r.ourShipping, 0);
  const courierShippingTotal = rows.reduce((s, r) => s + r.totalShipping, 0);
  const difference = ourShippingTotal - courierShippingTotal;

  const fmt = (n: number | null | undefined) => (n == null ? "—" : n.toFixed(2));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/dashboard/documents" className="text-sm text-slate-500 hover:underline">← Back to Document Entry</Link>
        <PrintButton label="🖨 Download PDF" />
      </div>

      <PrintArea id="freight-report-area">
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-xs print:border-0 print:p-0">
          <div className="mb-4 flex items-start justify-between">
            <div>
              <h1 className="text-lg font-bold text-slate-900">Courier Bill Report</h1>
              <p className="text-slate-500">Invoice {bill.invoice_no} · {bill.invoice_date ?? "—"}</p>
            </div>
            {/* 2026-09-21: payables summary — bill total + GST + net payable
                after credit note, all off the bill's own header. */}
            <div className="text-right text-slate-600">
              <p>Bill: ₹{fmt(billPreTax)} + GST ₹{fmt(billGstHeader)}</p>
              <p className="font-semibold text-slate-900">Gross Total ₹{fmt(billGross)}</p>
              {bill.credit_note_amt > 0 && (
                <>
                  <p className="text-purple-700">CN {bill.credit_note_no} · −₹{bill.credit_note_amt}</p>
                  <p className="font-semibold text-purple-700">Net Payable ₹{fmt(cnNet)}</p>
                </>
              )}
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
                <th className="py-1 pr-2 text-right">Base</th>
                <th className="py-1 pr-2 text-right">Fuel</th>
                <th className="py-1 pr-2 text-right">Remote</th>
                <th className="py-1 pr-2 text-right">Other</th>
                <th className="py-1 pr-2 text-right">Total Shipping</th>
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
                  <td className="py-1 pr-2 font-mono">{r.awb}</td>
                  <td className="py-1 pr-2">{r.buyerCountry}</td>
                  <td className="py-1 pr-2 text-right">{r.orgSale.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right text-slate-500">{r.ourShipping.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right">{r.billBase != null ? r.billBase.toFixed(2) : "—"}</td>
                  <td className="py-1 pr-2 text-right">{r.billFuel != null ? r.billFuel.toFixed(2) : "—"}</td>
                  <td className="py-1 pr-2 text-right">{r.billRemote != null ? r.billRemote.toFixed(2) : "—"}</td>
                  <td className="py-1 pr-2 text-right">{r.billOther != null ? r.billOther.toFixed(2) : "—"}</td>
                  <td className="py-1 pr-2 text-right font-medium">{r.totalShipping.toFixed(2)}</td>
                  <td className={`py-1 pr-2 text-right ${r.billSourced ? "font-medium text-slate-900" : "text-slate-400"}`}>{r.gst.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right font-semibold">{r.grossShipping.toFixed(2)}</td>
                  <td className="py-1 pr-2 text-right">{r.ourWeight ?? "—"}</td>
                  <td className="py-1 pr-2 text-right">{r.billWeight ?? "—"}</td>
                  <td className="py-1 pr-2 text-right">{r.dimWeight ?? "—"}</td>
                  <td className={`py-1 pr-2 text-right ${r.differenceAmt != null && r.differenceAmt < 0 ? "text-red-700" : ""}`}>
                    {r.differenceAmt != null ? r.differenceAmt.toFixed(2) : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right">{r.shippingPct != null ? `${r.shippingPct.toFixed(1)}%` : "—"}</td>
                  <td className="py-1 pr-2 text-slate-500">{r.remark || "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={21} className="py-3 text-center text-slate-400">No AWBs assigned to this bill yet.</td>
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
                  {v.sale > 0 && ` · ${((v.shipping / v.sale) * 100).toFixed(1)}%`}
                </p>
              ))}
            </div>
            <div className="text-right">
              {/* 2026-09-21: OUR vs COURIER totals now compare the same
                  thing — our dispatch estimate vs the courier's actual
                  per-AWB charges (both pre-GST) — instead of the old
                  circular self-comparison. */}
              <p className="text-slate-600">OUR SHIPPING CHARGE: ₹{ourShippingTotal.toFixed(2)}</p>
              <p className="text-slate-600">COURIER SHIPPING CHARGE: ₹{courierShippingTotal.toFixed(2)}</p>
              <p className={`font-semibold ${difference < 0 ? "text-red-700" : "text-slate-900"}`}>
                DIFFERENCE (OVER − COURIER): ₹{difference.toFixed(2)}
              </p>
              {billGross != null && (
                <p className="mt-1 text-slate-600">TOTAL PAYABLE TO COURIER (incl. GST): ₹{cnNet ?? billGross}</p>
              )}
            </div>
          </div>
        </div>
      </PrintArea>
    </div>
  );
}
