// 2026-11-23 — the downloadable Invoice / Tax Invoice PDF.
//
// WHY THIS EXISTS: /api/invoices/[id]/pdf used to render the ORDER document
// builder — invoice number on top, then one line per order with that order's
// own value. That is a PO summary, not the customs invoice: no value
// breakdown, no declared value in words, no IOSS/VAT/EORI, no duty block. The
// user reported exactly that ("invoice generate hone par invoice nahi aara,
// PO ki detail aari").
//
// This builds the invoice the same way the on-screen sheet does (see
// /dashboard/invoices/[id]): items priced at the invoice's own value basis
// (itemCostForOrder — CSB-V), the four snapshot totals from sales_invoices,
// the declaration and the customs identifiers. Packing List keeps using the
// order-document builder, because a packing list really is quantities only.
import React from "react";
import { A4Document, A4FactsGrid, A4Note, A4Page, A4Section, A4Signatures, A4Table, type A4Column } from "@/lib/pdf/a4";
import { renderPdfToBuffer } from "@/lib/pdf/render";
import { formatMoney, LINES_PER_PAGE, paginateLines } from "./order-document";
import { itemCostForOrder } from "@/lib/invoices/value-breakdown";

export type InvoicePdfOrder = {
  ref_no: string;
  sku_label: string | null;
  size_label: string | null;
  qty: number;
  order_value_original: number | string | null;
  order_currency: string | null;
  hsn: string | null;
};

export type InvoicePdfSource = {
  invoice_no: string;
  master_invoice_no: string;
  invoice_date: string;
  csb_type: string;
  shipment_term: string;
  courier_company: string;
  awb_no: string | null;
  vessel_flight_no: string | null;
  port_of_discharge: string | null;
  marks_and_nos: string | null;
  no_of_packages: number | null;
  destination_country: string | null;
  ioss_number: string | null;
  vat_number: string | null;
  eori_number: string | null;
  buyer_name_address: string;
  buyer_email: string | null;
  buyer_phone: string | null;
  other_than_consignee: string | null;
  remark: string | null;
  value_percent: number | null;
  invoice_value_usd: number | null;
  item_cost_total: number | null;
  insurance_total: number | null;
  freight_total: number | null;
  invoice_currency: string | null;
  taxable_value_inr: number | null;
  declared_value_words: string | null;
  duty_payable_by: string | null;
  duty_payable_other_specify: string | null;
};

export type InvoicePdfInput = {
  kind: "invoice" | "tax-invoice";
  invoice: InvoicePdfSource;
  orders: InvoicePdfOrder[];
  company: { name?: string | null; logo_url?: string | null } | null;
  profile: {
    address?: string | null;
    phone?: string | null;
    email?: string | null;
    gstin?: string | null;
    iec?: string | null;
    ad_code?: string | null;
    account_no?: string | null;
    ifsc_code?: string | null;
    bank_name?: string | null;
  } | null;
  storeName: string | null;
};

const DECLARATION =
  "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.";

function itemDescription(order: InvoicePdfOrder): string {
  const parts = [order.sku_label, order.size_label].filter((part): part is string => !!part && !!part.trim());
  return parts.length ? parts.join(" · ") : "—";
}

