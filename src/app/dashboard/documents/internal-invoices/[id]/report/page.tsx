import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCapability, ForbiddenError, UnauthorizedError } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";

// 2026-08-29 — same round as the Debit Note and Credit Note report pages
// (see debit-notes/[id]/report's header comment for the full "why").
// Internal Invoice is company-to-company (From Company invoices To
// Company) — letterhead is the FROM company's (the invoicing sequence
// owner, matches internal_invoices.company_id = from_company_id at
// insert time), addressed To the other company.
export default async function InternalInvoiceReportPage({ params }: { params: Promise<{ id: string }> }) {
  try {
    return await InternalInvoiceReportInner(await params);
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

async function InternalInvoiceReportInner({ id }: { id: string }) {
  await requireCapability("doc_entry");
  const supabase = createServiceRoleClient();

  const { data: invoiceRaw } = await supabase
    .from("internal_invoices")
    .select(
      "id, from_company_id, to_company_id, invoice_no, invoice_date, description, qty, rate, amount, gst_18pct, total_amount, prepared_by_employee_id, remark"
    )
    .eq("id", id)
    .maybeSingle();
  if (!invoiceRaw) notFound();

  const invoice = {
    ...invoiceRaw,
    qty: Number(invoiceRaw.qty),
    rate: Number(invoiceRaw.rate),
    amount: Number(invoiceRaw.amount),
    gst_18pct: Number(invoiceRaw.gst_18pct),
    total_amount: Number(invoiceRaw.total_amount),
  };

  const [{ data: fromCompany }, { data: profile }, { data: toCompany }, preparedByResult] = await Promise.all([
    supabase.from("companies").select("id, name, logo_url").eq("id", invoice.from_company_id).single(),
    supabase.from("company_profiles").select("address, phone, email").eq("company_id", invoice.from_company_id).maybeSingle(),
    supabase.from("companies").select("name").eq("id", invoice.to_company_id).single(),
    invoice.prepared_by_employee_id
      ? supabase.from("employees").select("name").eq("id", invoice.prepared_by_employee_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const preparedBy = preparedByResult.data;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/dashboard/documents?tab=internal-invoice" className="text-sm text-slate-500 hover:underline">
          ← Back to Document Entry
        </Link>
        <PrintButton label="🖨 Download PDF" />
      </div>

      <PrintArea id="internal-invoice-report-area">
        <div className="mx-auto max-w-3xl rounded-xl border border-slate-200 bg-white p-8 text-sm text-slate-900 shadow-sm print:border-0 print:p-0" style={{ fontFamily: "Georgia, serif" }}>
          {/* 2026-08-29 (later, same day) — see debit-notes/[id]/report's
              header comment for the full "why": restructured to full-width
              letterhead, then centered title block, then the unchanged
              "To" block below — applied identically across all 3 report
              pages. */}
          <div className="mb-4 flex items-center gap-3">
            {fromCompany?.logo_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fromCompany.logo_url} alt={fromCompany?.name ?? ""} className="h-14 w-14 object-contain" />
            )}
            <div>
              <div className="text-lg font-bold">{fromCompany?.name ?? "—"}</div>
              <div className="text-xs text-slate-500">
                {[profile?.address, profile?.phone, profile?.email].filter(Boolean).join(" | ")}
              </div>
            </div>
          </div>
          <div className="mb-6 border-b border-slate-300 pb-4 text-center">
            <div className="text-xl font-bold tracking-wide text-slate-800">INTERNAL INVOICE</div>
            <div className="text-xs text-slate-500">
              No.: <span className="font-semibold text-slate-800">{invoice.invoice_no ?? "—"}</span>
            </div>
            <div className="text-xs text-slate-500">Date: {invoice.invoice_date}</div>
          </div>

          <div className="mb-4 text-xs">
            <div className="mb-1 font-semibold text-slate-700">To</div>
            <div className="text-slate-900">{toCompany?.name ?? "—"}</div>
          </div>

          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-slate-300 uppercase text-slate-500">
                <th className="py-1.5 pr-2">Description</th>
                <th className="py-1.5 pr-2 text-right">Qty</th>
                <th className="py-1.5 pr-2 text-right">Rate</th>
                <th className="py-1.5 pr-2 text-right">Amount</th>
                <th className="py-1.5 pr-2 text-right">GST 18%</th>
                <th className="py-1.5 pl-2 text-right">Total Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-200">
                <td className="py-1.5 pr-2">{invoice.description}</td>
                <td className="py-1.5 pr-2 text-right">{invoice.qty}</td>
                <td className="py-1.5 pr-2 text-right">{invoice.rate.toFixed(2)}</td>
                <td className="py-1.5 pr-2 text-right">{invoice.amount.toFixed(2)}</td>
                <td className="py-1.5 pr-2 text-right">{invoice.gst_18pct.toFixed(2)}</td>
                <td className="py-1.5 pl-2 text-right font-semibold text-slate-900">₹{invoice.total_amount.toFixed(2)}</td>
              </tr>
            </tbody>
          </table>

          {preparedBy?.name && (
            <div className="mt-3 text-xs text-slate-500">Prepared By: {preparedBy.name}</div>
          )}

          {invoice.remark && (
            <div className="mt-4 text-xs">
              <span className="font-semibold text-slate-700">Remark: </span>
              <span className="text-slate-600">{invoice.remark}</span>
            </div>
          )}

          <div className="mt-12 text-right text-xs">
            <div className="font-semibold text-slate-800">For {fromCompany?.name ?? "—"}</div>
            <div className="mt-8 text-slate-400">Authorized Signatory</div>
          </div>
        </div>
      </PrintArea>
    </div>
  );
}
