// 2026-09-19 — A4-portrait PDF for the 4 Doc Statement types (Credit Note /
// CSB Filing / Refund / Order Refund). Same @react-pdf/renderer approach
// as bill-statement-pdf.tsx (no headless browser, safe on Vercel
// serverless) and the SAME shared buffer helper (src/lib/pdf/render.ts) —
// only the per-kind layout differs, since these are much simpler
// single-section documents (no payments/adjustments/wallet like a bill).
import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import type { DocStatementData } from "@/lib/doc-statement";
import { renderPdfToBuffer } from "@/lib/pdf/render";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 8.5, fontFamily: "Helvetica", color: "#111827" },
  title: { fontSize: 12, fontWeight: 700, textAlign: "right", marginBottom: 6 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 2, borderBottomColor: "#111827", paddingBottom: 10, marginBottom: 10 },
  logo: { width: 42, height: 42, objectFit: "contain", marginRight: 8 },
  companyName: { fontSize: 14, fontWeight: 700 },
  companyLine: { fontSize: 7.5, color: "#4b5563" },
  rightBlock: { textAlign: "right", fontSize: 7, lineHeight: 1.5 },
  twoCol: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 0.75, borderBottomColor: "#d1d5db", paddingBottom: 8, marginBottom: 10 },
  sectionTitle: { fontSize: 8.5, fontWeight: 700, marginBottom: 4 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1.5, borderTopColor: "#111827", paddingVertical: 4, marginTop: 4, fontSize: 10.5, fontWeight: 700 },
  footer: { marginTop: 14, fontSize: 7, color: "#6b7280" },
  italic: { fontStyle: "italic", marginTop: 6 },
  fieldRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5, borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb" },
  fieldLabel: { color: "#6b7280" },
});

