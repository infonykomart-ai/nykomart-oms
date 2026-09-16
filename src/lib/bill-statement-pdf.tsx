// 2026-09-15 — "jo ye file generate ho rahi hai vo a4 ke page par honi
// chahiye portrait me... company logo ke sath" — the BILL STATEMENT as a
// real PDF FILE (not just window.print()): server-rendered with
// @react-pdf/renderer (same pure-JS choice as fedex-invoice-pdf.tsx — no
// headless browser, no native binary, safe on Vercel serverless), A4
// PORTRAIT, company logo header, every statement section (vendor block,
// PO lines / per-AWB lines, bill summary, payments, wallet settlements,
// CN/DN adjustments, vendor bank details) — the same data shape as the
// dialog's HTML document (BillStatementData), so PDF and screen can never
// disagree. This is the file the 📱 WhatsApp / ✉️ Email / Telegram buttons
// download and attach ("agar whatsaap email par update bhej rahe hai to
// pdf file bhi jani chahiye na").
import React from "react";
import { Document, Page, Text, View, StyleSheet, Image, pdf } from "@react-pdf/renderer";
import type { BillStatementData } from "@/lib/bill-statement";

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
  tableHeader: { flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: "#9ca3af", paddingBottom: 2, marginBottom: 2, fontSize: 7, color: "#6b7280", textTransform: "uppercase" },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb", paddingVertical: 2 },
  col: { flex: 1 },
  colNarrow: { flex: 0.7 },
  right: { textAlign: "right" },
  bold: { fontWeight: 700 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  summaryDivider: { borderTopWidth: 0.75, borderTopColor: "#9ca3af", fontWeight: 700 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1.5, borderTopColor: "#111827", paddingVertical: 4, fontSize: 10.5, fontWeight: 700 },
  footer: { marginTop: 14, fontSize: 7, color: "#6b7280" },
  italic: { fontStyle: "italic", marginTop: 6 },
});

