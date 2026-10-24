// 2026-10-22 — "ESI HI SHEET PURCHASE BILLS KI SHEET BANNI CHAHIYE OR LINK
// HONI CHAHIYE": Courier/Duty bills already had their own A4 report page, so
// Bill Payment's invoice number could not show a REAL purchase-bill sheet —
// Purchase Bills only had the field-list preview in Document Entry. This page
// is that sheet, in the same shape as freight-bills/[id]/report: bill header,
// one row per item (PO ref / item / size / qty / rate / amount / GST / total),
// and the invoice totals underneath.
//
// The row addressed here is ONE purchase_bills row, but a vendor invoice can
// legitimately cover several items/POs (several rows sharing
// vendor_party_id + vendor_invoice_no — see src/lib/bill-grouping.ts, and the
// UNIQUE (vendor_party_id, vendor_invoice_no, order_id) key in schema.sql).
// So the whole invoice is resolved from whichever row's id was opened, exactly
// like loadBillStatement does for the grouped statement — otherwise a
// multi-item invoice would print just its first item.
//
// GST per line follows the same rule the statement uses: gst_rate_pct is the
// CGST/SGST INDIVIDUAL rate (total = ×2) or the full rate for IGST; 0 means
// "No GST" (2026-10-20 migration), NULL keeps the historical flat-5%
// fallback so an old bill's lines still tie out to its stored invoice total.
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";
import { loadOrderShippingFigures } from "@/lib/orders/shipping-figures";
import { purchaseAreaSqFt } from "@/lib/length-units";

const money = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dash = (v: string | number | null | undefined) => (v == null || v === "" ? "—" : String(v));

export default async function PurchaseBillReportPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    return await PurchaseBillReportInner(await params);
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

