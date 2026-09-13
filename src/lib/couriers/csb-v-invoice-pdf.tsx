// 2026-09-13 — "ye invoice jo ban raha hai vo upload hona chahiye fedex
// system par, vo jo pahle ban raha vo nahi": the booking flow's UPLOAD_OWN
// ETD option used to upload fedex-invoice-pdf.tsx's SIMPLE commercial
// invoice (the one built from the Ship API request fields themselves).
// But since 2026-09-04 the booking flow ALREADY auto-generates this app's
// real, formula-driven CSB-V customs invoice (maybeAutoGenerateCsbVInvoice
// ForBooking → generateInvoiceCore — the exact document the user prints
// from /dashboard/invoices, shown in their screenshot) right before that
// upload runs. So FedEx was receiving the old-style simple PDF while the
// real CSB-V sat in the app. This renderer produces a PDF of THE REAL
// CSB-V invoice — same fields, same formula values, same layout as
// invoice-view.tsx's print view (title, company/customs header block,
// invoice+master numbers, buyer's PO, consignee, tracking line, broker &
// duty block, item table with COST/INSURANCE/FREIGHT/TOTAL footer, package
// table, IOSS/VAT/EORI, declared-value words, declarations, signature) —
// so what FedEx receives electronically is now byte-for-byte the same
// DOCUMENT the business prints, not a lookalike.
//
// Deliberately mirrors the PRINT layout, not the HTML DOM: @react-pdf/
// renderer can't capture a web page, so this re-expresses invoice-view.tsx's
// printed CSB-V as PDF primitives (same convention as fedex-invoice-pdf.tsx
// next door). Pure JS — no native deps — safe on Vercel serverless.

import { Document, Page, Text, View, StyleSheet, Image, pdf } from "@react-pdf/renderer";
import { itemCostForOrder } from "@/lib/invoices/value-breakdown";
import { isEuDestination, merchantProductId, nonStandardisedManufacturerProductId, standardisedManufacturerProductId } from "@/lib/invoices/pid";

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 8, fontFamily: "Helvetica", color: "#111827" },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title: { fontSize: 12, fontWeight: 700, letterSpacing: 0.5 },
  badge: { fontSize: 8, borderWidth: 1, borderColor: "#374151", paddingVertical: 2, paddingHorizontal: 6 },
  companyRow: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 2, borderBottomColor: "#111827", paddingBottom: 8, marginBottom: 8 },
  companyName: { fontSize: 13, fontWeight: 700 },
  small: { fontSize: 7.5 },
  tiny: { fontSize: 7, color: "#4B5563" },
  grid2: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: "#D1D5DB", paddingBottom: 6, marginBottom: 8, gap: 20 },
  col: { flexGrow: 1, flexShrink: 1, flexBasis: 0 },
  label: { fontSize: 7.5, fontWeight: 700, marginBottom: 2 },
  value: { fontSize: 8 },
  prewrap: { fontSize: 8, lineHeight: 1.35 },
  trackingLine: { borderBottomWidth: 1, borderBottomColor: "#D1D5DB", paddingBottom: 4, marginBottom: 8, fontSize: 8.5, fontWeight: 700 },
  table: { borderWidth: 1, borderColor: "#9CA3AF", marginBottom: 6 },
  tr: { flexDirection: "row" },
  th: { fontSize: 7, fontWeight: 700, padding: 3, borderRightWidth: 1, borderRightColor: "#9CA3AF", borderBottomWidth: 1, borderBottomColor: "#9CA3AF", backgroundColor: "#F3F4F6" },
  td: { fontSize: 7.5, padding: 3, borderRightWidth: 1, borderRightColor: "#D1D5DB", borderBottomWidth: 1, borderBottomColor: "#D1D5DB" },
  tdRight: { textAlign: "right" },
  tdBold: { fontWeight: 700 },
  brokerTable: { borderWidth: 1, borderColor: "#9CA3AF", marginBottom: 8 },
  brokerCell: { fontSize: 7.5, padding: 3, borderRightWidth: 1, borderRightColor: "#D1D5DB", borderBottomWidth: 1, borderBottomColor: "#D1D5DB" },
  declaration: { fontSize: 7.5, lineHeight: 1.4, color: "#374151", marginTop: 8 },
  originDecl: { fontSize: 7, lineHeight: 1.4, color: "#4B5563", marginTop: 4 },
  footerRow: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: "#D1D5DB", paddingTop: 6, marginTop: 16, fontSize: 7 },
  sigLine: { width: 160, borderTopWidth: 1, borderTopColor: "#374151", paddingTop: 2, textAlign: "center" },
});

