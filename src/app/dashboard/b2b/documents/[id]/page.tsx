import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { PrintArea, PrintButton } from "@/components/print-view";
// 2026-10-15 — merged BOTH 2026-10-13 PI rebuilds: the money/words helpers
// come from lib/b2b/money-format (ISO code + international grouping, INR
// lakh-words) and the SIZE × QTY dimension helpers from lib/b2b/erp, so the
// document prints both the complete international layout AND the per-line
// sq ft / sq mtr / CBM figures.
import { amountInWords, formatDocMoney } from "@/lib/b2b/money-format";
import { computeItemDims, formatDims, parseSizeSpec } from "@/lib/b2b/erp";
import { recordDocumentPrinted } from "../../actions";

// 2026-09-30 — the printable A4 face of every issued B2B commercial
// document. One page, three faces (doc_kind): PI = Proforma Invoice,
// CI = Commercial Invoice, PL = Packing List.
//
// 2026-10-13 — rebuilt end to end after a CA-style review of a real PI
// ("Total amount ka format galat hai / seller ki complete details missing
// hain / buyer ka complete address missing hai / product specifications
// incomplete hain / payment terms adhure hain / shipping aur delivery
// terms missing hain / bank details missing hain"). 8 numbered sections,
// "To be provided"/"To be confirmed" for every unknown fact (nothing is
// invented), amount in words under the total, and a compact one-A4 layout
// ("pi invoice vagera ek page me aaye").
//
// 2026-10-15 — the same feature had been built twice on two machines, so
// this file now prints BOTH sides of it:
//   • SELLER + bank block: the editable b2b_export_profiles row first
//     (2026-10-13 PI export round — the client can edit it), falling back
//     to the companies columns (business_address / iec_no / pan_no / gstin /
//     business_email / business_phone) added by
//     db/2026-10-13-b2b-pi-export-details.sql, then "To be provided".
//   • PAYMENT / SHIPPING: the structured quotation columns (payment_
//     condition/method/due_note, bank_charges, port_of_loading, delivery_
//     period, partial_shipment, transshipment, freight_insurance, packing_
//     details, country_of_origin) AND the free-text payment_terms /
//     shipping_terms blocks — free lines whose label is already covered by
//     a structured row are dropped so nothing prints twice; when neither is
//     set, DEFAULT_SHIPPING_LINES keeps every fact "To be confirmed".
//   • ITEMS: per-line specs (size / material / manufacturing / colour /
//     packaging) + the 📐 SIZE × QTY dimension line, plus the quotation's
//     own product_specs block.
//   • MONEY: tax_note / shipping_note print INSTEAD of the numeric rows
//     when set (a pending quotation says "To be confirmed", never $0.00).
//
// Opening this page IS the "print" event: printed_count increments once
// per render via recordDocumentPrinted (fire-and-forget, never blocks).

const DOC_TITLES: Record<string, { title: string; subtitle: string }> = {
  PI: { title: "PROFORMA INVOICE", subtitle: "Proforma Invoice — advance payment / buyer-bank processing" },
  CI: { title: "COMMERCIAL INVOICE", subtitle: "Commercial Invoice — final bill of sale" },
  PL: { title: "PACKING LIST", subtitle: "Packing List — package-wise contents" },
};

const COPY_MARKS: Record<number, string> = {
  1: "ORIGINAL",
  2: "DUPLICATE",
  3: "TRIPPLICATE",
};

const NOT_PROVIDED = "To be provided";
const TO_BE_CONFIRMED = "To be confirmed";

// Shipping lines printed when the quotation has neither the structured
// columns nor the free-text shipping_terms block — every fact stays
// "To be confirmed" until actually agreed.
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

