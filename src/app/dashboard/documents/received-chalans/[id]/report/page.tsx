import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";

// 2026-08-29 (evening, follow-up round) — Received Chalan print/report
// page. Same outer try/catch + requireCapability("doc_entry") shape as
// every other single-document report page in this module (Debit Note,
// Credit Note, Journal Voucher, etc. — see debit-notes/[id]/report's
// header comment for the general pattern). Laid out to match the physical
// NYKO MART chalan pad: From / Through / No. of Packages / Date header
// block, a S.No./Particulars/Reference/Qty/Rate/Remarks table, Total row
// (per qty unit — a chalan can mix FT/MTR/PCS lines, unlike Material OUT
// Chalan which is always Ft), Prepared by/Passed by/Receiver's Sign.
export default async function ReceivedChalanReportPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    return await ReceivedChalanReportInner(await params);
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

async function ReceivedChalanReportInner({ id }: { id: string }) {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: chalanRaw } = await supabase
    .from("received_chalans")
    .select("id, company_id, party_id, chalan_no, chalan_date, order_id, through, no_of_packages, source, remark")
    .eq("id", id)
    .maybeSingle();
  if (!chalanRaw) notFound();

  const [{ data: company }, { data: profile }, { data: party }, { data: order }, { data: items }] = await Promise.all([
    supabase.from("companies").select("id, name, logo_url").eq("id", chalanRaw.company_id).single(),
    supabase.from("company_profiles").select("address, phone, email").eq("company_id", chalanRaw.company_id).maybeSingle(),
    supabase.from("parties").select("name, address, gst, contact_no").eq("id", chalanRaw.party_id).maybeSingle(),
    chalanRaw.order_id ? supabase.from("orders").select("ref_no").eq("id", chalanRaw.order_id).maybeSingle() : Promise.resolve({ data: null }),
    supabase.from("received_chalan_items").select("id, description, qty, qty_unit, rate, remark").eq("chalan_id", chalanRaw.id).order("created_at"),
  ]);

  const itemRows = (items ?? []).map((it) => ({ ...it, qty: Number(it.qty), rate: it.rate != null ? Number(it.rate) : null }));

  // Total per qty unit — a chalan can legitimately mix FT/MTR/PCS lines,
  // unlike Material OUT Chalan which is always Ft, so summing across units
  // would be meaningless.
  const totalsByUnit = new Map<string, number>();
  for (const it of itemRows) {
    totalsByUnit.set(it.qty_unit, (totalsByUnit.get(it.qty_unit) ?? 0) + it.qty);
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/dashboard/documents?tab=received-chalan" className="text-sm text-slate-500 hover:underline">
          ← Back to Document Entry
        </Link>
        <PrintButton label="🖨 Download PDF" />
      </div>

      <PrintArea id="received-chalan-report-area">
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
            <div className="text-xl font-bold tracking-wide text-slate-800">RECEIVED CHALAN</div>
            <div className="text-xs text-slate-500">
              Chalan No.: <span className="font-semibold text-slate-800">{chalanRaw.chalan_no ?? "—"}</span>
            </div>
            <div className="text-xs text-slate-500">Date: {chalanRaw.chalan_date}</div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-6 text-xs">
            <div>
              <div className="mb-1 font-semibold text-slate-700">From</div>
              <div className="text-slate-900">{party?.name ?? "—"}</div>
              {party?.address && <div className="text-slate-500">{party.address}</div>}
              {party?.gst && <div className="text-slate-500">GSTIN: {party.gst}</div>}
              {party?.contact_no && <div className="text-slate-500">{party.contact_no}</div>}
            </div>
            <div className="text-right">
              <div className="text-slate-600">Through: {chalanRaw.through ?? "—"}</div>
              <div className="text-slate-600">No. of Packages: {chalanRaw.no_of_packages ?? "—"}</div>
              <div className="text-slate-600">Order/PO: {order?.ref_no ?? "—"}</div>
            </div>
          </div>

          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-300 uppercase text-slate-500">
                <th className="py-1.5 pr-2 w-10">S.No.</th>
                <th className="py-1.5 pr-2">Particulars</th>
                <th className="py-1.5 pr-2 text-right">Qty</th>
                <th className="py-1.5 pr-2 text-right">Rate</th>
                <th className="py-1.5 pl-2">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {itemRows.map((it, i) => (
                <tr key={it.id} className="border-b border-slate-200">
                  <td className="py-1.5 pr-2">{i + 1}</td>
                  <td className="py-1.5 pr-2">{it.description}</td>
                  <td className="py-1.5 pr-2 text-right">{it.qty.toFixed(2)} {it.qty_unit}</td>
                  <td className="py-1.5 pr-2 text-right">{it.rate != null ? it.rate.toFixed(2) : "—"}</td>
                  <td className="py-1.5 pl-2">{it.remark ?? "—"}</td>
                </tr>
              ))}
              {itemRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-center text-slate-400">No items.</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-400 font-semibold">
                <td colSpan={2} className="py-1.5 pr-2 text-right">Total</td>
                <td className="py-1.5 pr-2 text-right">
                  {Array.from(totalsByUnit.entries()).map(([unit, qty]) => `${qty.toFixed(2)} ${unit}`).join(", ") || "—"}
                </td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>

          {chalanRaw.source === "purchase_bill" && (
            <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-slate-700">
              Auto-generated from the linked Purchase Bill&apos;s Finance ledger entry.
            </div>
          )}
          {chalanRaw.remark && (
            <div className="mt-3 text-xs text-slate-600">
              <span className="font-semibold text-slate-700">Remark: </span>{chalanRaw.remark}
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