export type CsbVPdfInvoice = {
  csb_type: string;
  invoice_no: string;
  master_invoice_no: string;
  invoice_date: string;
  shipment_term: string;
  courier_company: string;
  department_reference_no: string | null;
  destination_country: string | null;
  origin_declaration: string | null;
  ioss_number: string | null;
  vat_number: string | null;
  eori_number: string | null;
  weight_kg: number | string | null;
  length_cm: number | string | null;
  width_cm: number | string | null;
  height_cm: number | string | null;
  buyer_name_address: string;
  buyer_email: string | null;
  buyer_phone: string | null;
  other_than_consignee: string | null;
  no_of_packages: number | null;
  marks_and_nos: string | null;
  vessel_flight_no: string | null;
  port_of_discharge: string | null;
  value_percent: number | string | null;
  invoice_value_usd: number | string | null;
  item_cost_total: number | string | null;
  insurance_total: number | string | null;
  freight_total: number | string | null;
  invoice_currency: string | null;
  taxable_value_inr: number | string | null;
  declared_value_words: string | null;
  awb_no: string | null;
  remark: string | null;
  broker_name: string | null;
  broker_tel: string | null;
  broker_contact: string | null;
  duty_payable_by: string | null;
  duty_payable_other_specify: string | null;
};

export type CsbVPdfItem = {
  ref_no: string;
  ref_no_base: string | null;
  sku_label: string | null;
  size_label: string | null;
  qty: number;
  colour: string | null;
  category_name: string;
  hsn_code: string;
  harmonized_tariff_number: string;
  order_value_original: number | string | null;
  order_currency: string;
};

export type CsbVPdfMeta = {
  // 2026-09-13 — "company ke logo ke sath isi formate me": the on-screen
  // invoice (invoice-view.tsx) prints companies.logo_url as a ~48px image
  // left of the company name; this PDF is that same document, so it carries
  // the same logo. Passed as a base64 data: URI (react-pdf can't reliably
  // fetch remote URLs inside a serverless render, and PNG/JPEG-only — the
  // caller in courier-booking/actions.ts pre-downloads + validates it, and
  // passes null for anything else so a broken/unfetchable logo can never
  // fail the FedEx upload).
  logoDataUri: string | null;
  companyName: string;
  companyAddress: string | null;
  companyPhone: string | null;
  companyWhatsapp: string | null;
  companyEmail: string | null;
  gstin: string | null;
  iec: string | null;
  adCode: string | null;
  bankName: string | null;
  accountNo: string | null;
  ifscCode: string | null;
  storeName: string;
};

const DECLARATION_STATEMENT =
  "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.";

