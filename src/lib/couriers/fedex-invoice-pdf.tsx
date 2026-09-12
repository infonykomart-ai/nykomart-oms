// 2026-09-12 — "I will upload my own invoice" (FedEx's 3rd Commercial
// Invoice Method option, the one still not built as of this morning's
// rounds — see fedex-ship.ts's electronicInvoiceType header comment for the
// full history). This is the missing piece that unblocks it: this app had
// NO PDF-file-generation capability anywhere (confirmed by grepping
// package.json for puppeteer/playwright/pdfkit/pdf-lib/react-pdf/jspdf —
// no matches, and the only existing "invoice" is invoice-view.tsx, an HTML
// page a person prints from their own browser via window.print(), not a
// server-generated PDF FILE FedEx's Upload Documents API could accept).
//
// Deliberately NOT a port of invoice-view.tsx's exact CSB-V layout (that's
// a separate, manually-managed system — broker info, PID columns, VAT/
// EORI/IOSS, value-percent formulas — generated and edited on its own
// schedule under /dashboard/invoices, independent of when a courier gets
// booked). Wiring THIS feature to that system would mean generating/
// editing a real CSB-V invoice record automatically mid-booking, before
// the employee has had any chance to review it — a bigger, riskier change
// than what was actually asked for. Instead this is a NEW, simpler,
// self-contained commercial invoice built straight from the exact same
// data already being declared to FedEx's Ship API in this same request
// (shipper/recipient/commodity/value — see createFedexShipment in
// fedex-ship.ts) — functionally complete for customs purposes (everything
// a commercial invoice needs: parties, invoice no./date, goods
// description, HS/tariff code, quantity, value, currency, country of
// origin/destination, incoterm, declaration statement) even though its
// visual design differs from the internal CSB-V print view.
//
// Chosen over rendering the actual HTML invoice view via a headless
// browser (Puppeteer/Chromium) specifically to avoid adding a large native
// binary dependency to this app's Vercel serverless deployment — a
// well-known source of "works locally, breaks in prod" deploy failures.
// @react-pdf/renderer is pure JS, has no native dependency, and is a
// standard, low-risk choice for exactly this (build a real PDF file from
// React components, server-side, in a serverless function).
//
// Honest limitation: this has NOT been visually reviewed by a human yet —
// unlike the rest of this file's siblings, there's no existing "known
// correct" version of this specific document to compare against. Worth a
// look at a sample PDF before relying on it for a real shipment.

import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 9, fontFamily: "Helvetica", color: "#111827" },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10, borderBottomWidth: 2, borderBottomColor: "#111827", paddingBottom: 8 },
  title: { fontSize: 13, fontWeight: 700 },
  badge: { fontSize: 8, borderWidth: 1, borderColor: "#111827", paddingVertical: 2, paddingHorizontal: 6 },
  section: { marginBottom: 8, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: "#D1D5DB" },
  row: { flexDirection: "row" },
  col: { flex: 1 },
  label: { fontSize: 8, fontWeight: 700, marginBottom: 2, color: "#374151" },
  value: { fontSize: 9, marginBottom: 1 },
  table: { borderWidth: 1, borderColor: "#9CA3AF", marginBottom: 8 },
  tr: { flexDirection: "row" },
  th: { flex: 1, fontSize: 8, fontWeight: 700, padding: 4, borderRightWidth: 1, borderRightColor: "#9CA3AF", borderBottomWidth: 1, borderBottomColor: "#9CA3AF", backgroundColor: "#F3F4F6" },
  td: { flex: 1, fontSize: 8.5, padding: 4, borderRightWidth: 1, borderRightColor: "#D1D5DB", borderBottomWidth: 1, borderBottomColor: "#D1D5DB" },
  tdRight: { textAlign: "right" },
  totalRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: 2 },
  totalLabel: { fontSize: 9.5, fontWeight: 700, marginRight: 12 },
  totalValue: { fontSize: 9.5, fontWeight: 700 },
  declaration: { fontSize: 8, lineHeight: 1.4, color: "#374151", marginTop: 10 },
  signatureBox: { marginTop: 28, alignItems: "flex-end" },
  signatureLine: { width: 180, borderTopWidth: 1, borderTopColor: "#374151", paddingTop: 3, fontSize: 8, textAlign: "center" },
});

export type FedexInvoicePdfParty = {
  companyName?: string | null;
  contactName: string;
  address1: string;
  address2?: string | null;
  city: string;
  state?: string | null;
  postalCode: string;
  countryCode: string;
  phone?: string | null;
};

export type FedexInvoicePdfInput = {
  invoiceNo: string;
  masterInvoiceNo?: string | null;
  invoiceDate: string; // YYYY-MM-DD
  shipmentPurpose?: string | null; // SOLD / GIFT / SAMPLE / ...
  incoterm: "DDP" | "DDU";
  shipper: FedexInvoicePdfParty & { iec?: string | null; gstin?: string | null; adCode?: string | null };
  recipient: FedexInvoicePdfParty;
  item: {
    description: string;
    hsCode?: string | null;
    harmonizedTariffNumber?: string | null;
    qty: number;
    unitValue: number;
    totalValue: number;
    currency: string;
  };
  weightKg: number;
  dimsCm: { length: number; width: number; height: number };
};

function partyBlock(p: FedexInvoicePdfParty) {
  const lines = [p.companyName, p.contactName, p.address1, p.address2, `${p.city}${p.state ? `, ${p.state}` : ""} ${p.postalCode}`, p.countryCode, p.phone ? `Tel: ${p.phone}` : null].filter(
    Boolean
  ) as string[];
  return lines;
}

