import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";

// 2026-10-17 — a Purchase Bill had no printable view of its own unless it had
// already been mirrored into the Bill Pass Register (the statement sheet is
// keyed by that register id). A raw-material bill — the first stage of the
// cotton-rug chain, entered without a PO — may never be sent to Finance at
// all, so it had no print path. This is its own A4 bill: vendor block,
// invoice no/date, the qty × area × rate line, GST and the payable total.
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
      "id, vendor_party_id, vendor_invoice_no, vendor_invoice_date, qty, sq_feet, qty_unit, work_description, unit_rate, order_id, company_id, gst_rate_pct, gst_type, round_off_amt, total_sq_feet, total_amount, g_total_plus_gst"
    )
    .eq("id", id)
    .maybeSingle();
  if (!billRaw) notFound();

  const [{ data: company }, { data: profile }, { data: party }, { data: order }] = await Promise.all([
    billRaw.company_id
      ? supabase.from("companies").select("id, name, logo_url").eq("id", billRaw.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
    billRaw.company_id
      ? supabase.from("company_profiles").select("address, phone, email").eq("company_id", billRaw.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from("parties").select("name, address, gst, contact_no").eq("id", billRaw.vendor_party_id).maybeSingle(),
    billRaw.order_id ? supabase.from("orders").select("ref_no").eq("id", billRaw.order_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const money = (n: number | null | undefined) =>
    n == null ? "—" : Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const total = Number(billRaw.total_amount) || 0;
  const gstPct = billRaw.gst_rate_pct != null ? billRaw.gst_rate_pct * 2 : 5;
  const grand = billRaw.g_total_plus_gst != null ? Number(billRaw.g_total_plus_gst) : total;
  const gstAmount = grand - total - Number(billRaw.round_off_amt ?? 0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/dashboard/documents?tab=purchase-bill" className="text-sm text-slate-500 hover:underline">
          ← Back to Document Entry
        </Link>
        <PrintButton label="🖨 Print / Download PDF" />
      </div>

      <PrintArea id="purchase-bill-report-area" companyName={company?.name} companyLogoUrl={company?.logo_url}>
        <div
          className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-900 shadow-sm print:border-0 print:p-0"
          style={{ fontFamily: "Georgia, serif" }}
        >
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-300 pb-3">
            <div className="flex items-center gap-3">
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
            <div className="text-right">
              <div className="text-base font-bold tracking-wide">PURCHASE BILL</div>
              <div className="text-xs">Bill No.: {billRaw.vendor_invoice_no}</div>
              <div className="text-xs">Date: {billRaw.vendor_invoice_date ?? "—"}</div>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-4 text-xs">
            <div>
              <div className="font-semibold text-slate-500">VENDOR</div>
              <div className="font-bold">{party?.name ?? "—"}</div>
              {party?.address && <div className="whitespace-pre-wrap text-slate-600">{party.address}</div>}
              {party?.contact_no && <div>Phone: {party.contact_no}</div>}
              {party?.gst && <div>GST: {party.gst}</div>}
            </div>
            <div className="space-y-0.5">
              <div>
                <span className="text-slate-500">PO / Order Ref: </span>
                {order?.ref_no ?? "— (no PO)"}
              </div>
              <div>
                <span className="text-slate-500">Work: </span>
                {billRaw.work_description ?? "—"}
              </div>
              <div>
                <span className="text-slate-500">GST: </span>
                {gstPct}% {billRaw.gst_type === "IGST" ? "(IGST)" : "(CGST+SGST)"}
              </div>
            </div>
          </div>

          <table className="mb-4 w-full border-collapse text-xs">
            <thead>
              <tr className="border-y border-slate-300 bg-slate-50 print:bg-transparent">
                <th className="px-2 py-1.5 text-left">S.No.</th>
                <th className="px-2 py-1.5 text-left">Description</th>
                <th className="px-2 py-1.5 text-right">Qty</th>
                <th className="px-2 py-1.5 text-left">Unit</th>
                <th className="px-2 py-1.5 text-right">Area/Unit</th>
                <th className="px-2 py-1.5 text-right">Rate</th>
                <th className="px-2 py-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-200">
                <td className="px-2 py-1.5">1</td>
                <td className="px-2 py-1.5">{billRaw.work_description ?? "Purchase"}</td>
                <td className="px-2 py-1.5 text-right">{billRaw.qty}</td>
                <td className="px-2 py-1.5">{billRaw.qty_unit}</td>
                <td className="px-2 py-1.5 text-right">{money(Number(billRaw.sq_feet))}</td>
                <td className="px-2 py-1.5 text-right">{money(Number(billRaw.unit_rate))}</td>
                <td className="px-2 py-1.5 text-right">{money(total)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-300">
                <td className="px-2 py-1.5" colSpan={6}>
                  Total ({money(Number(billRaw.total_sq_feet))} total qty)
                </td>
                <td className="px-2 py-1.5 text-right">{money(total)}</td>
              </tr>
              <tr>
                <td className="px-2 py-1.5" colSpan={6}>
                  GST @ {gstPct}%
                </td>
                <td className="px-2 py-1.5 text-right">{money(gstAmount)}</td>
              </tr>
              {Number(billRaw.round_off_amt ?? 0) !== 0 && (
                <tr>
                  <td className="px-2 py-1.5" colSpan={6}>
                    Round Off
                  </td>
                  <td className="px-2 py-1.5 text-right">{money(Number(billRaw.round_off_amt))}</td>
                </tr>
              )}
              <tr className="border-t border-slate-300 font-bold">
                <td className="px-2 py-1.5" colSpan={6}>
                  Total Payable
                </td>
                <td className="px-2 py-1.5 text-right">₹{money(grand)}</td>
              </tr>
            </tfoot>
          </table>

          <div className="mt-10 grid grid-cols-3 gap-4 text-[11px] text-slate-600">
            <div className="border-t border-slate-400 pt-1">Prepared by</div>
            <div className="border-t border-slate-400 pt-1">Checked by</div>
            <div className="border-t border-slate-400 pt-1">Authorised Sign</div>
          </div>
        </div>
      </PrintArea>
    </div>
  );
}