function num(v: number | string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function fmt(v: number | string | null | undefined): string {
  return num(v).toFixed(2);
}

export function CsbVCustomsInvoiceDocument({
  invoice,
  items,
  meta,
}: {
  invoice: CsbVPdfInvoice;
  items: CsbVPdfItem[];
  meta: CsbVPdfMeta;
}) {
  const isCsbV = invoice.csb_type === "CSB-V";
  const displayCurrency = invoice.invoice_currency || (isCsbV ? "USD" : (items[0]?.order_currency ?? ""));
  const destCountry = (invoice.destination_country ?? "").trim();
  const showPid = isEuDestination(destCountry);
  const itemTableColCount = 9 + (showPid ? 3 : 0);

  const itemDisplayValue = (i: CsbVPdfItem): number =>
    isCsbV && invoice.value_percent != null ? itemCostForOrder(num(i.order_value_original), num(invoice.value_percent)) : num(i.order_value_original);

  const totalValue = items.reduce((sum, i) => sum + itemDisplayValue(i), 0);
  const poNumbers = Array.from(new Set(items.map((i) => i.ref_no_base || i.ref_no))).join(", ");
  const packageLabels = Array.from({ length: Math.max(1, Number(invoice.no_of_packages) || 1) }, (_, idx) => `PACK-${idx + 1}`);
  const weightNum = num(invoice.weight_kg);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{invoice.csb_type} - INVOICE</Text>
          <Text style={styles.badge}>E-COM</Text>
        </View>

        <View style={styles.companyRow}>
          <View style={styles.col}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 2 }}>
              {/* react-pdf's <Image> has no alt prop — the jsx-a11y rule
                  below targets the DOM <img>, not this component. */}
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              {meta.logoDataUri && <Image src={meta.logoDataUri} style={{ width: 36, height: 36, objectFit: "contain" }} />}
              <Text style={styles.companyName}>{meta.companyName}</Text>
            </View>
            {meta.companyAddress && <Text style={styles.small}>{meta.companyAddress}</Text>}
            {(meta.companyPhone || meta.companyWhatsapp) && (
              <Text style={styles.small}>{[meta.companyPhone && `Phone: ${meta.companyPhone}`, meta.companyWhatsapp && `WhatsApp: ${meta.companyWhatsapp}`].filter(Boolean).join(" | ")}</Text>
            )}
            {meta.companyEmail && <Text style={styles.small}>Email: {meta.companyEmail}</Text>}
          </View>
          <View style={[styles.col, { alignItems: "flex-end" }]}>
            {meta.gstin && <Text style={styles.small}>GSTIN: {meta.gstin}</Text>}
            {meta.iec && <Text style={styles.small}>I.E.C. No.: {meta.iec}</Text>}
            {meta.adCode && <Text style={styles.small}>Bank AD Code: {meta.adCode}</Text>}
            {meta.accountNo && <Text style={styles.small}>Bank A/C No.: {meta.accountNo}</Text>}
            {meta.ifscCode && <Text style={styles.small}>IFSC Code: {meta.ifscCode}</Text>}
            {meta.bankName && <Text style={styles.small}>Bank Name: {meta.bankName}</Text>}
            <Text style={styles.small}>Store: {meta.storeName}</Text>
          </View>
        </View>

        <View style={styles.grid2}>
          <View style={styles.col}>
            <Text style={styles.label}>Invoice No. &amp; Date</Text>
            <Text style={styles.value}>{invoice.invoice_no} · {invoice.invoice_date}</Text>
            <Text style={styles.tiny}>Master Invoice No.: {invoice.master_invoice_no}</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Buyer&apos;s Order No. &amp; Date</Text>
            <Text style={styles.value}>{poNumbers || "—"} · {invoice.invoice_date}</Text>
          </View>
        </View>

        <View style={styles.grid2}>
          <View style={styles.col}>
            <Text style={styles.label}>CONSIGNEE —</Text>
            <Text style={styles.prewrap}>{invoice.buyer_name_address}</Text>
            {invoice.buyer_email && <Text style={styles.tiny}>Email: {invoice.buyer_email}</Text>}
            {invoice.buyer_phone && <Text style={styles.tiny}>Phone No.: {invoice.buyer_phone}</Text>}
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>OTHER THAN CONSIGNEE —</Text>
            <Text style={styles.prewrap}>{invoice.other_than_consignee || "—"}</Text>
          </View>
        </View>

        <View style={styles.grid2}>
          <View style={styles.col}>
            <Text style={styles.label}>Country of Origin of Goods</Text>
            <Text style={styles.value}>INDIA</Text>
          </View>
          <View style={styles.col}>
            <Text style={styles.label}>Country of Final Destination</Text>
            <Text style={styles.value}>{destCountry || "—"}</Text>
          </View>
        </View>

        {invoice.awb_no && (
          <View style={styles.trackingLine}>
            <Text>{invoice.courier_company?.toUpperCase()} TRACKING NO.: {invoice.awb_no}</Text>
          </View>
        )}

        <View style={styles.grid2}>
          <View style={styles.col}>
            <Text style={styles.value}>Terms of Delivery &amp; Payment</Text>
            <Text style={styles.small}>SHIPMENT TERM: {invoice.shipment_term}</Text>
            {invoice.department_reference_no && <Text style={styles.small}>DEPARTMENT REF. NO.: {invoice.department_reference_no}</Text>}
          </View>
          <View style={styles.col}>
            <Text style={styles.small}>Pre-carriage by: By Road</Text>
            {invoice.vessel_flight_no && <Text style={styles.small}>Vessel/Flight No.: {invoice.vessel_flight_no}</Text>}
            <Text style={styles.small}>Port of Loading: NEW DELHI</Text>
            {invoice.port_of_discharge && <Text style={styles.small}>Port of Discharge: {invoice.port_of_discharge}</Text>}
          </View>
        </View>

        {/* Broker + duty-payable block — ALWAYS printed (blank lines when
            empty), same as invoice-view.tsx's print layout. */}
        <View style={styles.brokerTable}>
          <View style={styles.tr}>
            <Text style={[styles.brokerCell, { fontWeight: 700 }]}>
              If there is a designated broker for this shipment, please provide contact information.
            </Text>
          </View>
          <View style={styles.tr}>
            <Text style={styles.brokerCell}>Name of Broker: {invoice.broker_name ?? ""}</Text>
            <Text style={styles.brokerCell}>Tel. No.: {invoice.broker_tel ?? ""}</Text>
            <Text style={styles.brokerCell}>Contact Name: {invoice.broker_contact ?? ""}</Text>
          </View>
          <View style={styles.tr}>
            <Text style={[styles.brokerCell, { borderRightWidth: 0 }]}>
              Duties and Taxes Payable by {"  "}
              {(["Exporter", "Consignee", "Other"] as const).map((opt) => `[${invoice.duty_payable_by === opt ? "X" : " "}] ${opt}   `).join("")}
              {invoice.duty_payable_by === "Other" ? `If Other: ${invoice.duty_payable_other_specify ?? ""}` : ""}
            </Text>
          </View>
        </View>

        {invoice.marks_and_nos && <Text style={styles.tiny}>Marks &amp; Nos./Container No.: {invoice.marks_and_nos}</Text>}
        <Text style={styles.tiny}>No. of Packages: {invoice.no_of_packages ?? 1}</Text>

        <View style={styles.table}>
          <View style={styles.tr}>
            <Text style={[styles.th, { flex: 1.6 }]}>Reference No.</Text>
            <Text style={[styles.th, { flex: 2.2 }]}>Item</Text>
            <Text style={styles.th}>HSN</Text>
            <Text style={[styles.th, { flex: 1.3 }]}>Harmonized Tariff Number</Text>
            <Text style={styles.th}>Size</Text>
            <Text style={styles.th}>Origin</Text>
            {showPid && <Text style={styles.th}>Merchant Product ID</Text>}
            {showPid && <Text style={styles.th}>Non-Std. Manufacturer Product ID</Text>}
            {showPid && <Text style={styles.th}>Std. Manufacturer Product ID</Text>}
            <Text style={[styles.th, styles.tdRight]}>Qty</Text>
            <Text style={[styles.th, styles.tdRight]}>Rate ({displayCurrency})</Text>
            <Text style={[styles.th, styles.tdRight, { borderRightWidth: 0 }]}>Amount ({displayCurrency})</Text>
          </View>
          {items.map((i) => {
            const value = itemDisplayValue(i);
            const qty = i.qty || 1;
            const rate = value / qty;
            return (
              <View key={i.ref_no} style={styles.tr}>
                <Text style={[styles.td, { flex: 1.6 }]}>{i.ref_no}</Text>
                <Text style={[styles.td, { flex: 2.2 }]}>
                  {i.category_name}{i.colour ? ` (${i.colour})` : ""}
                  {i.sku_label ? ` — SKU: ${i.sku_label}` : ""}
                </Text>
                <Text style={styles.td}>{i.hsn_code}</Text>
                <Text style={[styles.td, { flex: 1.3 }]}>{i.harmonized_tariff_number}</Text>
                <Text style={styles.td}>{i.size_label ?? ""}</Text>
                <Text style={styles.td}>INDIA</Text>
                {showPid && <Text style={styles.td}>{merchantProductId(i.sku_label)}</Text>}
                {showPid && <Text style={styles.td}>{nonStandardisedManufacturerProductId(i.sku_label)}</Text>}
                {showPid && <Text style={styles.td}>{standardisedManufacturerProductId()}</Text>}
                <Text style={[styles.td, styles.tdRight]}>{qty}</Text>
                <Text style={[styles.td, styles.tdRight]}>{rate.toFixed(2)}</Text>
                <Text style={[styles.td, styles.tdRight, { borderRightWidth: 0 }]}>{value.toFixed(2)}</Text>
              </View>
            );
          })}
          {/* Footer rows — identical precedence to invoice-view.tsx: stored
              COST/INSURANCE/FREIGHT/TOTAL when filled (they're editable on
              the invoice page), else the formula's computed values. */}
          <View style={styles.tr}>
            <Text style={[styles.td, styles.tdRight, styles.tdBold, { flex: itemTableColCount - 1, borderRightWidth: 0 }]}>COST</Text>
            <Text style={[styles.td, styles.tdRight, { flex: 1, borderRightWidth: 0 }]}>{invoice.item_cost_total != null ? fmt(invoice.item_cost_total) : totalValue.toFixed(2)}</Text>
          </View>
          <View style={styles.tr}>
            <Text style={[styles.td, styles.tdRight, styles.tdBold, { flex: itemTableColCount - 1, borderRightWidth: 0 }]}>INSURANCE</Text>
            <Text style={[styles.td, styles.tdRight, { flex: 1, borderRightWidth: 0 }]}>{invoice.insurance_total != null ? fmt(invoice.insurance_total) : "—"}</Text>
          </View>
          <View style={styles.tr}>
            <Text style={[styles.td, styles.tdRight, styles.tdBold, { flex: itemTableColCount - 1, borderRightWidth: 0 }]}>FREIGHT</Text>
            <Text style={[styles.td, styles.tdRight, { flex: 1, borderRightWidth: 0 }]}>{invoice.freight_total != null ? fmt(invoice.freight_total) : "—"}</Text>
          </View>
          <View style={styles.tr}>
            <Text style={[styles.td, styles.tdRight, styles.tdBold, { flex: itemTableColCount - 1, borderRightWidth: 0 }]}>TOTAL</Text>
            <Text style={[styles.td, styles.tdRight, styles.tdBold, { flex: 1, borderRightWidth: 0 }]}>
              {invoice.invoice_value_usd != null ? fmt(invoice.invoice_value_usd) : totalValue.toFixed(2)} {displayCurrency}
            </Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tr}>
            <Text style={[styles.th, { flex: 1.2 }]}>Package No.</Text>
            <Text style={[styles.th, styles.tdRight]}>Package Weight (kg)</Text>
            <Text style={[styles.th, styles.tdRight]}>L (cm)</Text>
            <Text style={[styles.th, styles.tdRight]}>W (cm)</Text>
            <Text style={[styles.th, styles.tdRight]}>H (cm)</Text>
            <Text style={[styles.th, styles.tdRight, { borderRightWidth: 0 }]}>Taxable Value (INR)</Text>
          </View>
          {packageLabels.map((label, idx) => (
            <View key={label} style={styles.tr}>
              <Text style={[styles.td, { flex: 1.2 }]}>{label}</Text>
              <Text style={[styles.td, styles.tdRight]}>{invoice.weight_kg != null && invoice.weight_kg !== "" ? invoice.weight_kg : "—"}</Text>
              <Text style={[styles.td, styles.tdRight]}>{invoice.length_cm ?? "—"}</Text>
              <Text style={[styles.td, styles.tdRight]}>{invoice.width_cm ?? "—"}</Text>
              <Text style={[styles.td, styles.tdRight]}>{invoice.height_cm ?? "—"}</Text>
              <Text style={[styles.td, styles.tdRight, { borderRightWidth: 0 }]}>{idx === 0 ? invoice.taxable_value_inr ?? "—" : ""}</Text>
            </View>
          ))}
          <View style={styles.tr}>
            <Text style={[styles.td, styles.tdBold]}>TOTAL WEIGHT</Text>
            <Text style={[styles.td, styles.tdRight, styles.tdBold, { flex: 5, borderRightWidth: 0 }]}>
              {invoice.weight_kg != null && invoice.weight_kg !== "" ? `${(weightNum * packageLabels.length).toFixed(3)} KG` : "—"}
            </Text>
          </View>
        </View>

        {(invoice.ioss_number || invoice.vat_number || invoice.eori_number) && (
          <View style={{ marginBottom: 4 }}>
            {invoice.ioss_number && <Text style={styles.tiny}>IOSS Number: {invoice.ioss_number}</Text>}
            {invoice.vat_number && <Text style={styles.tiny}>VAT Number: {invoice.vat_number}</Text>}
            {invoice.eori_number && <Text style={styles.tiny}>EORI Number: {invoice.eori_number}</Text>}
          </View>
        )}

        {invoice.declared_value_words && <Text style={{ fontSize: 8, fontWeight: 700, marginBottom: 4 }}>Invoice Declared Value: {invoice.declared_value_words}</Text>}

        <Text style={styles.declaration}>
          Declaration — {"\n"}
          {DECLARATION_STATEMENT}
        </Text>
        {invoice.origin_declaration && <Text style={styles.originDecl}>{invoice.origin_declaration}</Text>}

        <View style={styles.footerRow}>
          <View style={{ flex: 1 }}>
            {invoice.remark && (
              <>
                <Text style={styles.tdBold}>Remark</Text>
                <Text style={styles.tiny}>{invoice.remark}</Text>
              </>
            )}
          </View>
          <View>
            <Text style={styles.sigLine}>Signature &amp; Date</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function renderCsbVInvoicePdf(invoice: CsbVPdfInvoice, items: CsbVPdfItem[], meta: CsbVPdfMeta): Promise<Buffer> {
  const instance = pdf(<CsbVCustomsInvoiceDocument invoice={invoice} items={items} meta={meta} />);
  const blob = await instance.toBuffer();
  // Same Node Readable-stream note as fedex-invoice-pdf.tsx's renderer.
  const chunks: Buffer[] = [];
  for await (const chunk of blob as unknown as AsyncIterable<Buffer>) chunks.push(chunk);
  return Buffer.concat(chunks);
}
