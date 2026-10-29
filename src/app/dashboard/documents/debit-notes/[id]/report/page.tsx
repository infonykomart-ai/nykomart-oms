import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";
import { DocLetterhead, DocGeneratedFooter } from "@/components/doc-letterhead";

// 2026-08-29 — "debit note ka print kaha se milega": Debit Note (like
// Credit Note and Internal Invoice) had no individual print/PDF at all —
// only the flat "Recent Debit Notes" list on Document Entry, and that list
// prints as one long list, not a single formatted document. This mirrors
// the existing Freight/Duty Bill Report pages (same requireCapability +
// PrintArea/PrintButton shape) but for the simpler single-row Debit Note
// shape — one company letterhead, one party, one line of amounts, not a
// multi-AWB detail table. Linked from the "Print" action added to the
// Debit Note row in document-entry-tabs.tsx's DocList.
export default async function DebitNoteReportPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    return await DebitNoteReportInner(await params);
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

async function DebitNoteReportInner({ id }: { id: string }) {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: noteRaw } = await supabase
    .from("debit_notes")
    .select(
      "id, company_id, debit_note_no, debit_note_date, against_invoice_bill_no, party_id, order_id, particulars, bill_no, bill_date, sq_ft, qty, rate, po_rate, billed_rate, po_amount, debit_amount, cgst_2_5pct, sgst_2_5pct, total_amount, remark"
    )
    .eq("id", id)
    .maybeSingle();
  if (!noteRaw) notFound();

  // Postgres numeric columns come back as strings over PostgREST —
  // normalize once here, same convention as the Freight/Duty Bill reports.
  const note = {
    ...noteRaw,
    sq_ft: noteRaw.sq_ft != null ? Number(noteRaw.sq_ft) : null,
    rate: noteRaw.rate != null ? Number(noteRaw.rate) : null,
    // 2026-08-29 — rate-difference reference fields (see
    // db/2026-08-29-debit-note-rate-difference.sql) — null on any note
    // that isn't a rate-difference case, so the breakup line below is
    // conditional on both being present.
    po_rate: noteRaw.po_rate != null ? Number(noteRaw.po_rate) : null,
    billed_rate: noteRaw.billed_rate != null ? Number(noteRaw.billed_rate) : null,
    po_amount: noteRaw.po_amount != null ? Number(noteRaw.po_amount) : null,
    debit_amount: Number(noteRaw.debit_amount),
    cgst_2_5pct: Number(noteRaw.cgst_2_5pct),
    sgst_2_5pct: Number(noteRaw.sgst_2_5pct),
    total_amount: Number(noteRaw.total_amount),
  };

  const [{ data: company }, { data: profile }, { data: party }, orderResult] = await Promise.all([
    supabase.from("companies").select("id, name, logo_url").eq("id", note.company_id).single(),
    supabase
      .from("company_profiles")
      .select("address, phone, whatsapp, email, gstin, bank_name, account_no, ifsc_code")
      .eq("company_id", note.company_id)
      .maybeSingle(),
    supabase.from("parties").select("name, address, gst, contact_no").eq("id", note.party_id).single(),
    note.order_id
      ? supabase.from("orders").select("ref_no").eq("id", note.order_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const order = orderResult.data;

  // 2026-10-29 — a Debit Note can cover SEVERAL invoices of the same party
  // ("4 PO 4 alag alag bill me hai lekin debit note ek hi banega"). The
  // per-invoice amounts live in bill_pass_register_adjustments, so the
  // printed note lists exactly which invoice carried how much debit — the
  // note never leaves the reader guessing which bill it is against.
  const { data: adjRows } = await supabase
    .from("bill_pass_register_adjustments")
    .select("amount, bill_pass_register_id")
    .eq("debit_note_id", id)
    .order("created_at", { ascending: true });
  const adjIds = Array.from(new Set((adjRows ?? []).map((r) => r.bill_pass_register_id as string)));
  const { data: adjBills } = adjIds.length
    ? await supabase
        .from("bill_pass_register")
        .select("id, vendor_invoice_no, invoice_no, invoice_date")
        .in("id", adjIds)
    : { data: [] as { id: string; vendor_invoice_no: string | null; invoice_no: string | null; invoice_date: string | null }[] };
  const adjBillById = new Map((adjBills ?? []).map((b) => [b.id, b]));
  const invoiceLines = (adjRows ?? []).map((r) => {
    const b = adjBillById.get(r.bill_pass_register_id as string);
    return {
      invoiceNo: b?.vendor_invoice_no ?? b?.invoice_no ?? "—",
      invoiceDate: b?.invoice_date ?? null,
      amount: Number(r.amount),
    };
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/dashboard/documents?tab=debit-note" className="text-sm text-slate-500 hover:underline">
          ← Back to Document Entry
        </Link>
        <PrintButton label="🖨 Download PDF" />
      </div>

      <PrintArea id="debit-note-report-area" companyName={company?.name} companyLogoUrl={company?.logo_url}>
        <div className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-900 shadow-sm print:border-0 print:p-0" style={{ fontFamily: "Georgia, serif" }}>
          {/* 2026-08-29 (later, same day) — "top ful: Company letterhead ...
              top, just down center: document title + No. + Date, just down
              left: Party/Buyer details ek taraf, reference numbers doosri
              taraf" — restructured from a single letterhead-left/title-right
              row into 3 stacked rows: full-width letterhead, then the
              document title block centered below it, then the existing
              party/reference two-column row unchanged.
              2026-10-29b — the letterhead is now the FULL printed identity
              (logo, name, address, phone/WhatsApp, email + GSTIN / Bank /
              A/C / IFSC under a double rule), the same one the Purchase Bill
              statement prints — it used to be just a logo and a name. */}
          <DocLetterhead company={company} profile={profile} />
          <div className="mb-6 border-b border-slate-300 pb-4 text-center">
            <div className="text-xl font-bold tracking-wide text-slate-800">DEBIT NOTE</div>
            <div className="text-xs text-slate-500">
              No.: <span className="font-semibold text-slate-800">{note.debit_note_no ?? "—"}</span>
            </div>
            <div className="text-xs text-slate-500">Date: {note.debit_note_date}</div>
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
              {order?.ref_no && <div className="text-slate-600">PO No.: {order.ref_no}</div>}
              {note.bill_no && <div className="text-slate-600">Bill No.: {note.bill_no}{note.bill_date ? ` (${note.bill_date})` : ""}</div>}
              {note.against_invoice_bill_no && <div className="text-slate-600">Against Invoice/Bill No.: {note.against_invoice_bill_no}</div>}
            </div>
          </div>

          {note.particulars && (
            <div className="mb-4 text-xs">
              <span className="font-semibold text-slate-700">Particulars: </span>
              <span className="text-slate-600">{note.particulars}</span>
            </div>
          )}

          {invoiceLines.length > 0 && (
            <div className="mb-4 text-xs">
              <div className="mb-1 font-semibold text-slate-700">
                Against {invoiceLines.length === 1 ? "invoice" : `${invoiceLines.length} invoices`}
              </div>
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-slate-300 uppercase text-slate-500">
                    <th className="py-1 pr-2">Invoice No.</th>
                    <th className="py-1 pr-2">Invoice Date</th>
                    <th className="py-1 text-right">Debit Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {invoiceLines.map((l, i) => (
                    <tr key={`${l.invoiceNo}-${i}`} className="border-b border-slate-100">
                      <td className="py-1 pr-2 text-slate-800">{l.invoiceNo}</td>
                      <td className="py-1 pr-2 text-slate-500">{l.invoiceDate ?? "—"}</td>
                      <td className="py-1 text-right text-slate-800">₹{l.amount.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 2026-08-29 — "sahi bana hai kya": show the rate-difference math
              on the printed note itself, instead of a bare Debit Amount
              nobody can trace back to a reason — only shown when both
              reference rates were actually set. */}
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
                <th className="py-1.5 pr-2 text-right">Sq.Ft</th>
                <th className="py-1.5 pr-2 text-right">Qty</th>
                <th className="py-1.5 pr-2 text-right">Rate</th>
                <th className="py-1.5 pr-2 text-right">PO Amount</th>
                <th className="py-1.5 pr-2 text-right">Debit Amount</th>
                <th className="py-1.5 pr-2 text-right">CGST 2.5%</th>
                <th className="py-1.5 pr-2 text-right">SGST 2.5%</th>
                <th className="py-1.5 pl-2 text-right">Total Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-200">
                <td className="py-1.5 pr-2 text-right">{note.sq_ft ?? "—"}</td>
                <td className="py-1.5 pr-2 text-right">{note.qty ?? "—"}</td>
                <td className="py-1.5 pr-2 text-right">{note.rate != null ? note.rate.toFixed(2) : "—"}</td>
                <td className="py-1.5 pr-2 text-right">{note.po_amount != null ? note.po_amount.toFixed(2) : "—"}</td>
                <td className="py-1.5 pr-2 text-right font-medium">{note.debit_amount.toFixed(2)}</td>
                <td className="py-1.5 pr-2 text-right">{note.cgst_2_5pct.toFixed(2)}</td>
                <td className="py-1.5 pr-2 text-right">{note.sgst_2_5pct.toFixed(2)}</td>
                <td className="py-1.5 pl-2 text-right font-semibold text-slate-900">₹{note.total_amount.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

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

          <DocGeneratedFooter className="mt-6 border-t border-slate-300 pt-2" />
        </div>
      </PrintArea>
    </div>
  );
}
