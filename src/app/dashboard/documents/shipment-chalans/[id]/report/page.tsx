import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";

// 2026-10-17 — Shipment Handover Chalan had no single-document print view at
// all (only "Delete" in its recent list), so it had nothing to open in the
// new A4 print dialog. This is its own A4 handover sheet: courier, date,
// and every order/shipment handed over under this chalan — the physical
// proof-of-handover the courier signs.
export default async function ShipmentChalanReportPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    return await ShipmentChalanReportInner(await params);
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

async function ShipmentChalanReportInner({ id }: { id: string }) {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: chalan } = await supabase
    .from("shipment_handover_chalans")
    .select("id, company_id, courier_party_id, chalan_no, chalan_date, remark")
    .eq("id", id)
    .maybeSingle();
  if (!chalan) notFound();

  const [{ data: company }, { data: profile }, { data: courier }, { data: lines }] = await Promise.all([
    supabase.from("companies").select("id, name, logo_url").eq("id", chalan.company_id).single(),
    supabase.from("company_profiles").select("address, phone, email").eq("company_id", chalan.company_id).maybeSingle(),
    supabase.from("parties").select("name, address, contact_no").eq("id", chalan.courier_party_id).maybeSingle(),
    supabase
      .from("shipment_handover_chalan_lines")
      .select("id, order_id, remark, orders(ref_no)")
      .eq("chalan_id", chalan.id)
      .order("created_at"),
  ]);

  const rows = (lines ?? []).map((l) => {
    const o = Array.isArray(l.orders) ? l.orders[0] : l.orders;
    return { id: l.id, orderRef: o?.ref_no ?? "—", remark: l.remark };
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/dashboard/documents?tab=shipment-chalan" className="text-sm text-slate-500 hover:underline">
          ← Back to Document Entry
        </Link>
        <PrintButton label="🖨 Print / Download PDF" />
      </div>

      <PrintArea id="shipment-chalan-report-area" companyName={company?.name} companyLogoUrl={company?.logo_url}>
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
              <div className="text-base font-bold tracking-wide">SHIPMENT HANDOVER CHALAN</div>
              <div className="text-xs">{chalan.chalan_no ?? "—"}</div>
              <div className="text-xs">{chalan.chalan_date}</div>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-4 text-xs">
            <div>
              <div className="font-semibold text-slate-500">HANDED OVER TO (COURIER)</div>
              <div className="font-bold">{courier?.name ?? "—"}</div>
              {courier?.address && <div className="whitespace-pre-wrap text-slate-600">{courier.address}</div>}
              {courier?.contact_no && <div>Phone: {courier.contact_no}</div>}
            </div>
            <div className="space-y-0.5">
              <div>
                <span className="text-slate-500">Shipments: </span>
                {rows.length}
              </div>
              <div>
                <span className="text-slate-500">Remark: </span>
                {chalan.remark ?? "—"}
              </div>
            </div>
          </div>

          <table className="mb-4 w-full border-collapse text-xs">
            <thead>
              <tr className="border-y border-slate-300 bg-slate-50 print:bg-transparent">
                <th className="px-2 py-1.5 text-left">S.No.</th>
                <th className="px-2 py-1.5 text-left">Order / PO Ref</th>
                <th className="px-2 py-1.5 text-left">Remark</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="border-b border-slate-200">
                  <td className="px-2 py-1.5">{i + 1}</td>
                  <td className="px-2 py-1.5">{r.orderRef}</td>
                  <td className="px-2 py-1.5">{r.remark ?? "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-2 py-3 text-center text-slate-400">
                    No shipment lines.
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          <div className="mt-10 grid grid-cols-3 gap-4 text-[11px] text-slate-600">
            <div className="border-t border-slate-400 pt-1">Prepared by</div>
            <div className="border-t border-slate-400 pt-1">Courier Person Sign</div>
            <div className="border-t border-slate-400 pt-1">Authorised Sign</div>
          </div>
        </div>
      </PrintArea>
    </div>
  );
}