export async function renderInvoicePdf(input: InvoicePdfInput): Promise<Buffer> {
  const { invoice, orders, company, profile, storeName } = input;
  const currency = invoice.invoice_currency ?? orders[0]?.order_currency ?? "";
  const percent = invoice.value_percent;
  const taxable = input.kind === "tax-invoice";
  const title = taxable ? "Tax Invoice" : "Invoice";

  // Same rule as the on-screen item table: CSB-V prices each line at its share
  // of the invoice value (order value × basis % × 30%); with no basis saved the
  // line shows the order's own value, exactly as the screen does.
  const amountOf = (order: InvoicePdfOrder): number => {
    const value = Number(order.order_value_original || 0);
    return percent != null ? itemCostForOrder(value, percent) : Math.round(value * 100) / 100;
  };

  const columns: A4Column[] = [
    { label: "#", width: 20 },
    { label: "PO / Ref", width: 74 },
    { label: "Item (SKU · size)", flex: 3 },
  ];
  if (taxable) columns.push({ label: "HSN", width: 46 });
  columns.push({ label: "Qty", width: 32, align: "right" });
  columns.push({ label: "Rate", width: 62, align: "right" });
  columns.push({ label: `Amount${currency ? ` (${currency})` : ""}`, width: 72, align: "right" });

  const money = (value: number | null | undefined) => (value == null ? "—" : formatMoney(value));

  const totals = [
    { label: `Item cost (${currency})`, value: money(invoice.item_cost_total) },
    { label: `Insurance (${currency})`, value: money(invoice.insurance_total) },
    { label: `Freight (${currency})`, value: money(invoice.freight_total) },
    ...(invoice.taxable_value_inr != null
      ? [{ label: "Taxable value (INR)", value: `INR ${formatMoney(invoice.taxable_value_inr)}`, grand: false }]
      : []),
    { label: `Total (${currency})`, value: money(invoice.invoice_value_usd), grand: true },
  ];

  const header = {
    title,
    subtitle: `${invoice.csb_type} · ${invoice.shipment_term}${storeName ? ` · ${storeName}` : ""}`,
    docNo: invoice.invoice_no,
    docDate: invoice.invoice_date,
    meta: [
      { label: "Master invoice no.", value: invoice.master_invoice_no },
      ...(profile?.gstin ? [{ label: "GSTIN", value: profile.gstin }] : []),
      ...(currency ? [{ label: "Currency", value: currency }] : []),
    ],
    companyName: company?.name || "NYKO MART",
    companyLogoUrl: company?.logo_url ?? null,
    companyLines: [
      profile?.address,
      profile?.phone ? `Phone: ${profile.phone}` : null,
      profile?.email ? `Email: ${profile.email}` : null,
    ],
  };

  const chunks = paginateLines(orders, LINES_PER_PAGE);
  const totalPages = chunks.length;

  const pages: React.ReactNode[] = chunks.map((chunk, chunkIndex) => {
    const isLast = chunkIndex === chunks.length - 1;
    const startIndex = chunks.slice(0, chunkIndex).reduce((sum, page) => sum + page.length, 0);

    return (
      <A4Page
        key={`invoice-${chunkIndex}`}
        header={header}
        footerNote={`${title} ${invoice.invoice_no} — ${DECLARATION}`}
        pageNumber={chunkIndex + 1}
        totalPages={totalPages}
      >
        {chunkIndex === 0 ? (
          <>
            {/* 2026-11-23 — "16 detail fields in one unreadable row": one fact
                per column across a single line made every value a squeezed
                sliver. Grouped into short rows (max 3-4 each) instead, so the
                customs identifiers stay legible. */}
            <A4Section title="Consignee">
              <A4FactsGrid
                columns={2}
                facts={[
                  { label: "Consignee", value: invoice.buyer_name_address },
                  { label: "Other than consignee", value: invoice.other_than_consignee },
                  { label: "Buyer email", value: invoice.buyer_email },
                  { label: "Buyer phone", value: invoice.buyer_phone },
                  { label: "Destination", value: invoice.destination_country },
                ]}
              />
            </A4Section>

            <A4Section title="Shipment">
              <A4FactsGrid
                columns={3}
                facts={[
                  { label: "Shipment term", value: invoice.shipment_term },
                  { label: "Courier", value: invoice.courier_company },
                  { label: "AWB no.", value: invoice.awb_no },
                  { label: "Vessel / flight", value: invoice.vessel_flight_no },
                  { label: "Port of discharge", value: invoice.port_of_discharge },
                  { label: "Marks & nos.", value: invoice.marks_and_nos },
                  {
                    label: "No. of packages",
                    value: invoice.no_of_packages != null ? String(invoice.no_of_packages) : null,
                  },
                ]}
              />
            </A4Section>

            <A4Section title="Customs & tax identifiers">
              <A4FactsGrid
                columns={4}
                facts={[
                  { label: "IOSS", value: invoice.ioss_number },
                  { label: "VAT", value: invoice.vat_number },
                  { label: "EORI", value: invoice.eori_number },
                  {
                    label: "Duty & taxes payable by",
                    value:
                      invoice.duty_payable_by === "Other"
                        ? `Other — ${invoice.duty_payable_other_specify ?? ""}`.trim()
                        : invoice.duty_payable_by,
                  },
                ]}
              />
            </A4Section>
          </>
        ) : null}

        <A4Section title={`Items (${orders.length})`}>
          <A4Table
            columns={columns}
            rows={chunk.map((order, index) => {
              const amount = amountOf(order);
              // Same derivation as the on-screen sheet: Rate = line value / qty,
              // so Rate × Qty always equals Amount without breaking the
              // formula total.
              const qty = order.qty || 1;
              const rate = Math.round((amount / qty) * 100) / 100;
              const cells: React.ReactNode[] = [startIndex + index + 1, order.ref_no, itemDescription(order)];
              if (taxable) cells.push(order.hsn ?? "—");
              cells.push(order.qty);
              cells.push(money(rate));
              cells.push(money(amount));
              return { cells };
            })}
            totals={isLast ? totals : undefined}
            emptyText="This invoice has no linked items."
          />
        </A4Section>

        {isLast ? (
          <>
            {invoice.declared_value_words ? (
              <A4Section title="Declared value in words">
                <A4Note>{invoice.declared_value_words}</A4Note>
              </A4Section>
            ) : null}
            {invoice.remark ? (
              <A4Section title="Remark">
                <A4Note>{invoice.remark}</A4Note>
              </A4Section>
            ) : null}
            <A4Section title="Declaration">
              <A4Note>{DECLARATION}</A4Note>
              {profile?.iec || profile?.account_no ? (
                <A4Note>
                  {[
                    profile?.iec ? `I.E.C. No.: ${profile.iec}` : null,
                    profile?.ad_code ? `Bank AD Code: ${profile.ad_code}` : null,
                    profile?.account_no ? `Bank A/C: ${profile.account_no}` : null,
                    profile?.ifsc_code ? `IFSC: ${profile.ifsc_code}` : null,
                    profile?.bank_name ? `Bank: ${profile.bank_name}` : null,
                  ]
                    .filter(Boolean)
                    .join("  ·  ")}
                </A4Note>
              ) : null}
            </A4Section>
            <A4Signatures labels={["Authorised signatory", "Received by"]} />
          </>
        ) : null}
      </A4Page>
    );
  });

  return renderPdfToBuffer(
    <A4Document title={`${title} ${invoice.invoice_no}`} author={company?.name ?? "NYKO MART"}>
      {pages}
    </A4Document>
  );
}