const dash = (v: string | number | null | undefined) => (v != null && `${v}`.trim() ? `${v}` : "-");
const money = (n: number | null, ccy = "") => (n == null ? "-" : `${ccy ? ccy + " " : ""}${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

function Letterhead({ data }: { data: DocStatementData }) {
  const { company, profile, companyName, docTitle } = data;
  return (
    <>
      <Text style={styles.title}>{docTitle}</Text>
      <View style={styles.headerRow}>
        <View style={{ flexDirection: "row", alignItems: "flex-start", flex: 1 }}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          {company?.logo_url ? <Image src={company.logo_url} style={styles.logo} /> : null}
          <View>
            <Text style={styles.companyName}>{companyName}</Text>
            <Text style={styles.companyLine}>{dash(profile?.address)}</Text>
            <Text style={styles.companyLine}>
              {[profile?.phone && `Phone: ${profile.phone}`, profile?.whatsapp && `WhatsApp: ${profile.whatsapp}`].filter(Boolean).join(" | ") || ""}
            </Text>
            <Text style={styles.companyLine}>Email: {dash(profile?.email)}</Text>
          </View>
        </View>
        <View style={styles.rightBlock}>
          <Text>GSTIN: {dash(profile?.gstin)}</Text>
          <Text>Doc No.: {data.invoiceRef}</Text>
        </View>
      </View>
    </>
  );
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text>{dash(value)}</Text>
    </View>
  );
}

function Footer({ remark }: { remark?: string | null }) {
  return (
    <View style={styles.footer}>
      {remark !== undefined && <Text>Remark: {dash(remark)}</Text>}
      <Text style={styles.italic}>This is a computer-generated document from the Nyko Mart Order Management System — no signature required.</Text>
    </View>
  );
}

function CreditNoteBody({ data }: { data: Extract<DocStatementData, { kind: "credit_note" }> }) {
  return (
    <>
      <View style={styles.twoCol}>
        <View style={{ flex: 1, paddingRight: 12 }}>
          <Text style={styles.sectionTitle}>{data.party ? "PARTY (VENDOR)" : "BUYER"}</Text>
          <Text style={{ fontWeight: 700 }}>{data.party?.name ?? data.buyerName ?? "—"}</Text>
          {data.party?.address ? <Text style={styles.companyLine}>{data.party.address}</Text> : null}
          {data.party?.gst ? <Text style={styles.companyLine}>GST: {data.party.gst}</Text> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.sectionTitle}>CREDIT NOTE DETAILS</Text>
          <Text>CN No.: {dash(data.cnNo)}</Text>
          <Text>Party&apos;s CN No.: {dash(data.vendorCnNo)}</Text>
          <Text>Kind: {dash(data.cnKind)}</Text>
          <Text>Date: {dash(data.creditNoteDate)}</Text>
          <Text>Status: {dash(data.creditNoteStatus)}</Text>
        </View>
      </View>
      <View style={{ marginBottom: 10 }}>
        <Text style={styles.sectionTitle}>AMOUNT</Text>
        <Field label="Against Invoice" value={data.invoiceNo} />
        {data.itemName && <Field label="Item" value={data.itemName} />}
        {data.qty != null && <Field label="Qty" value={data.qty} />}
        {data.poRate != null && <Field label="PO Rate" value={money(data.poRate)} />}
        {data.billedRate != null && <Field label="Billed Rate" value={money(data.billedRate)} />}
        {data.gstRatePct != null && <Field label="GST (total)" value={`${data.gstRatePct * 2}%`} />}
        {data.awbNo && <Field label="AWB No." value={data.awbNo} />}
        <Field label="Refund Type" value={data.refundType} />
        {(data.invoiceValueUsd != null || data.invoiceValueInr != null) && (
          <Field label="Invoice Value" value={`${money(data.invoiceValueUsd, "USD")} / ${money(data.invoiceValueInr, "INR")}`} />
        )}
        <View style={styles.totalRow}>
          <Text>Credit Note Amount</Text>
          <Text>{money(data.refundAmount)}</Text>
        </View>
        {(data.refundAmtUsd != null || data.refundAmtInr != null) && (
          <Text style={{ textAlign: "right", marginTop: 2, color: "#4b5563" }}>
            ({money(data.refundAmtUsd, "USD")} / {money(data.refundAmtInr, "INR")})
          </Text>
        )}
      </View>
      <Footer remark={data.remark} />
    </>
  );
}

function CsbFilingBody({ data }: { data: Extract<DocStatementData, { kind: "csb_filing" }> }) {
  return (
    <>
      <View style={{ marginBottom: 10 }}>
        <Text style={styles.sectionTitle}>CSB-V FILING</Text>
        <Field label="CSB Number" value={data.csbNumber} />
        <Field label="Filing Date" value={data.filingDate} />
        <Field label="HAWB Number" value={data.hawbNumber} />
        <Field label="Invoice No." value={data.invoiceNo} />
        <Field label="Invoice Date" value={data.invoiceDate} />
        <Field label="EGM Number" value={data.egmNumber} />
        <Field label="EGM Date" value={data.egmDate} />
        <Field label="Exchange Rate" value={data.exchangeRate} />
        <Field label="Taxable Value Currency" value={data.taxableValueCurrency} />
        <View style={styles.totalRow}>
          <Text>Total Taxable Value</Text>
          <Text>{money(data.totalTaxableValue, data.taxableValueCurrency ?? "")}</Text>
        </View>
        <Field label="FOB Value (INR)" value={money(data.fobValueInr, "INR")} />
      </View>
      <Footer />
    </>
  );
}

function RefundBody({ data }: { data: Extract<DocStatementData, { kind: "refund" }> }) {
  return (
    <>
      <View style={{ marginBottom: 10 }}>
        <Text style={styles.sectionTitle}>HISTORICAL MARKETPLACE REFUND</Text>
        <Field label="Store" value={data.storeName} />
        <Field label="Source" value={data.source} />
        <Field label="Marketplace Order No." value={data.marketplaceOrderNo} />
        <Field label="Buyer" value={data.buyerName} />
        <Field label="Invoice No." value={data.invoiceNo} />
        <Field label="Status" value={data.status} />
        <Field label="Refund Type" value={data.refundType} />
        <Field label="Refund Date" value={data.refundDate} />
        <Field label="Order Amount" value={money(data.orderAmtUsd, "USD")} />
        {data.refundAmtPct != null && <Field label="Refund %" value={`${(data.refundAmtPct * 100).toFixed(1)}%`} />}
        <View style={styles.totalRow}>
          <Text>Refund Amount</Text>
          <Text>{money(data.refundAmtUsd, "USD")}</Text>
        </View>
      </View>
      <Footer remark={data.reason || data.remark} />
    </>
  );
}

function OrderRefundBody({ data }: { data: Extract<DocStatementData, { kind: "order_refund" }> }) {
  return (
    <>
      <View style={{ marginBottom: 10 }}>
        <Text style={styles.sectionTitle}>ORDER REFUND</Text>
        <Field label="Order Ref" value={data.orderRefNo} />
        <Field label="Buyer" value={data.buyerName} />
        <Field label="Order Status" value={data.orderStatus} />
        <Field label="Refund Date" value={data.refundDate} />
        <Field label="Linked Credit Note" value={data.creditNoteNo} />
        {data.refundBasisPercent != null && <Field label="Refund Basis %" value={`${data.refundBasisPercent}%`} />}
        {data.orderValueRefundAmount != null && <Field label="Order Value Refund" value={money(data.orderValueRefundAmount)} />}
        {data.shippingRefundAmount != null && <Field label="Shipping Refund" value={money(data.shippingRefundAmount)} />}
        {data.dutyRefundAmount != null && <Field label="Duty & Tax Refund" value={money(data.dutyRefundAmount)} />}
        <View style={styles.totalRow}>
          <Text>Refund Amount</Text>
          <Text>{money(data.refundAmount, data.refundCurrency)}</Text>
        </View>
        {(data.refundAmountUsd != null || data.refundAmountInr != null) && (
          <Text style={{ textAlign: "right", marginTop: 2, color: "#4b5563" }}>
            ({money(data.refundAmountUsd, "USD")} / {money(data.refundAmountInr, "INR")})
          </Text>
        )}
      </View>
      <Footer remark={data.reason} />
    </>
  );
}

function DocStatementPdfDocument({ data }: { data: DocStatementData }) {
  return (
    <Document title={`${data.docTitle} ${data.invoiceRef}`} author={data.companyName}>
      <Page size="A4" style={styles.page}>
        <Letterhead data={data} />
        {data.kind === "credit_note" && <CreditNoteBody data={data} />}
        {data.kind === "csb_filing" && <CsbFilingBody data={data} />}
        {data.kind === "refund" && <RefundBody data={data} />}
        {data.kind === "order_refund" && <OrderRefundBody data={data} />}
      </Page>
    </Document>
  );
}

export async function renderDocStatementPdf(data: DocStatementData): Promise<Buffer> {
  return renderPdfToBuffer(<DocStatementPdfDocument data={data} />);
}
