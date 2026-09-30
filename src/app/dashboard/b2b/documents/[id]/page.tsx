import { notFound } from "next/navigation";
import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";
import { recordDocumentPrinted } from "../../actions";

// 2026-09-30b — the printable A4 face of every issued B2B commercial
// document. One page, three faces (doc_kind): PI = Proforma Invoice,
// CI = Commercial Invoice, PL = Packing List. Layout follows the same A4
// conventions as every other printable in this app (PrintArea + shared
// branding footer + window.print()).
//
// Opening this page IS the "print" event: printed_count increments once
// per render via recordDocumentPrinted (fire-and-forget, never blocks).

const DOC_TITLES: Record<string, { title: string; subtitle: string }> = {
  PI: { title: "PROFORMA INVOICE", subtitle: "Performa Invoice — advance/buyer-bank use" },
  CI: { title: "COMMERCIAL INVOICE", subtitle: "Commercial Invoice — final bill of sale" },
  PL: { title: "PACKING LIST", subtitle: "Packing List — package-wise contents" },
};

const COPY_MARKS: Record<number, string> = {
  1: "ORIGINAL",
  2: "DUPLICATE",
  3: "TRIPLICATE",
};

function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v.length === 10 ? v + "T00:00:00" : v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function money(n: number, currency: string): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(n);
}