async function PurchaseBillReportInner({ id }: { id: string }) {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: billRaw } = await supabase
    .from("purchase_bills")
    .select(
      "id, vendor_party_id, vendor_invoice_no, vendor_invoice_date, qty, sq_feet, qty_unit, unit_rate, work_description, order_id, company_id, gst_rate_pct, gst_type, round_off_amt, size_mode, created_at"
    )
    .eq("id", id)
    .maybeSingle();
  if (!billRaw) notFound();

  // Whole invoice: every item/PO row sharing this vendor + vendor invoice no.
  const { data: rowsRaw } = await supabase
    .from("purchase_bills")
    .select("id, order_id, qty, sq_feet, qty_unit, unit_rate, work_description, gst_rate_pct, gst_type, round_off_amt, size_mode, created_at")
    .eq("vendor_party_id", billRaw.vendor_party_id)
    .eq("vendor_invoice_no", billRaw.vendor_invoice_no)
    .order("created_at", { ascending: true });
  const rows = rowsRaw ?? [];

  const orderIds = Array.from(new Set(rows.map((r) => r.order_id).filter((v): v is string => !!v)));
  const [{ data: party }, { data: orders }, { data: company }, { data: profile }] = await Promise.all([
    supabase
      .from("parties")
      .select("id, name, address, contact_no, email, gst")
      .eq("id", billRaw.vendor_party_id)
      .maybeSingle(),
    orderIds.length ? supabase.from("orders").select("id, ref_no, size_label").in("id", orderIds) : Promise.resolve({ data: [] }),
    billRaw.company_id ? supabase.from("companies").select("id, name, logo_url").eq("id", billRaw.company_id).maybeSingle() : Promise.resolve({ data: null }),
    billRaw.company_id
      ? supabase
          .from("company_profiles")
          .select("address, phone, whatsapp, email, gstin")
          .eq("company_id", billRaw.company_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const orderRef = new Map((orders ?? []).map((o) => [o.id, o.ref_no] as const));
  const orderSize = new Map((orders ?? []).map((o) => [o.id, o.size_label] as const));

  // 2026-10-24 — "PURCHASE BILL SHEET JO GENRATE HO RAHI HAI, USME KUCH DATA OR
  // CHAHIYE JAISE FREIGHT SHEET ME AATA HAI: SHIPPING CHARGES, SHIPPING
  // CHARGES COURIER, ORDER VALUE, PURCHASE %". All four are LIVE reads of the
  // order and its courier bill (src/lib/orders/shipping-figures.ts) — nothing
  // is copied onto purchase_bills, so correcting an order's value/country or
  // a courier bill's charges is reflected the very next time this sheet is
  // opened.
  const figures = await loadOrderShippingFigures(supabase, orderIds);

  const lines = rows.map((r, i) => {
    const qty = Number(r.qty);
    const size = Number(r.sq_feet ?? 0);
    const rate = Number(r.unit_rate);
    // Same formula as the schema's generated total_amount column.
    const amount = qty * size * rate;
    const storedRate = r.gst_rate_pct != null ? Number(r.gst_rate_pct) : null;
    const totalRatePct = storedRate != null ? (r.gst_type === "IGST" ? storedRate : storedRate * 2) : 5;
    const gstAmount = Math.round(amount * totalRatePct) / 100;
    const fig = r.order_id ? figures.get(r.order_id) : undefined;
    const orderValue = fig?.orderValueInr ?? 0;
    return {
      sr: i + 1,
      id: r.id,
      orderId: r.order_id,
      refNo: r.order_id ? orderRef.get(r.order_id) ?? "—" : "—",
      orderSize: r.order_id ? orderSize.get(r.order_id) ?? null : null,
      description: r.work_description,
      qty,
      unit: r.qty_unit,
      // Raw value as billed, in the bill's own unit — this is what the amount
      // formula below must keep using (qty × this × rate, rate being per that
      // same unit). `sizeSqFt` is the same area normalised to square feet for
      // DISPLAY only.
      size,
      // 2026-10-24b — 'as_billed' means the vendor billed a LENGTH in that
      // unit, so squaring it would be meaningless; the sheet then prints the
      // figure exactly as entered instead of a Sq Ft conversion.
      asBilled: (r.size_mode ?? "area") === "as_billed",
      sizeSqFt: purchaseAreaSqFt(size, r.qty_unit),
      sizeUnit: r.qty_unit ?? "FT",
      rate,
      amount,
      gstRatePct: storedRate,
      gstType: r.gst_type,
      gstAmount,
      lineTotal: amount + gstAmount,
      orderValue,
      ourShipping: fig?.ourShippingInr ?? null,
      courierShipping: fig?.courierGrossInr ?? null,
      courierBillSourced: fig?.courierBillSourced ?? false,
      // Purchase % = this line's pre-GST purchase cost as a share of the
      // order's own value (GST is recoverable input credit, so it is not
      // part of what the purchase actually costs us).
      purchasePct: orderValue > 0 ? (amount / orderValue) * 100 : null,
    };
  });
  const subtotal = lines.reduce((s, l) => s + l.amount, 0);
  const gstTotal = lines.reduce((s, l) => s + l.gstAmount, 0);
  const roundOff = rows.reduce((s, r) => s + Number(r.round_off_amt ?? 0), 0);
  const grossTotal = subtotal + gstTotal + roundOff;
  const isGst = gstTotal > 0;

  // 2026-10-24 — "YE JO MENE MARK KIYA SS ME VO TO SQ FT ME AAYEGA NA TO SIZE
  // KYA LIKHA HAI": the old "Size" header was wrong. The values there are
  // purchase_bills.sq_feet — the billed AREA in the bill's own qty_unit (FT →
  // sq ft, MTR → sq m, INCH → sq in…), which is why the screenshot shows
  // 60.00 / 9.00 / 48.00 for rows whose actual 3X20 FT / 3X3 FT size is
  // already printed in the separate "Type / Size" column. Reading it as a
  // length made 60.00 look like 60 ft instead of 60 sq ft.
  //
  // 2026-10-24 (2) — "CHAHE SIZE INCH ME HO YA CM ME JO AREA HAI VO SQ FT ME
  // NIKAL KE AAYE": rather than relabelling per unit (Sq Mtr / Sq In / Sq Cm),
  // every row is now converted to Sq Ft for display (purchaseAreaSqFt), with
  // the value as entered shown underneath in small grey text whenever the
  // bill's unit isn't FT — so the figure can still be tied back to the
  // vendor's own bill and the Rate column's unit stays unambiguous.
  const SQ_UNIT_WORD: Record<string, string> = { FT: "ft", MTR: "mtr", INCH: "in", YARD: "yd", CM: "cm" };
  // 2026-10-24b — the column can hold two different things now: a Sq Ft area
  // (default) or a linear length billed as-is. Name it after what is actually
  // on THIS invoice.
  const anyAsBilled = lines.some((l) => l.asBilled);
  const anyArea = lines.some((l) => !l.asBilled);
  const sizeColumnLabel = anyAsBilled && anyArea ? "Sq Ft / As billed" : anyAsBilled ? "As billed" : "Sq Ft";

  // Order-level totals are summed ONCE PER ORDER, not once per purchase line:
  // one vendor invoice commonly covers several lines for the same PO, and
  // adding that PO's order value/shipping once per line would multiply it.
  let totalOrderValue = 0;
  let totalOurShipping = 0;
  let totalCourierShipping = 0;
  const countedOrders = new Set<string>();
  for (const l of lines) {
    if (!l.orderId || countedOrders.has(l.orderId)) continue;
    countedOrders.add(l.orderId);
    totalOrderValue += l.orderValue;
    totalOurShipping += l.ourShipping ?? 0;
    totalCourierShipping += l.courierShipping ?? 0;
  }
  const overallPurchasePct = totalOrderValue > 0 ? (subtotal / totalOrderValue) * 100 : null;

  // Inside the A4 preview dialog this page is embedded with ?embed=1
  // (src/components/print-dialog.tsx) → x-embed; the dialog supplies its own
  // Print/Close footer, so the page's own Back/Download bar is dropped there.
  const embedded = (await headers()).get("x-embed") === "1";

  return (
    <div>
      {!embedded && (
        <div className="mb-4 flex items-center justify-between print:hidden">
          <Link href="/dashboard/documents" className="text-sm text-slate-500 hover:underline">
            ← Back to Document Entry
          </Link>
          <PrintButton label="🖨 Download PDF" />
        </div>
      )}

      <PrintArea id="purchase-bill-report-area" companyName={company?.name ?? undefined} companyLogoUrl={company?.logo_url}>
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-xs text-slate-900 print:border-0 print:p-0">
          <div className="mb-4 flex items-start justify-between gap-6 border-b-2 border-slate-800 pb-3">
            <div className="flex items-start gap-3">
              {company?.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element -- print document; a plain <img> keeps the logo out of next/image's optimizer
                <img src={company.logo_url} alt={company.name ?? ""} className="h-10 w-10 object-contain" />
              )}
              <div>
                <h1 className="text-lg font-bold text-slate-900">Purchase Bill</h1>
                <p className="text-slate-500">
                  Invoice {billRaw.vendor_invoice_no || "—"} · {billRaw.vendor_invoice_date ?? "—"}
                </p>
                {company?.name && <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{company.name}</p>}
                {profile?.gstin && <p className="text-[11px] text-slate-500">GSTIN: {profile.gstin}</p>}
              </div>
            </div>
            <div className="text-right text-slate-600">
              <p className="font-semibold text-slate-900">{party?.name ?? "—"}</p>
              {party?.address && <p className="max-w-[15rem] whitespace-pre-wrap text-[11px]">{party.address}</p>}
              {party?.contact_no && <p className="text-[11px]">Phone: {party.contact_no}</p>}
              {party?.gst && <p className="text-[11px]">GST: {party.gst}</p>}
            </div>
          </div>

          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-300 text-[10px] uppercase text-slate-500">
                <th className="py-1 pr-2">Sr.</th>
                <th className="py-1 pr-2">PO No.</th>
                <th className="py-1 pr-2">Item / Work</th>
                <th className="py-1 pr-2">Type / Size</th>
                <th className="py-1 pr-2 text-right">Qty</th>
                <th className="py-1 pr-2">Unit</th>
                <th className="py-1 pr-2 text-right">{sizeColumnLabel}</th>
                <th className="py-1 pr-2 text-right">Rate</th>
                <th className="py-1 pr-2 text-right">Amount</th>
                <th className="py-1 pr-2 text-right">GST</th>
                <th className="py-1 pr-2 text-right">Total</th>
                <th className="py-1 pr-2 text-right">Order Value</th>
                <th className="py-1 pr-2 text-right">Shipping</th>
                <th className="py-1 pr-2 text-right">Courier</th>
                <th className="py-1 pr-2 text-right">Purchase %</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((r) => (
                <tr key={r.id} className="border-b border-slate-100 text-slate-700">
                  <td className="py-1 pr-2">{r.sr}</td>
                  <td className="py-1 pr-2 font-medium text-slate-900">{r.refNo}</td>
                  <td className="py-1 pr-2">{dash(r.description)}</td>
                  <td className="py-1 pr-2">{r.orderSize ?? "—"}</td>
                  <td className="py-1 pr-2 text-right">{r.qty}</td>
                  <td className="py-1 pr-2">{r.unit}</td>
                  <td className="py-1 pr-2 text-right">
                    {r.asBilled ? (
                      `${money(r.size)} ${SQ_UNIT_WORD[r.sizeUnit] ?? r.sizeUnit}`
                    ) : r.sizeSqFt != null ? (
                      money(r.sizeSqFt)
                    ) : (
                      "—"
                    )}
                    {!r.asBilled && r.sizeSqFt != null && r.sizeUnit !== "FT" && (
                      <div className="text-[9px] font-normal text-slate-400">
                        ({money(r.size)} sq {SQ_UNIT_WORD[r.sizeUnit] ?? r.sizeUnit})
                      </div>
                    )}
                  </td>
                  <td className="py-1 pr-2 text-right">{money(r.rate)}</td>
                  <td className="py-1 pr-2 text-right">{money(r.amount)}</td>
                  <td className="py-1 pr-2 text-right">
                    {r.gstRatePct === 0 ? "No GST" : money(r.gstAmount)}
                    {r.gstRatePct !== 0 && r.gstRatePct != null && (
                      <span className="text-[9px] text-slate-400">
                        {" "}
                        ({r.gstType === "IGST" ? r.gstRatePct : r.gstRatePct * 2}%)
                      </span>
                    )}
                  </td>
                  <td className="py-1 pr-2 text-right font-semibold">{money(r.lineTotal)}</td>
                  <td className="py-1 pr-2 text-right">{r.orderValue > 0 ? money(r.orderValue) : "—"}</td>
                  <td className="py-1 pr-2 text-right text-slate-500">{r.ourShipping != null ? money(r.ourShipping) : "—"}</td>
                  <td className={`py-1 pr-2 text-right ${r.courierBillSourced ? "text-slate-900" : "text-slate-400"}`}>
                    {r.courierShipping != null ? money(r.courierShipping) : "—"}
                  </td>
                  <td className="py-1 pr-2 text-right font-medium">{r.purchasePct != null ? `${r.purchasePct.toFixed(1)}%` : "—"}</td>
                </tr>
              ))}
              {lines.length === 0 && (
                <tr>
                  <td colSpan={15} className="py-3 text-center text-slate-400">
                    No items on this invoice.
                  </td>
                </tr>
              )}
              {lines.length > 0 && (
                <tr className="border-t-2 border-slate-400 font-bold text-slate-900">
                  <td colSpan={8} className="py-1 pr-2 text-right">
                    TOTAL
                  </td>
                  <td className="py-1 pr-2 text-right">{money(subtotal)}</td>
                  <td className="py-1 pr-2 text-right">{isGst ? money(gstTotal) : "—"}</td>
                  <td className="py-1 pr-2 text-right">{money(subtotal + gstTotal)}</td>
                  <td className="py-1 pr-2 text-right">{totalOrderValue > 0 ? money(totalOrderValue) : "—"}</td>
                  <td className="py-1 pr-2 text-right">{money(totalOurShipping)}</td>
                  <td className="py-1 pr-2 text-right">{money(totalCourierShipping)}</td>
                  <td className="py-1 pr-2 text-right">{overallPurchasePct != null ? `${overallPurchasePct.toFixed(1)}%` : "—"}</td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="mt-4 grid grid-cols-2 gap-6 border-t border-slate-300 pt-3">
            <div className="text-[11px] text-slate-600">
              <p className="mb-1 font-semibold text-slate-700">Invoice Summary</p>
              <p>
                {lines.length} item{lines.length === 1 ? "" : "s"} · {rows.length} entr{rows.length === 1 ? "y" : "ies"}
                {orderIds.length > 0 && ` · ${orderIds.length} PO`}
              </p>
              {billRaw.company_id == null && <p className="text-amber-700">⚠ No company linked on this bill</p>}
              {party?.email && <p>Email: {party.email}</p>}
            </div>
            <div className="text-right">
              <p className="text-slate-600">SUBTOTAL (pre-GST): ₹{money(subtotal)}</p>
              <p className="text-slate-600">GST: ₹{money(gstTotal)}</p>
              <p className="text-slate-600">ROUND OFF: ₹{money(roundOff)}</p>
              <p className="mt-1 text-sm font-bold text-slate-900">GROSS TOTAL: ₹{money(grossTotal)}</p>
              {countedOrders.size > 0 && (
                <div className="mt-2 border-t border-slate-200 pt-2">
                  <p className="text-slate-600">ORDER VALUE: ₹{money(totalOrderValue)}</p>
                  <p className="text-slate-600">OUR SHIPPING CHARGE: ₹{money(totalOurShipping)}</p>
                  <p className="text-slate-600">COURIER SHIPPING CHARGE (incl. GST): ₹{money(totalCourierShipping)}</p>
                  <p className="font-semibold text-slate-900">
                    PURCHASE % (of order value): {overallPurchasePct != null ? `${overallPurchasePct.toFixed(1)}%` : "—"}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </PrintArea>
    </div>
  );
}
