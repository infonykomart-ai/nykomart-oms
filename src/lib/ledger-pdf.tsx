// 2026-09-15 — "agar ladger bhi pdf bhejni ho to pdf to whatsaap or email
// par a4 ke page par portrait me sabhi fixes ke sath jaye company logo ke
// sath" — the PARTY LEDGER as a real PDF file, server-rendered with
// @react-pdf/renderer (same pure-JS choice as bill-statement-pdf.tsx and
// fedex-invoice-pdf.tsx — no headless browser, safe on serverless), A4
// PORTRAIT, company logo + profile header, the exact on-screen ledger
// columns (Date / Invoice No. / Particulars / Mode / UTR / Debit / Credit
// / Balance), running balance per row and the Total Debit / Total Credit /
// Closing Balance footer. The data comes from the ledger page itself via
// the /api/ledger-pdf POST (see src/app/api/ledger-pdf/route.ts) — the
// same exportRows + totals the screen shows, so PDF can never disagree
// with the ledger. This is the file ExportBar's 📱 WhatsApp / ✉️ Email /
// ☁️ Telegram buttons attach when the caller passes pdfEndpoint.
import React from "react";
import { Document, Page, Text, View, StyleSheet, Image, pdf } from "@react-pdf/renderer";

export type LedgerPdfParty = {
  name: string;
  party_type: string | null;
  contact_no: string | null;
  email: string | null;
  gst: string | null;
};

export type LedgerPdfInput = {
  party: LedgerPdfParty;
  companyName: string;
  profile: {
    address: string | null;
    phone: string | null;
    email: string | null;
    gstin: string | null;
  } | null;
  logoUrl: string | null;
  // Scope the ledger was viewed with (echoed under the title).
  scopeLine: string;
  rows: {
    date: string;
    invoice_no: string;
    particulars: string;
    payment_mode: string;
    reference_no: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
};

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 8, fontFamily: "Helvetica", color: "#111827" },
  title: { fontSize: 12, fontWeight: 700, textAlign: "right", marginBottom: 6 },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", borderBottomWidth: 2, borderBottomColor: "#111827", paddingBottom: 10, marginBottom: 8 },
  logo: { width: 42, height: 42, objectFit: "contain", marginRight: 8 },
  companyName: { fontSize: 14, fontWeight: 700 },
  companyLine: { fontSize: 7.5, color: "#4b5563" },
  rightBlock: { textAlign: "right", fontSize: 7, lineHeight: 1.5 },
  partyRow: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 0.75, borderBottomColor: "#d1d5db", paddingBottom: 8, marginBottom: 8 },
  sectionTitle: { fontSize: 8.5, fontWeight: 700, marginBottom: 4 },
  tableHeader: { flexDirection: "row", borderBottomWidth: 0.75, borderBottomColor: "#9ca3af", paddingBottom: 2, marginBottom: 2, fontSize: 7, color: "#6b7280", textTransform: "uppercase" },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb", paddingVertical: 2 },
  colDate: { width: 52 },
  colInvoice: { width: 74 },
  colParticulars: { flex: 1, paddingRight: 6 },
  colMode: { width: 44 },
  colUtr: { width: 78 },
  colAmt: { width: 58, textAlign: "right" },
  colBal: { width: 64, textAlign: "right" },
  bold: { fontWeight: 700 },
  muted: { color: "#6b7280" },
  right: { textAlign: "right" },
  totals: { marginTop: 8, alignSelf: "flex-end", width: 220 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  totalsDivider: { borderTopWidth: 0.75, borderTopColor: "#9ca3af" },
  grand: { flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1.5, borderTopColor: "#111827", paddingVertical: 4, fontSize: 10, fontWeight: 700 },
  footer: { marginTop: 14, fontSize: 7, color: "#6b7280" },
  italic: { fontStyle: "italic", marginTop: 6 },
});

const inr = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dash = (v: string | null | undefined) => (v && v.trim() ? v : "-");