export default async function B2BDocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await getAuthedEmployee();
  const supabase = createServiceRoleClient();

  const { data: doc } = await supabase
    .from("b2b_documents")
    .select("*")
    .eq("id", id)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (!doc) notFound();

  const { data: quote } = await supabase.from("b2b_quotations").select("*").eq("id", doc.quotation_id).maybeSingle();
  if (!quote) notFound();
  const [{ data: items }, { data: company }, { data: inquiry }] = await Promise.all([
    supabase.from("b2b_quotation_items").select("*").eq("quotation_id", quote.id).order("display_order"),
    supabase.from("companies").select("name, logo_url").eq("id", quote.company_id).maybeSingle(),
    supabase.from("b2b_inquiries").select("inquiry_no, inquiry_date, buyer_company").eq("id", quote.inquiry_id).maybeSingle(),
  ]);

  // Fire-and-forget print telemetry — awaited so Vercel doesn't freeze the
  // function mid-write, but failures are ignored by design.
  await recordDocumentPrinted(doc.id);

  const meta = DOC_TITLES[doc.doc_kind] ?? { title: doc.doc_kind, subtitle: "" };
  const subtotal = (items ?? []).reduce((s, it) => s + it.line_total, 0);
  const taxAmount = Math.round(subtotal * quote.tax_percent) / 100;
  const total = Math.round((subtotal * (1 + quote.tax_percent / 100) + quote.shipping_amount) * 100) / 100;
  const totalQty = (items ?? []).reduce((s, it) => s + it.qty, 0);
  const copyMark = COPY_MARKS[doc.copy_no] ?? `COPY ${doc.copy_no}`;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-3 flex items-center justify-between print:hidden">
        <a href="/dashboard/b2b" className="text-sm text-slate-500 hover:underline">← Back to B2B Inquiries</a>
        <PrintButton label={`🖨 Print / Save ${doc.doc_kind} PDF`} />
      </div>

      <PrintArea id={`b2b-doc-${doc.id}`} companyName={company?.name ?? undefined} companyLogoUrl={company?.logo_url}>
        <div className="rounded-lg border border-slate-300 bg-white p-8 text-slate-900">
          {/* Letterhead */}
          <div className="flex items-start justify-between gap-4 border-b-2 border-slate-800 pb-4">
            <div className="flex items-center gap-3">
              {company?.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element -- print output
                <img src={company.logo_url} alt="" className="h-14 w-14 rounded object-contain" />
              )}
              <div>
                <div className="text-xl font-bold">{company?.name ?? "Nykomart"}</div>
                <div className="text-xs text-slate-500">Export House · India</div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-lg font-bold tracking-wide">{meta.title}</div>
              <div className="text-[11px] text-slate-500">{meta.subtitle}</div>
              <div className="mt-1 inline-block rounded bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{copyMark}</div>
            </div>
          </div>

          {/* Doc meta */}
          <div className="mt-4 grid grid-cols-2 gap-6 text-sm">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Buyer</div>
              <div className="mt-1 font-semibold">{quote.buyer_name}</div>
              {inquiry?.buyer_company && <div>{inquiry.buyer_company}</div>}
              {quote.buyer_country && <div className="text-slate-600">{quote.buyer_country}</div>}
              {quote.buyer_contact_no && <div className="text-slate-600">{quote.buyer_contact_no}</div>}
              {quote.buyer_email && <div className="text-slate-600">{quote.buyer_email}</div>}
            </div>
            <div className="space-y-1 text-right">
              <div><span className="text-slate-500">Document No:</span> <strong>{doc.doc_no}</strong></div>
              <div><span className="text-slate-500">Date:</span> {fmtDate(doc.doc_date)}</div>
              {quote.valid_until && <div><span className="text-slate-500">Valid Until:</span> {fmtDate(quote.valid_until)}</div>}
              <div><span className="text-slate-500">Inquiry Ref:</span> {inquiry?.inquiry_no ?? "—"}</div>
              <div><span className="text-slate-500">Quotation:</span> {quote.quote_no}</div>
            </div>
          </div>

          {/* Items — PL hides prices, per the document's actual purpose */}
          <table className="mt-5 w-full border-collapse text-sm">
            <thead>
              <tr className="border-y border-slate-800 bg-slate-50 text-left text-[11px] uppercase tracking-wide">
                <th className="px-2 py-1.5">#</th>
                <th className="px-2 py-1.5">Description</th>
                <th className="px-2 py-1.5">HSN</th>
                <th className="px-2 py-1.5 text-right">Qty</th>
                <th className="px-2 py-1.5">Unit</th>
                {doc.doc_kind !== "PL" && <th className="px-2 py-1.5 text-right">Rate</th>}
                {doc.doc_kind !== "PL" && <th className="px-2 py-1.5 text-right">Amount</th>}
              </tr>
            </thead>
            <tbody>
              {(items ?? []).map((it, i) => (
                <tr key={it.id} className="border-b border-slate-200">
                  <td className="px-2 py-1.5 text-slate-500">{i + 1}</td>
                  <td className="px-2 py-1.5">{it.description}</td>
                  <td className="px-2 py-1.5 text-slate-600">{it.hsn_code ?? "—"}</td>
                  <td className="px-2 py-1.5 text-right">{it.qty}</td>
                  <td className="px-2 py-1.5">{it.unit ?? "pcs"}</td>
                  {doc.doc_kind !== "PL" && <td className="px-2 py-1.5 text-right">{money(it.unit_price, quote.currency)}</td>}
                  {doc.doc_kind !== "PL" && <td className="px-2 py-1.5 text-right">{money(it.line_total, quote.currency)}</td>}
                </tr>
              ))}
              {(items ?? []).length === 0 && (
                <tr><td colSpan={7} className="px-2 py-4 text-center text-slate-400">No items on this quotation.</td></tr>
              )}
            </tbody>
          </table>

          {/* Totals — not on PL */}
          {doc.doc_kind !== "PL" && (
            <div className="mt-4 flex justify-end">
              <table className="w-64 text-sm">
                <tbody>
                  <tr><td className="py-1 text-slate-500">Subtotal</td><td className="py-1 text-right">{money(subtotal, quote.currency)}</td></tr>
                  <tr><td className="py-1 text-slate-500">Tax ({quote.tax_percent}%)</td><td className="py-1 text-right">{money(taxAmount, quote.currency)}</td></tr>
                  <tr><td className="py-1 text-slate-500">Shipping</td><td className="py-1 text-right">{money(quote.shipping_amount, quote.currency)}</td></tr>
                  <tr className="border-t-2 border-slate-800 font-bold"><td className="py-1">TOTAL</td><td className="py-1 text-right">{money(total, quote.currency)}</td></tr>
                </tbody>
              </table>
            </div>
          )}

          {/* PL-specific: total quantity declaration */}
          {doc.doc_kind === "PL" && (
            <div className="mt-4 rounded border border-slate-300 px-4 py-2 text-sm">
              <strong>Total Quantity:</strong> {totalQty} {(items ?? [])[0]?.unit ?? "pcs"} across {(items ?? []).length} line(s)
            </div>
          )}

          {quote.terms && doc.doc_kind !== "PL" && (
            <div className="mt-5 text-xs">
              <div className="font-semibold uppercase tracking-wide text-slate-500">Terms &amp; Conditions</div>
              <p className="mt-1 whitespace-pre-line text-slate-700">{quote.terms}</p>
            </div>
          )}

          {/* Signature blocks */}
          <div className="mt-10 grid grid-cols-2 gap-8 text-xs">
            <div className="border-t border-slate-400 pt-1 text-center text-slate-500">Buyer&apos;s Signature</div>
            <div className="border-t border-slate-400 pt-1 text-center text-slate-500">For {company?.name ?? "Nykomart"}</div>
          </div>
        </div>
      </PrintArea>
    </div>
  );
}
