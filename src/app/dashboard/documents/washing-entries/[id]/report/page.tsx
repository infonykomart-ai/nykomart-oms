import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";

// 2026-10-17 — "Washing Entry ki entry me print alag page par lekr jata
// hai ... print a4 page par same page par dialogbox me show hoye": Washing
// Entry was the only Document Entry type with no single-document print
// view at all (only the flat recent-list print), so its "🖨 Print" button
// in the list had nothing to embed in the new A4 print dialog. This page
// is that one document's own A4 chalan: vendor letterhead block, chalan
// no/date, PO reference, and the sq.ft × rate line that the table's own
// generated `amount` column is derived from.
export default async function WashingEntryReportPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    return await WashingEntryReportInner(await params);
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

async function WashingEntryReportInner({ id }: { id: string }) {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: raw } = await supabase
    .from("washing_entries")
    .select("id, company_id, party_id, chalan_no, chalan_date, order_id, sku_id, item_size, pcs, sq_mtr_ft, rate, amount, debit_charges, store_id")
    .eq("id", id)
    .maybeSingle();
  if (!raw) notFound();

  const [{ data: company }, { data: profile }, { data: party }, { data: order }, { data: sku }, { data: store }] = await Promise.all([
    supabase.from("companies").select("id, name, logo_url").eq("id", raw.company_id).single(),
    supabase.from("company_profiles").select("address, phone, email").eq("company_id", raw.company_id).maybeSingle(),
    supabase.from("parties").select("name, address, gst, contact_no").eq("id", raw.party_id).maybeSingle(),
    raw.order_id ? supabase.from("orders").select("ref_no").eq("id", raw.order_id).maybeSingle() : Promise.resolve({ data: null }),
    raw.sku_id ? supabase.from("skus").select("sku_code").eq("id", raw.sku_id).maybeSingle() : Promise.resolve({ data: null }),
    raw.store_id ? supabase.from("stores").select("name").eq("id", raw.store_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const sqFt = raw.sq_mtr_ft != null ? Number(raw.sq_mtr_ft) : null;
  const rate = raw.rate != null ? Number(raw.rate) : null;
  const amount = raw.amount != null ? Number(raw.amount) : null;
  const debit = raw.debit_charges != null ? Number(raw.debit_charges) : 0;
  const money = (n: number | null) =>
    n == null ? "—" : n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/dashboard/documents?tab=washing-entry" className="text-sm text-slate-500 hover:underline">
          ← Back to Document Entry
        </Link>
        <PrintButton label="🖨 Print / Download PDF" />
      </div>

      <PrintArea id="washing-entry-report-area" companyName={company?.name} companyLogoUrl={company?.logo_url}>
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
              <div className="text-base font-bold tracking-wide">WASHING CHALAN</div>
              <div className="text-xs">{raw.chalan_no ?? "—"}</div>
              <div className="text-xs">{raw.chalan_date}</div>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-4 text-xs">
            <div>
              <div className="font-semibold text-slate-500">PARTY / JOB WORKER</div>
              <div className="font-bold">{party?.name ?? "—"}</div>
              {party?.address && <div className="whitespace-pre-wrap text-slate-600">{party.address}</div>}
              {party?.contact_no && <div>Phone: {party.contact_no}</div>}
              {party?.gst && <div>GST: {party.gst}</div>}
            </div>
            <div className="space-y-0.5">
              <div>
                <span className="text-slate-500">PO / Order Ref: </span>
                {order?.ref_no ?? "—"}
              </div>
              <div>
                <span className="text-slate-500">Store: </span>
                {store?.name ?? "—"}
              </div>
              <div>
                <span className="text-slate-500">Pieces: </span>
                {raw.pcs ?? "—"}
              </div>
            </div>
          </div>

          <table className="mb-4 w-full border-collapse text-xs">
            <thead>
              <tr className="border-y border-slate-300 bg-slate-50 print:bg-transparent">
                <th className="px-2 py-1.5 text-left">S.No.</th>
                <th className="px-2 py-1.5 text-left">SKU</th>
                <th className="px-2 py-1.5 text-left">Size</th>
                <th className="px-2 py-1.5 text-right">Pcs</th>
                <th className="px-2 py-1.5 text-right">Sq. Mtr/Ft</th>
                <th className="px-2 py-1.5 text-right">Rate</th>
                <th className="px-2 py-1.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-200">
                <td className="px-2 py-1.5">1</td>
                <td className="px-2 py-1.5">{sku?.sku_code ?? "—"}</td>
                <td className="px-2 py-1.5">{raw.item_size ?? "—"}</td>
                <td className="px-2 py-1.5 text-right">{raw.pcs ?? "—"}</td>
                <td className="px-2 py-1.5 text-right">{money(sqFt)}</td>
                <td className="px-2 py-1.5 text-right">{money(rate)}</td>
                <td className="px-2 py-1.5 text-right">{money(amount)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-300 font-semibold">
                <td className="px-2 py-1.5" colSpan={6}>
                  Washing Amount
                </td>
                <td className="px-2 py-1.5 text-right">₹{money(amount)}</td>
              </tr>
              {debit > 0 && (
                <tr>
                  <td className="px-2 py-1.5" colSpan={6}>
                    Debit Charges
                  </td>
                  <td className="px-2 py-1.5 text-right">₹{money(debit)}</td>
                </tr>
              )}
              <tr className="border-t border-slate-300 font-bold">
                <td className="px-2 py-1.5" colSpan={6}>
                  Total Payable
                </td>
                <td className="px-2 py-1.5 text-right">₹{money((amount ?? 0) + debit)}</td>
              </tr>
            </tfoot>
          </table>

          <div className="mt-10 grid grid-cols-3 gap-4 text-[11px] text-slate-600">
            <div className="border-t border-slate-400 pt-1">Prepared by</div>
            <div className="border-t border-slate-400 pt-1">Checked by</div>
            <div className="border-t border-slate-400 pt-1">Receiver&apos;s Sign</div>
          </div>
        </div>
      </PrintArea>
    </div>
  );
}