const inr = (n: number) => `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dash = (v: string | null | undefined) => (v && v.trim() ? v : "-");

function StatementPdfDocument({ data }: { data: BillStatementData }) {
  const { bill, party, company, profile, companyName } = data;
  return (
    <Document title={`Bill Statement ${data.invoiceRef} — ${party.name}`} author={companyName}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>{data.docTitle}</Text>
        <View style={styles.headerRow}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", flex: 1 }}>
            {/* react-pdf's Image is a PDF primitive — it has no alt prop
                (eslint jsx-a11y doesn't know that, hence the disable). */}
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
            <Text>Bank: {dash(profile?.bank_name)}</Text>
            <Text>A/C No.: {dash(profile?.account_no)}</Text>
            <Text>IFSC: {dash(profile?.ifsc_code)}</Text>
          </View>
        </View>

        <View style={styles.twoCol}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={styles.sectionTitle}>VENDOR</Text>
            <Text style={styles.bold}>{party.name}</Text>
            <Text style={styles.companyLine}>{dash(party.address)}</Text>
            {party.contact_no ? <Text style={styles.companyLine}>Phone: {party.contact_no}</Text> : null}
            {party.email ? <Text style={styles.companyLine}>Email: {party.email}</Text> : null}
            {party.gst ? <Text style={styles.companyLine}>GST: {party.gst}</Text> : null}
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>BILL DETAILS</Text>
            <Text>Invoice No.: {data.invoiceRef}</Text>
            <Text>Bill Date: {dash(bill.invoice_date)}</Text>
            <Text>Received: {dash(bill.invoice_recv_date)}</Text>
            <Text>Due Date: {dash(bill.due_date)}</Text>
            <Text>Type: {dash(bill.invoice_type)}</Text>
            <Text>Company: {companyName}</Text>
          </View>
        </View>

        {data.poLines.length > 0 && (
          <View style={{ marginBottom: 10 }}>
            <Text style={styles.sectionTitle}>PURCHASE LINE ITEMS</Text>
            <View style={styles.tableHeader}>
              <Text style={styles.col}>Order Ref</Text>
              <Text style={{ ...styles.col, flex: 1.6 }}>Description</Text>
              <Text style={{ ...styles.colNarrow, ...styles.right }}>Qty</Text>
              <Text style={styles.colNarrow}>Unit</Text>
              <Text style={{ ...styles.colNarrow, ...styles.right }}>Rate</Text>
              <Text style={{ ...styles.colNarrow, ...styles.right }}>Amount</Text>
            </View>
            {data.poLines.map((l, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={styles.col}>{dash(l.refNo)}</Text>
                <Text style={{ ...styles.col, flex: 1.6 }}>{dash(l.description)}</Text>
                <Text style={{ ...styles.colNarrow, ...styles.right }}>{l.qty}</Text>
                <Text style={styles.colNarrow}>{l.unit}</Text>
                <Text style={{ ...styles.colNarrow, ...styles.right }}>{inr(l.rate)}</Text>
                <Text style={{ ...styles.colNarrow, ...styles.right }}>{inr(l.amount)}</Text>
              </View>
            ))}
          </View>
        )}

        {data.awbLines.length > 0 && (
          <View style={{ marginBottom: 10 }}>
            <Text style={styles.sectionTitle}>SHIPMENTS ON THIS BILL ({data.awbLines.length})</Text>
            <View style={styles.tableHeader}>
              <Text style={{ ...styles.col, flex: 1.4 }}>AWB / Tracking No.</Text>
              <Text style={styles.col}>Order Ref</Text>
              <Text style={{ ...styles.colNarrow, ...styles.right }}>Weight (kg)</Text>
              <Text style={{ ...styles.colNarrow, ...styles.right }}>Billed Rs.</Text>
            </View>
            {data.awbLines.map((l, i) => (
              <View key={i} style={styles.tableRow}>
                <Text style={{ ...styles.col, flex: 1.4 }}>{l.awb}</Text>
                <Text style={styles.col}>{dash(l.refNo)}</Text>
                <Text style={{ ...styles.colNarrow, ...styles.right }}>{l.weightKg != null ? l.weightKg.toFixed(3) : "-"}</Text>
                <Text style={{ ...styles.colNarrow, ...styles.right }}>{l.billedAmt != null ? inr(l.billedAmt) : "-"}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={{ marginBottom: 10 }}>
          <Text style={styles.sectionTitle}>BILL SUMMARY</Text>
          <View style={styles.summaryRow}>
            <Text>Bill Amount</Text>
            <Text>{inr(bill.total_amt)}</Text>
          </View>
          {bill.credit_note_amt > 0 && (
            <View style={styles.summaryRow}>
              <Text>Credit Note</Text>
              <Text>- {inr(bill.credit_note_amt)}</Text>
            </View>
          )}
          {bill.adj_amt > 0 && (
            <View style={styles.summaryRow}>
              <Text>CN/DN Adjustments</Text>
              <Text>- {inr(bill.adj_amt)}</Text>
            </View>
          )}
          <View style={[styles.summaryRow, styles.summaryDivider]}>
            <Text>Net Payable</Text>
            <Text>{inr(bill.total_amt - bill.credit_note_amt - bill.adj_amt)}</Text>
          </View>
          {data.settledTotal > 0 && (
            <View style={styles.summaryRow}>
              <Text>Paid (bank + wallet)</Text>
              <Text>- {inr(data.settledTotal)}</Text>
            </View>
          )}
          <View style={styles.totalRow}>
            <Text>{data.fullyPaid ? "STATUS: PAID IN FULL" : "BALANCE DUE"}</Text>
            <Text>{data.fullyPaid ? "PAID" : inr(data.outstanding)}</Text>
          </View>
        </View>

        {data.payments.length > 0 && (
          <View style={{ marginBottom: 10 }}>
            <Text style={styles.sectionTitle}>PAYMENTS RECEIVED FROM US ({data.payments.length})</Text>
            <View style={styles.tableHeader}>
              <Text style={styles.colNarrow}>Date</Text>
              <Text style={styles.colNarrow}>Mode</Text>
              <Text style={styles.col}>UTR / Ref No.</Text>
              <Text style={{ ...styles.colNarrow, ...styles.right }}>Amount</Text>
            </View>
            {data.payments.map((p) => (
              <View key={p.id} style={styles.tableRow}>
                <Text style={styles.colNarrow}>{p.payment_date}</Text>
                <Text style={styles.colNarrow}>{dash(p.payment_mode)}</Text>
                <Text style={styles.col}>{dash(p.reference_no)}</Text>
                <Text style={{ ...styles.colNarrow, ...styles.right }}>{inr(p.amount)}</Text>
              </View>
            ))}
          </View>
        )}

        {data.walletConsumes.length > 0 && (
          <View style={{ marginBottom: 10 }}>
            <Text style={styles.sectionTitle}>COURIER WALLET SETTLEMENT</Text>
            <View style={styles.tableHeader}>
              <Text style={styles.colNarrow}>Date</Text>
              <Text style={styles.col}>Mode / Ref</Text>
              <Text style={{ ...styles.colNarrow, ...styles.right }}>Amount</Text>
            </View>
            {data.walletConsumes.map((w) => (
              <View key={w.id} style={styles.tableRow}>
                <Text style={styles.colNarrow}>{w.txn_date}</Text>
                <Text style={styles.col}>{[w.payment_mode, w.reference_no].filter(Boolean).join(" - ") || "Wallet"}</Text>
                <Text style={{ ...styles.colNarrow, ...styles.right }}>{inr(w.amount)}</Text>
              </View>
            ))}
          </View>
        )}

        {data.adjustments.length > 0 && (
          <View style={{ marginBottom: 10 }}>
            <Text style={styles.sectionTitle}>CREDIT / DEBIT NOTE ADJUSTMENTS ({data.adjustments.length})</Text>
            <View style={styles.tableHeader}>
              <Text style={styles.colNarrow}>Date</Text>
              <Text style={{ ...styles.col, flex: 1.4 }}>Note</Text>
              <Text style={styles.col}>Remark</Text>
              <Text style={{ ...styles.colNarrow, ...styles.right }}>Amount</Text>
            </View>
            {data.adjustments.map((a) => (
              <View key={a.id} style={styles.tableRow}>
                <Text style={styles.colNarrow}>{a.createdDate}</Text>
                <Text style={{ ...styles.col, flex: 1.4 }}>{a.label}</Text>
                <Text style={styles.col}>{dash(a.remark)}</Text>
                <Text style={{ ...styles.colNarrow, ...styles.right }}>{inr(a.amount)}</Text>
              </View>
            ))}
          </View>
        )}

        {(party.bank_name || party.account_no) && (
          <View style={{ marginBottom: 10 }}>
            <Text style={styles.sectionTitle}>VENDOR BANK DETAILS</Text>
            <Text>
              {[
                party.bank_name && `Bank: ${party.bank_name}`,
                party.account_no && `A/C: ${party.account_no}`,
                party.ifsc_code && `IFSC: ${party.ifsc_code}`,
                party.account_holder_name && `Holder: ${party.account_holder_name}`,
              ]
                .filter(Boolean)
                .join(" - ")}
            </Text>
          </View>
        )}

        <View style={styles.footer}>
          <Text>Remark: {dash(bill.remark)}</Text>
          <Text style={styles.italic}>
            This is a computer-generated statement from the Nyko Mart Order Management System - no signature required.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

/**
 * Renders the bill statement to a real PDF file (Buffer) — A4 portrait,
 * company logo header, all sections. Called from the API route the dialog
 * downloads through.
 */
export async function renderBillStatementPdf(data: BillStatementData): Promise<Buffer> {
  const instance = pdf(<StatementPdfDocument data={data} />);
  const blob = await instance.toBuffer();
  return await streamToBuffer(blob as unknown as NodeJS.ReadableStream);
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
