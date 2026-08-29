import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";

// 2026-08-29 — same round as the Debit Note and Internal Invoice report
// pages (see debit-notes/[id]/report's header comment for the full "why"):
// Credit Note also had no individual print/PDF, only the flat recent-list
// print. Single-row document, so this mirrors that same simple layout —
// company letterhead, buyer/order reference block, one line of refund
// figures, remark, signatory.
export default async function CreditNoteReportPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    return await CreditNoteReportInner(await params);
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

async function CreditNoteReportInner({ id }: { id: string }) {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: noteRaw } = await supabase
    .from("credit_notes")
    .select(
      "id, company_id, store_id, cn_no, credit_note_date, order_id, item_id, buyer_name, refund_date, item_name, item_price, invoice_no, invoice_value_usd, invoice_value_inr, refund_amount, refund_amt_usd, refund_amt_inr, credit_note_status, refund_type, debit_note_id, party_id, qty, po_rate, billed_rate, remark"
    )
    .eq("id", id)
    .maybeSingle();
  if (!noteRaw) notFound();

  const note = {
    ...noteRaw,
    item_price: noteRaw.item_price != null ? Number(noteRaw.item_price) : null,
    invoice_value_usd: noteRaw.invoice_value_usd != null ? Number(noteRaw.invoice_value_usd) : null,
    invoice_value_inr: noteRaw.invoice_value_inr != null ? Number(noteRaw.invoice_value_inr) : null,
    refund_amount: Number(noteRaw.refund_amount),
    refund_amt_usd: noteRaw.refund_amt_usd != null ? Number(noteRaw.refund_amt_usd) : null,
    refund_amt_inr: noteRaw.refund_amt_inr != null ? Number(noteRaw.refund_amt_inr) : null,
    // 2026-08-29 — vendor-side (Party) Rate Difference Calculator reference
    // fields, see db/2026-08-29-credit-note-rate-difference.sql. Null on
    // any note that isn't a rate-difference case (or that isn't
    // vendor-side at all), so both the party block and the breakup line
    // below are conditional.
    qty: noteRaw.qty != null ? Number(noteRaw.qty) : null,
    po_rate: noteRaw.po_rate != null ? Number(noteRaw.po_rate) : null,
    billed_rate: noteRaw.billed_rate != null ? Number(noteRaw.billed_rate) : null,
  };

  const [{ data: company }, { data: profile }, storeResult, orderResult, debitNoteResult, partyResult] = await Promise.all([
    supabase.from("companies").select("id, name, logo_url").eq("id", note.company_id).single(),
    supabase.from("company_profiles").select("address, phone, email").eq("company_id", note.company_id).maybeSingle(),
    note.store_id ? supabase.from("stores").select("name").eq("id", note.store_id).maybeSingle() : Promise.resolve({ data: null }),
    note.order_id ? supabase.from("orders").select("ref_no").eq("id", note.order_id).maybeSingle() : Promise.resolve({ data: null }),
    note.debit_note_id
      ? supabase.from("debit_notes").select("debit_note_no").eq("id", note.debit_note_id).maybeSingle()
      : Promise.resolve({ data: null }),
    // 2026-08-29 — vendor-side notes have no buyer_name at all (that field
    // belongs to the original sales/buyer-refund flow); show the party
    // instead so the printed note isn't blank where "Buyer" would be.
    note.party_id
      ? supabase.from("parties").select("name, address, gst, contact_no").eq("id", note.party_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const store = storeResult.data;
  const order = orderResult.data;
  const debitNote = debitNoteResult.data;
  const party = partyResult.data;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/dashboard/documents?tab=credit-note" className="text-sm text-slate-500 hover:underline">
          ← Back to Document Entry
        </Link>
        <PrintButton label="🖨 Download PDF" />
      </div>

      <PrintArea id="credit-note-report-area">
        <div className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-900 shadow-sm print:border-0 print:p-0" style={{ fontFamily: "Georgia, serif" }}>
          {/* 2026-08-29 (later, same day) — see debit-notes/[id]/report's
              header comment for the full "why": restructured to full-width
              letterhead, then centered title block, then the unchanged
              party/reference two-column row — applied identically across
              all 3 report pages. */}
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
            <div className="text-xl font-bold tracking-wide text-slate-800">CREDIT NOTE</div>
            <div className="text-xs text-slate-500">
              No.: <span className="font-semibold text-slate-800">{note.cn_no ?? "—"}</span>
            </div>
            <div className="text-xs text-slate-500">Date: {note.credit_note_date}</div>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-6 text-xs">
            <div>
              <div className="mb-1 font-semibold text-slate-700">{party ? "Party (Vendor)" : "Buyer"}</div>
              {party ? (
                <>
                  <div className="text-slate-900">{party.name}</div>
                  {party.address && <div className="text-slate-500">{party.address}</div>}
                  {party.gst && <div className="text-slate-500">GSTIN: {party.gst}</div>}
                  {party.contact_no && <div className="text-slate-500">{party.contact_no}</div>}
                </>
              ) : (
                <div className="text-slate-900">{note.buyer_name ?? "—"}</div>
              )}
              {store?.name && <div className="text-slate-500">Portal/Store: {store.name}</div>}
            </div>
            <div className="text-right">
              {order?.ref_no && <div className="text-slate-600">PO / Order No.: {order.ref_no}</div>}
              {note.invoice_no && <div className="text-slate-600">Invoice No.: {note.invoice_no}</div>}
              {debitNote?.debit_note_no && <div className="text-slate-600">Linked Debit Note: {debitNote.debit_note_no}</div>}
            </div>
          </div>

          {/* 2026-08-29 — vendor-side rate-difference breakup, same
              reasoning as the Debit Note report's identical block. */}
          {note.po_rate != null && note.billed_rate != null && (
            <div className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-slate-700">
              <span className="font-semibold text-slate-700">Rate Difference: </span>
              Billed ₹{note.billed_rate.toFixed(2)} − Agreed/PO ₹{note.po_rate.toFixed(2)} = ₹
              {(note.billed_rate - note.po_rate).toFixed(2)} / unit
              {note.qty != null && (
                <>
                  {" "}× Qty {note.qty} = ₹{((note.billed_rate - note.po_rate) * note.qty).toFixed(2)}
                </>
              )}
            </div>
          )}

          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-300 uppercase text-slate-500">
                <th className="py-1.5 pr-2">Item</th>
                <th className="py-1.5 pr-2 text-right">Item Price</th>
                <th className="py-1.5 pr-2 text-right">Invoice Value (USD)</th>
                <th className="py-1.5 pr-2 text-right">Invoice Value (INR)</th>
                <th className="py-1.5 pr-2 text-right">Refund Amount</th>
                <th className="py-1.5 pl-2 text-right">Refund Date</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-200">
                <td className="py-1.5 pr-2">{note.item_name ?? "—"}{note.item_id ? ` (${note.item_id})` : ""}</td>
                <td className="py-1.5 pr-2 text-right">{note.item_price != null ? note.item_price.toFixed(2) : "—"}</td>
                <td className="py-1.5 pr-2 text-right">{note.invoice_value_usd != null ? `$${note.invoice_value_usd.toFixed(2)}` : "—"}</td>
                <td className="py-1.5 pr-2 text-right">{note.invoice_value_inr != null ? `₹${note.invoice_value_inr.toFixed(2)}` : "—"}</td>
                <td className="py-1.5 pr-2 text-right font-semibold text-slate-900">₹{note.refund_amount.toFixed(2)}</td>
                <td className="py-1.5 pl-2 text-right">{note.refund_date ?? "—"}</td>
              </tr>
            </tbody>
          </table>

          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
            {note.refund_amt_usd != null && <div>Refund (USD): ${note.refund_amt_usd.toFixed(2)}</div>}
            {note.refund_amt_inr != null && <div>Refund (INR): ₹{note.refund_amt_inr.toFixed(2)}</div>}
            {note.refund_type && <div>Refund Type: {note.refund_type}</div>}
            {note.credit_note_status && <div>Status: {note.credit_note_status}</div>}
          </div>

          {note.remark && (
            <div className="mt-4 text-xs">
              <span className="font-semibold text-slate-700">Remark: </span>
              <span className="text-slate-600">{note.remark}</span>
            </div>
          )}

          <div className="mt-12 text-right text-xs">
            <div className="font-semibold text-slate-800">For {company?.name ?? "—"}</div>
            <div className="mt-8 text-slate-400">Authorized Signatory</div>
          </div>
        </div>
      </PrintArea>
    </div>
  );
}