function LedgerPdfDocument({ input }: { input: LedgerPdfInput }) {
  const { party, companyName, profile, logoUrl, rows, totalDebit, totalCredit, closingBalance } = input;
  return (
    <Document title={`Party Ledger — ${party.name}`} author={companyName}>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>PARTY LEDGER</Text>
        <View style={styles.headerRow}>
          <View style={{ flexDirection: "row", alignItems: "flex-start", flex: 1 }}>
            {/* react-pdf's Image is a PDF primitive — no alt prop exists. */}
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            {logoUrl ? <Image src={logoUrl} style={styles.logo} /> : null}
            <View>
              <Text style={styles.companyName}>{companyName}</Text>
              <Text style={styles.companyLine}>{dash(profile?.address)}</Text>
              <Text style={styles.companyLine}>{profile?.phone ? `Phone: ${profile.phone}` : ""}</Text>
              <Text style={styles.companyLine}>Email: {dash(profile?.email)}</Text>
            </View>
          </View>
          <View style={styles.rightBlock}>
            <Text>GSTIN: {dash(profile?.gstin)}</Text>
            <Text>Generated: {new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</Text>
            <Text>{input.scopeLine}</Text>
          </View>
        </View>

        <View style={styles.partyRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>PARTY</Text>
            <Text style={styles.bold}>{party.name}</Text>
            {party.party_type ? <Text style={styles.companyLine}>{party.party_type}</Text> : null}
            {party.contact_no ? <Text style={styles.companyLine}>Phone: {party.contact_no}</Text> : null}
            {party.email ? <Text style={styles.companyLine}>Email: {party.email}</Text> : null}
          </View>
          {party.gst ? (
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>GST</Text>
              <Text>{party.gst}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionTitle}>LEDGER ENTRIES ({rows.length})</Text>
        <View style={styles.tableHeader}>
          <Text style={styles.colDate}>Date</Text>
          <Text style={styles.colInvoice}>Invoice No.</Text>
          <Text style={styles.colParticulars}>Particulars</Text>
          <Text style={styles.colMode}>Mode</Text>
          <Text style={styles.colUtr}>UTR / Ref</Text>
          <Text style={styles.colAmt}>Debit</Text>
          <Text style={styles.colAmt}>Credit</Text>
          <Text style={styles.colBal}>Balance</Text>
        </View>
        {rows.map((r, i) => (
          <View key={i} style={styles.tableRow} wrap={false}>
            <Text style={styles.colDate}>{r.date}</Text>
            <Text style={styles.colInvoice}>{dash(r.invoice_no)}</Text>
            <Text style={styles.colParticulars}>{dash(r.particulars)}</Text>
            <Text style={styles.colMode}>{dash(r.payment_mode)}</Text>
            <Text style={styles.colUtr}>{dash(r.reference_no)}</Text>
            <Text style={styles.colAmt}>{r.debit > 0 ? inr(r.debit) : ""}</Text>
            <Text style={styles.colAmt}>{r.credit > 0 ? inr(r.credit) : ""}</Text>
            <Text style={{ ...styles.colBal, ...styles.muted }}>{inr(r.balance)}</Text>
          </View>
        ))}

        <View style={styles.totals}>
          <View style={styles.totalsRow}>
            <Text style={styles.muted}>Total Debit</Text>
            <Text style={styles.right}>{inr(totalDebit)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.muted}>Total Credit</Text>
            <Text style={styles.right}>{inr(totalCredit)}</Text>
          </View>
          <View style={[styles.totalsRow, styles.totalsDivider]} />
          <View style={styles.grand}>
            <Text>{closingBalance > 0.005 ? "WE OWE (Payable)" : closingBalance < -0.005 ? "IN OUR CREDIT" : "SETTLED"}</Text>
            <Text>{inr(Math.abs(closingBalance))}</Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.italic}>
            Computer-generated ledger from the Nyko Mart Order Management System — closing balance convention: positive = payable to the party, negative = party in credit with us.
          </Text>
        </View>
      </Page>
    </Document>
  );
}

/**
 * Renders the party ledger to a real PDF file (Buffer) — A4 portrait,
 * company logo header, the exact on-screen columns and totals.
 */
export async function renderLedgerPdf(input: LedgerPdfInput): Promise<Buffer> {
  const instance = pdf(<LedgerPdfDocument input={input} />);
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
