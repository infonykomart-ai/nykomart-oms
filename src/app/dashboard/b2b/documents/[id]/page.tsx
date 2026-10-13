import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";
import { amountInWords, formatDocMoney } from "@/lib/b2b/money-format";
import { recordDocumentPrinted } from "../../actions";

// 2026-09-30 — the printable A4 face of every issued B2B commercial
// document. One page, three faces (doc_kind): PI = Proforma Invoice,
// CI = Commercial Invoice, PL = Packing List. Layout follows the same A4
// conventions as every other printable in this app (PrintArea + shared
// branding footer + window.print()).
//
// Opening this page IS the "print" event: printed_count increments once
// per render via recordDocumentPrinted (fire-and-forget, never blocks).
//
// 2026-10-13 — the PI review ("Total amount ka format galat hai / seller
// ki complete details missing hain / buyer ka complete address missing
// hai / product specifications incomplete hain / payment terms adhure
// hain / shipping aur delivery terms missing hain / bank details missing
// hain"). The document now prints the full international layout:
//   • Money: ISO code + international grouping (USD 2,800,000.00 — NOT
//     en-IN's $28,00,000.00) plus AMOUNT IN WORDS under the total, via
//     the shared lib/b2b/money-format helpers.
//   • 8 labeled sections: Seller/Exporter details (address, IEC, PAN,
//     GSTIN, email, phone — from the company row), Buyer details (full
//     address), Product description & pricing (with specifications and
//     HSN), Payment terms, Shipping & delivery terms (incoterm, ports,
//     delivery period, partial shipment, transshipment, freight &
//     insurance), Terms & conditions, Seller's bank details,
//     Authorization.
//   • Every unknown fact prints "To be provided" / "To be confirmed" —
//     the app never invents addresses, bank details, ports or trade
//     terms. Shipping 0.00 prints "To be confirmed" (free delivery is
//     never assumed) and a 0% export tax prints "To be confirmed"
//     (zero-rated treatment must be verified, not assumed).

const DOC_TITLES: Record<string, { title: string; subtitle: string }> = {
  PI: { title: "PROFORMA INVOICE", subtitle: "Proforma Invoice — advance payment / buyer-bank processing" },
  CI: { title: "COMMERCIAL INVOICE", subtitle: "Commercial Invoice — final bill of sale" },
  PL: { title: "PACKING LIST", subtitle: "Packing List — package-wise contents" },
};

const COPY_MARKS: Record<number, string> = {
  1: "ORIGINAL",
  2: "DUPLICATE",
  3: "TRIPLICATE",
};

const NOT_PROVIDED = "To be provided";
const TO_BE_CONFIRMED = "To be confirmed";

// Shipping lines printed when the quotation has none — every fact stays
// "To be confirmed" until actually agreed (mirrors the review's own draft).
const DEFAULT_SHIPPING_LINES = [
  "Port of Loading: To be confirmed",
  "Port of Destination: To be confirmed",
  "Delivery Period: To be mutually agreed",
  "Partial Shipment: To be agreed",
  "Transshipment: To be agreed",
  "Freight and Insurance Responsibility: As per the agreed Incoterm",
  "Packaging: To be confirmed",
];

function fmtDate(v: string | null): string {
  if (!v) return "—";
  const d = new Date(v.length === 10 ? v + "T00:00:00" : v);
  return isNaN(d.getTime()) ? v : d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function money(n: number, currency: string): string {
  return formatDocMoney(n, currency);
}

// Quantities print international-grouped too (2,000,000 — not 2000000).
function fmtQty(n: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 3 }).format(n);
}

// "Label: value" lines become labeled rows; free lines print as-is.
function splitLine(line: string): { label: string | null; value: string } {
  const idx = line.indexOf(":");
  if (idx <= 0) return { label: null, value: line };
  return { label: line.slice(0, idx).trim(), value: line.slice(idx + 1).trim() || "—" };
}