/** label/value row used by the payment & shipping grids; skips empty values. */
function KV({ k, v }: { k: string; v: string | null | undefined }) {
  if (!v) return null;
  return (
    <div className="flex gap-1">
      <span className="shrink-0 font-semibold text-slate-600">{k}:</span>
      <span className="text-slate-800">{v}</span>
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
  // whole page erroring on an unknown column. The export profile is a
  // separate query so a missing b2b_export_profiles table only empties
  // the seller block (the companies fallback below still prints).
  const [{ data: items }, { data: company }, { data: inquiry }, { data: profile }] = await Promise.all([
    supabase.from("b2b_quotation_items").select("*").eq("quotation_id", quote.id).order("display_order"),
    supabase.from("companies").select("*").eq("id", quote.company_id).maybeSingle(),
    supabase.from("b2b_inquiries").select("*").eq("id", quote.inquiry_id).maybeSingle(),
    // Seller + bank block — missing until the export profile is filled
    // (or the 2026-10-13 migration hasn't run); degrades to "To be provided".
    supabase
      .from("b2b_export_profiles")
      .select("*")
      .eq("company_id", quote.company_id)
      .maybeSingle()
      .then((r) => r, () => ({ data: null })),
  ]);

  // Fire-and-forget print telemetry — awaited so Vercel doesn't freeze the
  // function mid-write, but failures are ignored by design.
  await recordDocumentPrinted(doc.id);

  const meta = DOC_TITLES[doc.doc_kind] ?? { title: doc.doc_kind, subtitle: "" };
  const isPI = doc.doc_kind === "PI";
  const isPL = doc.doc_kind === "PL";
  const currency = quote.currency || "INR";
  const cur = currency;

  const subtotal = (items ?? []).reduce((s, it) => s + (it.line_total ?? 0), 0);
  const taxAmount = Math.round(subtotal * quote.tax_percent) / 100;
  const total = Math.round((subtotal * (1 + quote.tax_percent / 100) + quote.shipping_amount) * 100) / 100;
  const totalQty = (items ?? []).reduce((s, it) => s + it.qty, 0);
  const copyMark = COPY_MARKS[doc.copy_no] ?? `COPY ${doc.copy_no}`;
  const companyName = company?.name ?? "Nykomart";

  // Bank details present at all? (the whole block hides when nothing saved)
  const bankAny = profile && [profile.bank_beneficiary, profile.bank_name, profile.bank_branch, profile.bank_account, profile.bank_swift].some(Boolean);

  // Money display rules (see the header comment): a zero export tax or a
  // zero shipping amount means "not decided yet", never "free/0%". The
  // *_note columns win when set — same rule, one implementation.
  const isExport = cur !== "INR";
  const taxNote = quote.tax_note?.trim() || null;
  const shippingNote = quote.shipping_note?.trim() || null;
  const taxLabel = taxNote
    ? "Tax / Export Tax"
    : quote.tax_percent > 0
      ? `Tax (${quote.tax_percent}%)`
      : isExport
        ? "GST / Export Tax"
        : "Tax (0%)";
  const taxDisplay =
    taxNote ?? (quote.tax_percent > 0 ? money(taxAmount, cur) : isExport ? TO_BE_CONFIRMED : money(0, cur));
  const shippingKnown = quote.shipping_amount > 0;
  const shippingDisplay = shippingNote ?? (shippingKnown ? money(quote.shipping_amount, cur) : TO_BE_CONFIRMED);

  // Seller block — editable export profile first, companies columns second.
  const seller = {
    address: profile?.seller_address || company?.business_address || null,
    iec: profile?.iec || company?.iec_no || null,
    pan: profile?.pan || company?.pan_no || null,
    gstin: profile?.gstin || company?.gstin || null,
    email: profile?.email || company?.business_email || null,
    phone: profile?.phone || company?.business_phone || null,
  };
  const buyerAddress = quote.buyer_address || inquiry?.buyer_address || null;

  // Shipping: structured columns first, free-text lines for anything they
  // don't already cover (deduped by label so nothing prints twice), and
  // the all-"To be confirmed" defaults only when both are empty.
  const structuredShipping: { label: string; value: string }[] = [
    { label: "Incoterm", value: quote.incoterm ?? "" },
    { label: "Port of Loading", value: quote.port_of_loading ?? "" },
    { label: "Port of Destination", value: quote.port_of_destination ?? "" },
    { label: "Delivery Period", value: quote.delivery_period ?? "" },
    { label: "Partial Shipment", value: quote.partial_shipment ?? "" },
    { label: "Transshipment", value: quote.transshipment ?? "" },
    { label: "Freight and Insurance Responsibility", value: quote.freight_insurance ?? "" },
    { label: "Packaging", value: quote.packing_details ?? "" },
    { label: "Country of Origin", value: quote.country_of_origin ?? "" },
  ].filter((r) => r.value.trim());
  const freeShippingLines = (quote.shipping_terms ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => splitLine(line))
    .filter((l) => !structuredShipping.some((s) => s.label.toLowerCase() === (l.label ?? "").toLowerCase()));
  const shippingRows: { label: string | null; value: string }[] =
    structuredShipping.length || freeShippingLines.length
      ? [...structuredShipping, ...freeShippingLines]
      : DEFAULT_SHIPPING_LINES.map((line) => splitLine(line));

  // Payment: the structured columns, the free-text block, or the fallback.
  const paymentRows = [
    { k: "Condition", v: quote.payment_condition?.trim() ?? "" },
    { k: "Method", v: quote.payment_method?.trim() ?? "" },
    { k: "Payment Due", v: quote.payment_due_note?.trim() ?? "" },
    { k: "Bank Charges", v: quote.bank_charges?.trim() ?? "" },
  ].filter((r) => r.v);
  const paymentText = quote.payment_terms?.trim() || null;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-3 flex items-center justify-between print:hidden">
        <a href="/dashboard/b2b" className="text-sm text-slate-500 hover:underline">← Back to B2B Inquiries</a>
        <PrintButton label={`🖨 Print / Save ${doc.doc_kind} PDF`} />
      </div>

      <PrintArea id={`b2b-doc-${doc.id}`} companyName={company?.name ?? undefined} companyLogoUrl={company?.logo_url}>
        {/* Compact A4 sheet — text-[10px]/[11px] + tight paddings so a
            typical 1–3 line PI with every section fits ONE page. */}
        <div className="rounded border border-slate-300 bg-white p-5 text-[11px] leading-snug text-slate-900">
          {/* ── Letterhead + seller block ──────────────────────────────── */}
          <div className="flex items-start justify-between gap-4 border-b-2 border-slate-800 pb-2">
            <div className="flex items-start gap-2.5">
              {company?.logo_url && (
                // eslint-disable-next-line @next/next/no-img-element -- print output
                <img src={company.logo_url} alt="" className="h-12 w-12 rounded object-contain" />
              )}
              <div>
                <div className="text-base font-bold tracking-wide">{companyName}</div>
                <div className="whitespace-pre-line text-[10px] text-slate-600">
                  {seller.address ?? "Export House · India"}
                </div>
                <div className="mt-0.5 text-[10px] text-slate-600">
                  {[
                    seller.iec && `IEC: ${seller.iec}`,
                    seller.pan && `PAN: ${seller.pan}`,
                    seller.gstin && `GSTIN: ${seller.gstin}`,
                  ].filter(Boolean).join("  ·  ") || "IEC / PAN / GSTIN: To be provided"}
                </div>
                <div className="text-[10px] text-slate-600">
                  {[
                    seller.email && `Email: ${seller.email}`,
                    seller.phone && `Phone: ${seller.phone}`,
                  ].filter(Boolean).join("  ·  ") || "Email / Phone: To be provided"}
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold tracking-wide">{meta.title}</div>
              <div className="text-[9px] text-slate-500">{meta.subtitle}</div>
              <div className="mt-1 inline-block rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-600">{copyMark}</div>
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
              <strong>Purpose:</strong>{" "}
              {quote.purpose?.trim() ||
                "Proforma invoice for advance payment and buyer-bank processing. Not a final Commercial Invoice or proof of payment."}
            </div>
          )}

          {/* 1. SELLER / EXPORTER DETAILS */}
          <Section no={1} title="Seller / Exporter Details">
            <Row label="Company Name" value={companyName} />
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
            {quote.buyer_attention && <Row label="Attention" value={quote.buyer_attention} />}
            <Row label="Address" value={buyerAddress || NOT_PROVIDED} />
            {quote.buyer_contact_no && <Row label="Telephone" value={quote.buyer_contact_no} />}
            {quote.buyer_email && <Row label="Email" value={quote.buyer_email} />}
            <Row label="Country of Destination" value={quote.buyer_country || TO_BE_CONFIRMED} />
          </Section>

          {/* 3. PRODUCT DESCRIPTION & PRICING (PL: packing details, no prices) */}
          <Section no={3} title={isPL ? "Packing Details" : "Product Description & Pricing"}>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-y border-slate-800 bg-slate-50 text-left text-[11px] uppercase tracking-wide">
                  <th className="px-2 py-1.5">#</th>
                  <th className="px-2 py-1.5">Description &amp; Specifications</th>
                  <th className="px-2 py-1.5">HSN Code*</th>
                  <th className="px-2 py-1.5 text-right">Quantity</th>
                  <th className="px-2 py-1.5">Unit</th>
                  {!isPL && <th className="px-2 py-1.5 text-right">Unit Price</th>}
                  {!isPL && <th className="px-2 py-1.5 text-right">Total Amount</th>}
                </tr>
              </thead>
              <tbody>
                {(items ?? []).map((it, i) => {
                  const specs = [it.size, it.material, it.manufacturing, it.colour_design, it.packaging].filter(Boolean);
                  // 2026-10-13 r2 — the SIZE × QTY formula, recomputed here with
                  // the same computeItemDims the quote form preview + stored
                  // dims use, so the document's sq ft / sq mtr / CBM line can
                  // never disagree with the quotation screen.
                  const parsedSize = parseSizeSpec(it.size ?? "");
                  const dims = parsedSize
                    ? formatDims(
                        computeItemDims({ qty: it.qty, length: parsedSize.length, width: parsedSize.width, thickness: parsedSize.thickness, unit: parsedSize.unit })
                      )
                    : null;
                  return (
                    <tr key={it.id} className="border-b border-slate-200 align-top">
                      <td className="px-2 py-1.5 text-slate-500">{i + 1}</td>
                      <td className="px-2 py-1.5">
                        {it.description}
                        {specs.length > 0 && <div className="text-[10px] text-slate-500">{specs.join("  ·  ")}</div>}
                        {dims && <div className="text-[10px] font-medium text-emerald-800">📐 {dims}</div>}
                      </td>
                      <td className="px-2 py-1.5 text-slate-600">{it.hsn_code ?? "—"}</td>
                      <td className="px-2 py-1.5 text-right">{fmtQty(it.qty)}</td>
                      <td className="px-2 py-1.5">{it.unit ?? "pcs"}</td>
                      {!isPL && <td className="px-2 py-1.5 text-right">{money(it.unit_price, cur)}</td>}
                      {!isPL && <td className="px-2 py-1.5 text-right">{money(it.line_total ?? 0, cur)}</td>}
                    </tr>
                  );
                })}
                {(items ?? []).length === 0 && (
                  <tr><td colSpan={7} className="px-2 py-4 text-center text-slate-400">No items on this quotation.</td></tr>
                )}
              </tbody>
            </table>

            {!isPL && quote.product_specs?.trim() && (
              <div className="mt-3 border border-slate-200 bg-slate-50/60 px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Product Specifications</div>
                <p className="mt-1 whitespace-pre-line text-[13px] text-slate-800">{quote.product_specs.trim()}</p>
              </div>
            )}

            {/* Totals — not on PL */}
            {!isPL && (
              <div className="mt-4 flex flex-col items-end gap-3">
                <table className="w-72 text-sm">
                  <tbody>
                    <tr><td className="py-1 text-slate-500">Subtotal</td><td className="py-1 text-right">{money(subtotal, cur)}</td></tr>
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
                      <td className="py-1 text-right">{money(total, cur)}</td>
                    </tr>
                  </tbody>
                </table>
                <div className="w-full text-[13px]">
                  <span className="font-semibold">Amount in Words:</span>{" "}
                  <span className="italic">{amountInWords(total, cur)}</span>
                </div>
                <div className="w-full space-y-1 text-[11px] leading-4 text-slate-600">
                  <p>
                    The above total is the product value only, before any additional shipping, insurance, or other
                    applicable charges{!shippingKnown && !shippingNote ? " — Shipping &amp; Freight is to be confirmed" : ""}.
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
            {isPL && (
              <div className="mt-4 rounded border border-slate-300 px-4 py-2 text-sm">
                <strong>Total Quantity:</strong> {fmtQty(totalQty)} {(items ?? [])[0]?.unit ?? "pcs"} across{" "}
                {(items ?? []).length} line(s)
              </div>
            )}
          </Section>

          {/* 4. PAYMENT TERMS */}
          {!isPL && (
            <Section no={4} title="Payment Terms">
              {paymentRows.length > 0 && (
                <div className="space-y-0.5">
                  {paymentRows.map((r) => (
                    <KV key={r.k} k={r.k} v={r.v} />
                  ))}
                </div>
              )}
              <p className="whitespace-pre-line text-[13px] text-slate-800">
                {paymentText || (paymentRows.length > 0 ? "" : `${TO_BE_CONFIRMED} by buyer and seller.`)}
              </p>
              {quote.payment_instructions && (
                <p className="whitespace-pre-line text-[12px] text-slate-700">
                  <span className="font-semibold">Payment Instructions: </span>
                  {quote.payment_instructions}
                </p>
              )}
              <div className="mt-2 flex gap-2 text-[13px] font-semibold">
                <span className="w-52 shrink-0 text-slate-500">Total Payable as per this document</span>
                <span>{money(total, cur)}</span>
              </div>
              <p className="text-[11px] text-slate-500">
                Excluding any subsequently agreed additional charges (shipping, insurance, duties, bank charges).
              </p>
            </Section>
          )}

          {/* 5. SHIPPING & DELIVERY TERMS */}
          {!isPL && (
            <Section no={5} title="Shipping & Delivery Terms">
              <Row label="Country of Origin" value={structuredShipping.find((r) => r.label === "Country of Origin")?.value || "India"} />
              {shippingRows
                .filter((r) => r.label !== "Country of Origin")
                .map((row, i) =>
                  row.label ? (
                    <Row key={i} label={row.label} value={row.value} />
                  ) : (
                    <p key={i} className="text-[13px] text-slate-800">{row.value}</p>
                  )
                )}
            </Section>
          )}

          {/* 6. TERMS & CONDITIONS */}
          {!isPL && (quote.terms || quote.notes || isPI) && (
            <Section no={6} title="Terms & Conditions">
              {quote.terms && <p className="whitespace-pre-line text-[13px] text-slate-800">{quote.terms}</p>}
              {quote.notes && <p className="whitespace-pre-line text-[12px] text-slate-600">{quote.notes}</p>}
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

          {/* 6b. PL: packing details text */}
          {isPL && quote.packing_details && (
            <Section no={6} title="Packing Details">
              <p className="whitespace-pre-line text-[13px] text-slate-800">{quote.packing_details}</p>
            </Section>
          )}

          {/* 7. SELLER'S BANK DETAILS — editable profile block first, the
              quotation's free-text bank_details second. */}
          {!isPL && (
            <Section no={7} title="Seller&apos;s Bank Details">
              {bankAny ? (
                <div className="space-y-0.5">
                  <KV k="Beneficiary" v={profile?.bank_beneficiary} />
                  <KV k="Bank" v={profile?.bank_name} />
                  <KV k="Branch" v={profile?.bank_branch} />
                  <KV k="A/C No." v={profile?.bank_account} />
                  <KV k="SWIFT / BIC" v={profile?.bank_swift} />
                  <KV k="Intermediary Bank" v={profile?.bank_intermediary} />
                </div>
              ) : quote.bank_details?.trim() ? (
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
              <div className="border-t border-slate-400 pt-1 text-center text-slate-500">Buyer&apos;s Signature &amp; Stamp</div>
              <div className="mt-10 space-y-4 text-slate-600">
                <div className="border-t border-slate-300 pt-1">Name / Date</div>
              </div>
            </div>
            <div>
              <div className="border-t border-slate-400 pt-1 text-center font-semibold text-slate-700">
                For and on behalf of {companyName}
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
