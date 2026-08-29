import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";

// 2026-08-29 (evening, follow-up round) — Material OUT Chalan print/report
// page. Same outer try/catch + requireCapability shape as every other
// single-document report page (see debit-notes/[id]/report's header
// comment for the general pattern), gated on `stock_entry` (this doc type
// lives under /dashboard/stock, not /dashboard/documents) rather than
// `doc_entry`. Laid out to match the physical NYKO MART chalan pad the
// user shared: To / Through / No. of Packages / Date header block, a
// S.No./Particulars/Reference/Qty table, Total row, Prepared by/Passed
// by/Receiver's Sign. "Particulars" = SKU code + product name (this chalan
// has no free-text description field, unlike Received Chalan);
// "Reference" = any linked Order(s)' ref_no, since that's this app's
// closest equivalent to the pad's "Style" column for a raw-material line.
export default async function MaterialOutChalanReportPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    return await MaterialOutChalanReportInner(await params);
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

async function MaterialOutChalanReportInner({ id }: { id: string }) {
  await requireCapability("stock_entry");
  const supabase = createServiceRoleClient();

  const { data: chalan } = await supabase
    .from("material_out_chalans")
    .select("id, company_id, party_id, chalan_no, chalan_date, through, no_of_packages, remark")
    .eq("id", id)
    .maybeSingle();
  if (!chalan) notFound();

  const [{ data: company }, { data: profile }, { data: party }, { data: lines }] = await Promise.all([
    supabase.from("companies").select("id, name, logo_url").eq("id", chalan.company_id).single(),
    supabase.from("company_profiles").select("address, phone, email").eq("company_id", chalan.company_id).maybeSingle(),
    supabase.from("parties").select("name, address, gst, contact_no").eq("id", chalan.party_id).maybeSingle(),
    supabase.from("stock_out").select("id, sku_code, product_name, quantity_out, remark").eq("chalan_id", chalan.id).order("created_at"),
  ]);

  const lineIds = (lines ?? []).map((l) => l.id);
  const { data: orderLinks } = lineIds.length
    ? await supabase.from("stock_out_order_links").select("stock_out_id, orders(ref_no)").in("stock_out_id", lineIds)
    : { data: [] as { stock_out_id: string; orders: { ref_no: string } | null }[] };
  const refsByLine = new Map<string, string[]>();
  for (const l of orderLinks ?? []) {
    if (!l.orders) continue;
    const list = refsByLine.get(l.stock_out_id) ?? [];
    list.push(l.orders.ref_no);
    refsByLine.set(l.stock_out_id, list);
  }

  const totalQty = (lines ?? []).reduce((sum, l) => sum + Number(l.quantity_out), 0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/dashboard/stock?tab=material-out-chalan" className="text-sm text-slate-500 hover:underline">
          ← Back to Stock
        </Link>
        <PrintButton label="🖨 Download PDF" />
      </div>

      <PrintArea id="material-out-chalan-report-area">
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
            <div className="text-xl font-bold tracking-wide text-slate-800">DELIVERY CHALAN</div>
            <div className="text-xs text-slate-500">
              Chalan No.: <span className="font-semibold text-slate-800">{chalan.chalan_no ?? "—"}</span>
            </div>
            <div className="text-xs text-slate-500">Date: {chalan.chalan_date}</div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-6 text-xs">
            <div>
              <div className="mb-1 font-semibold text-slate-700">To</div>
              <div className="text-slate-900">{party?.name ?? "—"}</div>
              {party?.address && <div className="text-slate-500">{party.address}</div>}
              {party?.gst && <div className="text-slate-500">GSTIN: {party.gst}</div>}
              {party?.contact_no && <div className="text-slate-500">{party.contact_no}</div>}
            </div>
            <div className="text-right">
              <div className="text-slate-600">Through: {chalan.through ?? "—"}</div>
              <div className="text-slate-600">No. of Packages: {chalan.no_of_packages ?? "—"}</div>
            </div>
          </div>

          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-300 uppercase text-slate-500">
                <th className="py-1.5 pr-2 w-10">S.No.</th>
                <th className="py-1.5 pr-2">Particulars</th>
                <th className="py-1.5 pr-2">Reference</th>
                <th className="py-1.5 pr-2 text-right">Qty (Ft)</th>
                <th className="py-1.5 pl-2">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {(lines ?? []).map((l, i) => (
                <tr key={l.id} className="border-b border-slate-200">
                  <td className="py-1.5 pr-2">{i + 1}</td>
                  <td className="py-1.5 pr-2">{l.sku_code}{l.product_name ? ` — ${l.product_name}` : ""}</td>
                  <td className="py-1.5 pr-2">{(refsByLine.get(l.id) ?? []).join(", ") || "—"}</td>
                  <td className="py-1.5 pr-2 text-right">{Number(l.quantity_out).toFixed(2)}</td>
                  <td className="py-1.5 pl-2">{l.remark ?? "—"}</td>
                </tr>
              ))}
              {(lines ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-slate-400">No items.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-400 font-semibold">
                <td colSpan={3} className="py-1.5 pr-2 text-right">Total</td>
                <td className="py-1.5 pr-2 text-right">{totalQty.toFixed(2)}</td>
                <td />
              </tr>
            </tfoot>
          </table>

          {chalan.remark && (
            <div className="mt-3 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">Remark: </span>{chalan.remark}
            </div>
          )}

          <div className="mt-12 grid grid-cols-3 gap-6 text-xs text-slate-600">
            <div>
              <div className="border-t border-slate-300 pt-2">Prepared By</div>
            </div>
            <div>
              <div className="border-t border-slate-300 pt-2">Passed By</div>
            </div>
            <div>
              <div className="border-t border-slate-300 pt-2">Receiver&apos;s Sign</div>
            </div>
          </div>
        </div>
      </PrintArea>
    </div>
  );
}