function Section({ no, title, children }: { no: number; title: string; children: ReactNode }) {
  return (
    <section className="mt-5 border-t border-slate-300 pt-3">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-800">
        {no}. {title}
      </h3>
      <div className="mt-2 space-y-1">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex gap-2 text-[13px] leading-5">
      <span className="w-52 shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 flex-1 whitespace-pre-line text-slate-800">{value}</span>
    </div>
  );
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

  // select("*") on companies/inquiries: the 2026-10-13 columns print
  // "To be provided" when the migration hasn't run yet instead of the
  // whole page erroring on an unknown column.
  const [{ data: items }, { data: company }, { data: inquiry }] = await Promise.all([
    supabase.from("b2b_quotation_items").select("*").eq("quotation_id", quote.id).order("display_order"),
    supabase.from("companies").select("*").eq("id", quote.company_id).maybeSingle(),
    supabase.from("b2b_inquiries").select("*").eq("id", quote.inquiry_id).maybeSingle(),
  ]);

  // Fire-and-forget print telemetry — awaited so Vercel doesn't freeze the
  // function mid-write, but failures are ignored by design.
  await recordDocumentPrinted(doc.id);

  const meta = DOC_TITLES[doc.doc_kind] ?? { title: doc.doc_kind, subtitle: "" };
  const isPI = doc.doc_kind === "PI";
  const isPackingList = doc.doc_kind === "PL";
  const currency = quote.currency || "INR";

  const subtotal = (items ?? []).reduce((s, it) => s + (it.line_total ?? 0), 0);
  const taxAmount = Math.round(subtotal * quote.tax_percent) / 100;
  const total = Math.round((subtotal * (1 + quote.tax_percent / 100) + quote.shipping_amount) * 100) / 100;
  const totalQty = (items ?? []).reduce((s, it) => s + it.qty, 0);
  const copyMark = COPY_MARKS[doc.copy_no] ?? `COPY ${doc.copy_no}`;

  // Money display rules (see the header comment): a zero export tax or a
  // zero shipping amount means "not decided yet", never "free/0%".
  const isExport = currency !== "INR";
  const taxLabel = quote.tax_percent > 0 ? `Tax (${quote.tax_percent}%)` : isExport ? "GST / Export Tax" : "Tax (0%)";
  const taxDisplay =
    quote.tax_percent > 0 ? money(taxAmount, currency) : isExport ? TO_BE_CONFIRMED : money(0, currency);
  const shippingKnown = quote.shipping_amount > 0;
  const shippingDisplay = shippingKnown ? money(quote.shipping_amount, currency) : TO_BE_CONFIRMED;

  const shippingLines = quote.shipping_terms?.trim()
    ? quote.shipping_terms.trim().split("\n").map((l) => l.trim()).filter(Boolean)
    : DEFAULT_SHIPPING_LINES;

  const seller = {
    address: company?.business_address ?? null,
    iec: company?.iec_no ?? null,
    pan: company?.pan_no ?? null,
    gstin: company?.gstin ?? null,
    email: company?.business_email ?? null,
    phone: company?.business_phone ?? null,
  };
  const buyerAddress = quote.buyer_address || inquiry?.buyer_address || null;

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
            <div className="space-y-0.5">
              <div>
                <span className="text-slate-500">{isPI ? "Proforma Invoice No:" : "Document No:"}</span>{" "}
                <strong>{doc.doc_no}</strong>
              </div>
              <div><span className="text-slate-500">Date:</span> {fmtDate(doc.doc_date)}</div>
              {quote.valid_until && <div><span className="text-slate-500">Valid Until:</span> {fmtDate(quote.valid_until)}</div>}
              <div><span className="text-slate-500">Inquiry Reference:</span> {inquiry?.inquiry_no ?? "—"}</div>
              <div><span className="text-slate-500">Quotation Reference:</span> {quote.quote_no}</div>
            </div>
            <div className="space-y-0.5 text-right">
              <div><span className="text-slate-500">Buyer:</span> <strong>{quote.buyer_name}</strong></div>
              {inquiry?.buyer_company && <div>{inquiry.buyer_company}</div>}
              {quote.buyer_country && <div className="text-slate-600">Destination: {quote.buyer_country}</div>}
            </div>
          </div>

          {isPI && (
            <div className="mt-3 rounded border border-sky-100 bg-sky-50 px-3 py-1.5 text-[11px] text-sky-800">
              <strong>Purpose:</strong> Proforma invoice for advance payment and buyer-bank processing. Not a final
              Commercial Invoice or proof of payment.
            </div>
          )}

          {/* 1. SELLER / EXPORTER DETAILS */}
          <Section no={1} title="Seller / Exporter Details">
            <Row label="Company Name" value={company?.name ?? "Nykomart"} />
            <Row label="Registered / Business Address" value={seller.address || NOT_PROVIDED} />
            <Row label="Country" value="India" />
            <Row label="IEC (Importer Exporter Code)" value={seller.iec || `${NOT_PROVIDED}, if applicable`} />
            <Row label="PAN" value={seller.pan || NOT_PROVIDED} />
            <Row label="GSTIN" value={seller.gstin || `${TO_BE_CONFIRMED}, where applicable`} />
            <Row label="Business Email" value={seller.email || NOT_PROVIDED} />
            <Row label="Telephone" value={seller.phone || NOT_PROVIDED} />
          </Section>

          {/* 2. BUYER DETAILS */}
          <Section no={2} title="Buyer Details">
            <Row label="Buyer / Contact Person" value={quote.buyer_name} />
            {inquiry?.buyer_company && <Row label="Organization" value={inquiry.buyer_company} />}
            <Row label="Address" value={buyerAddress || NOT_PROVIDED} />
            {quote.buyer_contact_no && <Row label="Telephone" value={quote.buyer_contact_no} />}
            {quote.buyer_email && <Row label="Email" value={quote.buyer_email} />}
            <Row label="Country of Destination" value={quote.buyer_country || TO_BE_CONFIRMED} />
          </Section>

          {/* 3. PRODUCT DESCRIPTION & PRICING (PL: packing details, no prices) */}
          <Section no={3} title={isPackingList ? "Packing Details" : "Product Description & Pricing"}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-y border-slate-800 bg-slate-50 text-left text-[11px] uppercase tracking-wide">
                  <th className="px-2 py-1.5">#</th>
                  <th className="px-2 py-1.5">Description</th>
                  <th className="px-2 py-1.5">HSN Code*</th>
                  <th className="px-2 py-1.5 text-right">Quantity</th>
                  <th className="px-2 py-1.5">Unit</th>
                  {!isPackingList && <th className="px-2 py-1.5 text-right">Unit Price</th>}
                  {!isPackingList && <th className="px-2 py-1.5 text-right">Total Amount</th>}
                </tr>
              </thead>
              <tbody>
                {(items ?? []).map((it, i) => (
                  <tr key={it.id} className="border-b border-slate-200">
                    <td className="px-2 py-1.5 text-slate-500">{i + 1}</td>
                    <td className="px-2 py-1.5">{it.description}</td>
                    <td className="px-2 py-1.5 text-slate-600">{it.hsn_code ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right">{fmtQty(it.qty)}</td>
                    <td className="px-2 py-1.5">{it.unit ?? "pcs"}</td>
                    {!isPackingList && <td className="px-2 py-1.5 text-right">{money(it.unit_price, currency)}</td>}
                    {!isPackingList && <td className="px-2 py-1.5 text-right">{money(it.line_total ?? 0, currency)}</td>}
                  </tr>
                ))}
                {(items ?? []).length === 0 && (
                  <tr><td colSpan={7} className="px-2 py-4 text-center text-slate-400">No items on this quotation.</td></tr>
                )}
              </tbody>
            </table>

            {!isPackingList && (
              <div className="mt-3 border border-slate-200 bg-slate-50/60 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Product Specifications</div>
                <p className="mt-1 whitespace-pre-line text-[13px] text-slate-800">
                  {quote.product_specs?.trim() || `${TO_BE_CONFIRMED} with the buyer before production.`}
                </p>
              </div>
            )}

            {/* Totals — not on PL */}
            {!isPackingList && (
              <div className="mt-4 flex flex-col items-end gap-3">
                <table className="w-72 text-sm">
                  <tbody>
                    <tr><td className="py-1 text-slate-500">Subtotal</td><td className="py-1 text-right">{money(subtotal, currency)}</td></tr>
                    <tr>
                      <td className="py-1 text-slate-500">{taxLabel}</td>
                      <td className="py-1 text-right">{taxDisplay}</td>
                    </tr>
                    <tr>
                      <td className="py-1 text-slate-500">Shipping &amp; Freight</td>
                      <td className="py-1 text-right">{shippingDisplay}</td>
                    </tr>
                    <tr className="border-t-2 border-slate-800 font-bold">
                      <td className="py-1">{isPI ? "TOTAL PROFORMA INVOICE VALUE" : "TOTAL"}</td>
                      <td className="py-1 text-right">{money(total, currency)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="w-full text-[13px]">
                  <span className="font-semibold">Amount in Words:</span>{" "}
                  <span className="italic">{amountInWords(total, currency)}</span>
                </div>
                <div className="w-full space-y-1 text-[11px] leading-4 text-slate-600">
                  <p>
                    The above total is the product value only, before any additional shipping, insurance, or other
                    applicable charges{shippingKnown ? "" : " — Shipping &amp; Freight is to be confirmed"}.
                  </p>
                  {isPI && (
                    <p>
                      * HSN classification and the applicable export tax treatment must be verified with the customs
                      broker / tax professional before issuance.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* PL-specific: total quantity declaration */}
            {isPackingList && (
              <div className="mt-4 rounded border border-slate-300 px-4 py-2 text-sm">
                <strong>Total Quantity:</strong> {fmtQty(totalQty)} {(items ?? [])[0]?.unit ?? "pcs"} across{" "}
                {(items ?? []).length} line(s)
              </div>
            )}
          </Section>

          {/* 4. PAYMENT TERMS */}
          {!isPackingList && (
            <Section no={4} title="Payment Terms">
              <p className="whitespace-pre-line text-[13px] text-slate-800">
                {quote.payment_terms?.trim() || `${TO_BE_CONFIRMED} by buyer and seller.`}
              </p>
              <div className="mt-2 flex gap-2 text-[13px] font-semibold">
                <span className="w-52 shrink-0 text-slate-500">Total Payable as per this document</span>
                <span>{money(total, currency)}</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Excluding any subsequently agreed additional charges (shipping, insurance, duties, bank charges).
              </p>
            </Section>
          )}

          {/* 5. SHIPPING & DELIVERY TERMS */}
          {!isPackingList && (
            <Section no={5} title="Shipping & Delivery Terms">
              <Row label="Incoterm" value={quote.incoterm || TO_BE_CONFIRMED} />
              <Row label="Country of Origin" value="India" />
              <Row label="Country of Destination" value={quote.buyer_country || TO_BE_CONFIRMED} />
              {shippingLines.map((line, i) => {
                const { label, value } = splitLine(line);
                return label ? (
                  <Row key={i} label={label} value={value} />
                ) : (
                  <p key={i} className="text-[13px] text-slate-800">{line}</p>
                );
              })}
            </Section>
          )}

          {/* 6. TERMS & CONDITIONS */}
          {!isPackingList && (quote.terms || isPI) && (
            <Section no={6} title="Terms & Conditions">
              {quote.terms && <p className="whitespace-pre-line text-[13px] text-slate-800">{quote.terms}</p>}
              {isPI && (
                <ul className="list-disc space-y-1 pl-5 text-[13px] text-slate-800">
                  <li>
                    This Proforma Invoice is issued for order confirmation, advance payment arrangements, and
                    buyer-bank processing.
                  </li>
                  <li>
                    Production and/or dispatch arrangements will proceed as per the mutually agreed purchase order,
                    payment confirmation, and production schedule.
                  </li>
                  <li>Any additional freight, insurance, taxes, duties, or bank charges follow the final agreed commercial terms.</li>
                  <li>This Proforma Invoice is not a final Commercial Invoice or proof that payment has been received.</li>
                  {quote.valid_until && (
                    <li>
                      Valid until {fmtDate(quote.valid_until)}, subject to the stated terms and availability of the goods.
                    </li>
                  )}
                </ul>
              )}
            </Section>
          )}

          {/* 7. SELLER'S BANK DETAILS */}
          {!isPackingList && (
            <Section no={7} title="Seller&apos;s Bank Details">
              {quote.bank_details?.trim() ? (
                quote.bank_details.trim().split("\n").map((raw, i) => {
                  const line = raw.trim();
                  if (!line) return null;
                  const { label, value } = splitLine(line);
                  return label ? (
                    <Row key={i} label={label} value={value} />
                  ) : (
                    <p key={i} className="text-[13px] text-slate-800">{line}</p>
                  );
                })
              ) : (
                <p className="text-[13px] text-slate-800">
                  {NOT_PROVIDED} here — beneficiary bank details will be shared separately by the seller and must be
                  verified with the bank before any remittance.
                </p>
              )}
            </Section>
          )}

          {/* 8. AUTHORIZATION + buyer signature */}
          <div className="mt-8 grid grid-cols-2 gap-8 text-xs">
            <div>
              <div className="border-t border-slate-400 pt-1 text-center text-slate-500">Buyer&apos;s Signature</div>
              <div className="mt-10 space-y-4 text-slate-600">
                <div className="border-t border-slate-300 pt-1">Name / Date</div>
              </div>
            </div>
            <div>
              <div className="border-t border-slate-400 pt-1 text-center font-semibold text-slate-700">
                For and on behalf of {company?.name ?? "Nykomart"}
              </div>
              <div className="mt-6 space-y-3 text-slate-600">
                <div className="border-t border-slate-300 pt-1">Authorized Signatory</div>
                <div className="border-t border-slate-300 pt-1">Name</div>
                <div className="border-t border-slate-300 pt-1">Designation</div>
                <div className="border-t border-slate-300 pt-1">Date</div>
                <div className="border-t border-slate-300 pt-1">Company Stamp</div>
              </div>
            </div>
          </div>
        </div>
      </PrintArea>
    </div>
  );
}