const SHIPMENT_PURPOSE_LABELS: Record<string, string> = {
  SOLD: "Commercial — Sold",
  NOT_SOLD: "Personal Use — Not Sold",
  GIFT: "Gift",
  SAMPLE: "Sample",
  PERSONAL_EFFECTS: "Personal Effects",
  REPAIR_AND_RETURN: "Repair and Return",
};

export function FedexCommercialInvoiceDocument({ input }: { input: FedexInvoicePdfInput }) {
  const shipperLines = partyBlock(input.shipper);
  const recipientLines = partyBlock(input.recipient);
  const purposeLabel = input.shipmentPurpose ? SHIPMENT_PURPOSE_LABELS[input.shipmentPurpose] ?? input.shipmentPurpose : "Commercial — Sold";

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>COMMERCIAL INVOICE</Text>
          <Text style={styles.badge}>E-COM</Text>
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.label}>Invoice No. &amp; Date</Text>
              <Text style={styles.value}>
                {input.invoiceNo} · {input.invoiceDate}
              </Text>
              {input.masterInvoiceNo && <Text style={{ fontSize: 7.5, color: "#6B7280" }}>Master Invoice No.: {input.masterInvoiceNo}</Text>}
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Reason for Export</Text>
              <Text style={styles.value}>{purposeLabel}</Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Terms of Delivery</Text>
              <Text style={styles.value}>{input.incoterm === "DDP" ? "DDP — Duties Paid by Shipper" : "DDU/DAP — Duties Paid by Recipient"}</Text>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.label}>SHIPPER / EXPORTER</Text>
              {shipperLines.map((l, i) => (
                <Text key={i} style={styles.value}>
                  {l}
                </Text>
              ))}
              {input.shipper.iec && <Text style={{ fontSize: 7.5, color: "#6B7280", marginTop: 2 }}>I.E.C. No.: {input.shipper.iec}</Text>}
              {input.shipper.gstin && <Text style={{ fontSize: 7.5, color: "#6B7280" }}>GSTIN: {input.shipper.gstin}</Text>}
              {input.shipper.adCode && <Text style={{ fontSize: 7.5, color: "#6B7280" }}>Bank AD Code: {input.shipper.adCode}</Text>}
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>CONSIGNEE / RECIPIENT</Text>
              {recipientLines.map((l, i) => (
                <Text key={i} style={styles.value}>
                  {l}
                </Text>
              ))}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.label}>Country of Origin of Goods</Text>
              <Text style={styles.value}>{input.shipper.countryCode === "IN" ? "INDIA" : input.shipper.countryCode}</Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Country of Final Destination</Text>
              <Text style={styles.value}>{input.recipient.countryCode}</Text>
            </View>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tr}>
            <Text style={[styles.th, { flex: 2.4 }]}>Description of Goods</Text>
            <Text style={styles.th}>HSN</Text>
            <Text style={styles.th}>Harmonized Tariff No.</Text>
            <Text style={[styles.th, styles.tdRight]}>Qty</Text>
            <Text style={[styles.th, styles.tdRight]}>Unit Value ({input.item.currency})</Text>
            <Text style={[styles.th, styles.tdRight, { borderRightWidth: 0 }]}>Amount ({input.item.currency})</Text>
          </View>
          <View style={styles.tr}>
            <Text style={[styles.td, { flex: 2.4 }]}>{input.item.description}</Text>
            <Text style={styles.td}>{input.item.hsCode || "—"}</Text>
            <Text style={styles.td}>{input.item.harmonizedTariffNumber || "—"}</Text>
            <Text style={[styles.td, styles.tdRight]}>{input.item.qty}</Text>
            <Text style={[styles.td, styles.tdRight]}>{input.item.unitValue.toFixed(2)}</Text>
            <Text style={[styles.td, styles.tdRight, { borderRightWidth: 0 }]}>{input.item.totalValue.toFixed(2)}</Text>
          </View>
        </View>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>TOTAL INVOICE VALUE</Text>
          <Text style={styles.totalValue}>
            {input.item.currency} {input.item.totalValue.toFixed(2)}
          </Text>
        </View>

        <View style={[styles.section, { marginTop: 12 }]}>
          <View style={styles.row}>
            <View style={styles.col}>
              <Text style={styles.label}>Weight</Text>
              <Text style={styles.value}>{input.weightKg.toFixed(3)} KG</Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>Dimensions (L × W × H)</Text>
              <Text style={styles.value}>
                {input.dimsCm.length} × {input.dimsCm.width} × {input.dimsCm.height} cm
              </Text>
            </View>
            <View style={styles.col}>
              <Text style={styles.label}>No. of Packages</Text>
              <Text style={styles.value}>1</Text>
            </View>
          </View>
        </View>

        <Text style={styles.declaration}>
          We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.
        </Text>

        <View style={styles.signatureBox}>
          <Text style={styles.signatureLine}>Signature &amp; Date</Text>
        </View>
      </Page>
    </Document>
  );
}

/**
 * Renders the commercial invoice to a PDF file (Buffer), ready to hand to
 * FedEx's Upload Documents API as the `attachment` part. Pure JS —
 * @react-pdf/renderer has no native binary dependency, unlike a headless-
 * browser approach — safe to call from a Vercel serverless function.
 */
export async function renderFedexInvoicePdf(input: FedexInvoicePdfInput): Promise<Buffer> {
  const instance = pdf(<FedexCommercialInvoiceDocument input={input} />);
  const blob = await instance.toBuffer();
  // @react-pdf/renderer's Node build returns a Node Readable stream from
  // toBuffer() (despite the name) — collect it into a real Buffer.
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
