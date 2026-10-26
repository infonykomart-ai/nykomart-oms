// Human-readable companion to the weekly XLSX snapshot (2026-10-23).
//
// The workbook is the authoritative copy of every table. This PDF covers what
// a spreadsheet is bad at: opening on a phone, printing, and proving at a
// glance that the backup is complete — a cover with totals, the full table
// index (including anything skipped and why), and complete listings of the
// core order / bill / payment / courier records with their working columns.
//
// Detail listings are capped per table (DETAIL_ROW_LIMIT) so a pathological
// table can never produce a 10,000-page PDF; whenever the cap bites, the page
// says so explicitly and points at the workbook, which is never capped below
// the snapshot's own safety limits.
import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { renderPdfToBuffer } from "@/lib/pdf/render";
import type { SnapshotData } from "@/lib/backup/snapshot";

const DETAIL_ROW_LIMIT = 3000;

const styles = StyleSheet.create({
  page: { padding: 28, fontSize: 7.5, fontFamily: "Helvetica", color: "#111827" },
  coverTitle: { fontSize: 20, fontWeight: 700, marginTop: 90 },
  coverSubtitle: { fontSize: 10, color: "#4b5563", marginTop: 6 },
  coverMeta: { marginTop: 26, fontSize: 9, lineHeight: 1.6 },
  coverRule: { borderTopWidth: 2, borderTopColor: "#111827", marginTop: 14, marginBottom: 14 },
  coverNote: { marginTop: 28, fontSize: 8, color: "#4b5563", lineHeight: 1.5 },
  sectionTitle: { fontSize: 11, fontWeight: 700, marginBottom: 6 },
  sectionHint: { fontSize: 7.5, color: "#6b7280", marginBottom: 6 },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 0.75,
    borderBottomColor: "#9ca3af",
    paddingBottom: 2,
    marginBottom: 2,
    fontSize: 6.5,
    color: "#6b7280",
    textTransform: "uppercase",
  },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb", paddingVertical: 1.5 },
  cell: { flex: 1, paddingRight: 3 },
  numeric: { textAlign: "right" },
  muted: { color: "#6b7280" },
  footer: {
    position: "absolute",
    bottom: 14,
    left: 28,
    right: 28,
    fontSize: 6.5,
    color: "#9ca3af",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2, fontSize: 9 },
  totalValue: { fontWeight: 700 },
});

const inr = (n: number) =>
  `Rs. ${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function sumColumn(rows: Array<Record<string, unknown>>, column: string): number {
  let total = 0;
  for (const row of rows) total += num(row[column]) ?? 0;
  return total;
}

function display(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.length > 90 ? `${value.slice(0, 90)}…` : value;
  if (typeof value === "number") return value.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  if (typeof value === "boolean") return value ? "Yes" : "No";
  const json = JSON.stringify(value) ?? "";
  return json.length > 90 ? `${json.slice(0, 90)}…` : json;
}

/** Label + column list for the record types worth reading as a document. */
const DETAIL_TABLES: Array<{ table: string; title: string; columns: Array<{ key: string; label: string; numeric?: boolean; flex?: number }> }> = [
  {
    table: "orders",
    title: "Orders",
    columns: [
      { key: "ref_no", label: "Ref No.", flex: 1.1 },
      { key: "order_date", label: "Date", flex: 0.8 },
      { key: "status", label: "Status", flex: 1 },
      { key: "marketplace_order_no", label: "Marketplace No.", flex: 1.2 },
      { key: "sku_label", label: "SKU", flex: 1 },
      { key: "qty", label: "Qty", numeric: true, flex: 0.5 },
      { key: "buyer_country", label: "Country", flex: 0.9 },
      { key: "order_currency", label: "Cur.", flex: 0.5 },
      { key: "order_value_inr", label: "Value INR", numeric: true, flex: 1 },
    ],
  },
  {
    table: "sales_invoices",
    title: "Sales Invoices",
    columns: [
      { key: "invoice_no", label: "Invoice No.", flex: 1.2 },
      { key: "invoice_date", label: "Date", flex: 0.8 },
      { key: "csb_type", label: "CSB", flex: 0.6 },
      { key: "courier_company", label: "Courier", flex: 1 },
      { key: "destination_country", label: "Destination", flex: 1 },
      { key: "awb_no", label: "AWB", flex: 1.2 },
      { key: "invoice_value_usd", label: "USD", numeric: true, flex: 0.8 },
      { key: "taxable_value_inr", label: "Taxable INR", numeric: true, flex: 1 },
    ],
  },
  {
    table: "purchase_bills",
    title: "Purchase Bills",
    columns: [
      { key: "vendor_invoice_no", label: "Vendor Invoice", flex: 1.3 },
      { key: "vendor_invoice_date", label: "Date", flex: 0.8 },
      { key: "qty", label: "Qty", numeric: true, flex: 0.5 },
      { key: "qty_unit", label: "Unit", flex: 0.6 },
      { key: "unit_rate", label: "Rate", numeric: true, flex: 0.8 },
      { key: "total_amount", label: "Amount", numeric: true, flex: 1 },
      { key: "g_total_plus_gst", label: "With GST", numeric: true, flex: 1 },
      { key: "work_description", label: "Work", flex: 1.4 },
    ],
  },
  {
    table: "dispatch_invoices",
    title: "Dispatch & Invoice",
    columns: [
      { key: "invoice_no", label: "Invoice No.", flex: 1.2 },
      { key: "invoice_date", label: "Date", flex: 0.8 },
      { key: "awb_no", label: "AWB", flex: 1.2 },
      { key: "buyer_country", label: "Country", flex: 0.9 },
      { key: "courier_name", label: "Courier", flex: 1 },
      { key: "invoice_amt_usd", label: "USD", numeric: true, flex: 0.8 },
      { key: "total_amt", label: "Total", numeric: true, flex: 1 },
      { key: "delivered_status", label: "Delivered", flex: 0.9 },
    ],
  },
  {
    table: "bill_pass_register",
    title: "Bills Payable Register",
    columns: [
      { key: "invoice_no", label: "Invoice No.", flex: 1.2 },
      { key: "vendor_invoice_no", label: "Vendor Invoice", flex: 1.2 },
      { key: "invoice_type", label: "Type", flex: 0.9 },
      { key: "invoice_date", label: "Date", flex: 0.8 },
      { key: "total_amt", label: "Bill Amt", numeric: true, flex: 1 },
      { key: "total_paid", label: "Paid", numeric: true, flex: 1 },
      { key: "balance_due", label: "Balance", numeric: true, flex: 1 },
      { key: "approval_status", label: "Status", flex: 0.9 },
    ],
  },
  {
    table: "bill_pass_register_payments",
    title: "Bill Payments",
    columns: [
      { key: "payment_date", label: "Date", flex: 0.8 },
      { key: "amount", label: "Amount", numeric: true, flex: 1 },
      { key: "payment_mode", label: "Mode", flex: 0.8 },
      { key: "reference_no", label: "UTR / Ref", flex: 1.3 },
      { key: "remark", label: "Remark", flex: 1.6 },
    ],
  },
  {
    table: "courier_shipments",
    title: "Courier Bookings",
    columns: [
      { key: "courier", label: "Courier", flex: 0.8 },
      { key: "awb_no", label: "AWB", flex: 1.3 },
      { key: "status", label: "Status", flex: 0.8 },
      { key: "booked_amt", label: "Booked", numeric: true, flex: 0.9 },
      { key: "booked_currency", label: "Cur.", flex: 0.5 },
      { key: "created_at", label: "Created", flex: 1.3 },
    ],
  },
  {
    table: "journal_vouchers",
    title: "Journal Vouchers",
    columns: [
      { key: "jv_no", label: "JV No.", flex: 1 },
      { key: "jv_date", label: "Date", flex: 0.8 },
      { key: "vendor_invoice_no", label: "Vendor Invoice", flex: 1.3 },
      { key: "debit_amount", label: "Debit", numeric: true, flex: 1 },
      { key: "particulars", label: "Particulars", flex: 2.2 },
    ],
  },
];

export type ReportPdfInput = {
  snapshot: SnapshotData;
  /** Company names, for the cover — "Nyko Mart" alone would understate a 3-company business. */
  companies: string[];
  /** File names stored alongside this PDF, shown on the cover. */
  files: { xlsx: string; pdf: string };
};

/**
 * Page footer. `fixed` makes it repeat on every PAGE OF ITS OWN <Page>
 * component, so it has to be mounted in each Page (cover, index, details) —
 * react-pdf does not carry a fixed element across separate Page components.
 */
function PdfFooter() {
  return (
    <Text
      style={styles.footer}
      fixed
      render={({ pageNumber, totalPages }) => `Nyko Mart - data snapshot - page ${pageNumber} of ${totalPages}`}
    />
  );
}

function CoverPage({ input }: { input: ReportPdfInput }) {
  const { snapshot, companies, files } = input;
  const byName = new Map(snapshot.tables.map((t) => [t.name, t.rows]));
  const orderValue = sumColumn(byName.get("orders") ?? [], "order_value_inr");
  const invoicesTaxable = sumColumn(byName.get("sales_invoices") ?? [], "taxable_value_inr");
  const billsTotal = sumColumn(byName.get("bill_pass_register") ?? [], "total_amt");
  const billsPaid = sumColumn(byName.get("bill_pass_register") ?? [], "total_paid");
  const billsDue = sumColumn(byName.get("bill_pass_register") ?? [], "balance_due");

  return (
    <Page size="A4" style={styles.page}>
      <PdfFooter />
      <Text style={styles.coverTitle}>Data Snapshot</Text>
      <Text style={styles.coverSubtitle}>Automated weekly backup - every table in this system</Text>
      <View style={styles.coverRule} />
      <View style={styles.coverMeta}>
        <Text>Generated (UTC): {snapshot.generatedAt}</Text>
        <Text>Companies: {companies.length > 0 ? companies.join(", ") : "-"}</Text>
        <Text>Tables captured: {snapshot.tables.length}</Text>
        <Text>Records captured: {snapshot.totalRows.toLocaleString("en-IN")}</Text>
        <Text>Tables skipped: {snapshot.skipped.length}</Text>
        <Text>Files: {files.xlsx} (all data) + {files.pdf} (this report)</Text>
      </View>

      <View style={{ marginTop: 26 }}>
        <Text style={styles.sectionTitle}>Key totals</Text>
        <View style={styles.totalRow}>
          <Text>Order value (INR, orders.order_value_inr)</Text>
          <Text style={styles.totalValue}>{inr(orderValue)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text>Taxable value on sales invoices (INR)</Text>
          <Text style={styles.totalValue}>{inr(invoicesTaxable)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text>Bills payable - billed</Text>
          <Text style={styles.totalValue}>{inr(billsTotal)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text>Bills payable - paid</Text>
          <Text style={styles.totalValue}>{inr(billsPaid)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text>Bills payable - outstanding</Text>
          <Text style={styles.totalValue}>{inr(billsDue)}</Text>
        </View>
      </View>

      <Text style={styles.coverNote}>
        This report is the readable summary. The companion Excel workbook contains every row of every table, exactly as
        it existed at the moment above - use it to restore or re-import data. Both files are stored in the
        organisation&apos;s Cloudflare R2 bucket and can be downloaded again from Admin → Backup Export.
      </Text>
    </Page>
  );
}

function TableIndex({ input }: { input: ReportPdfInput }) {
  const { snapshot } = input;
  return (
    <Page size="A4" style={styles.page} wrap>
      <PdfFooter />
      <Text style={styles.sectionTitle}>Table index</Text>
      <Text style={styles.sectionHint}>
        One sheet per table in the workbook. &quot;Capped&quot; means the row-safety limit stopped the read early.
      </Text>
      <View style={styles.tableHeader}>
        <Text style={{ ...styles.cell, flex: 2.4 }}>Table</Text>
        <Text style={{ ...styles.cell, ...styles.numeric, flex: 1 }}>Rows</Text>
        <Text style={{ ...styles.cell, flex: 1.6 }}>Status</Text>
      </View>
      {snapshot.tables.map((table) => (
        <View key={table.name} style={styles.tableRow} wrap={false}>
          <Text style={{ ...styles.cell, flex: 2.4 }}>{table.name}</Text>
          <Text style={{ ...styles.cell, ...styles.numeric, flex: 1 }}>{table.rows.length.toLocaleString("en-IN")}</Text>
          <Text style={{ ...styles.cell, flex: 1.6 }}>{table.truncated ? "Capped" : "Complete"}</Text>
        </View>
      ))}
      {snapshot.skipped.length > 0 && (
        <View style={{ marginTop: 14 }}>
          <Text style={styles.sectionTitle}>Not captured</Text>
          {snapshot.skipped.map((skip) => (
            <View key={skip.name} style={styles.tableRow} wrap={false}>
              <Text style={{ ...styles.cell, flex: 2.4 }}>{skip.name}</Text>
              <Text style={{ ...styles.cell, ...styles.muted, flex: 4 }}>{skip.reason}</Text>
            </View>
          ))}
        </View>
      )}
    </Page>
  );
}

function DetailSection({ input, spec }: { input: ReportPdfInput; spec: (typeof DETAIL_TABLES)[number] }) {
  const table = input.snapshot.tables.find((t) => t.name === spec.table);
  if (!table) return null;
  const shown = table.rows.slice(0, DETAIL_ROW_LIMIT);
  const hidden = table.rows.length - shown.length;

  return (
    <Page size="A4" style={styles.page} wrap>
      <PdfFooter />
      <Text style={styles.sectionTitle}>
        {spec.title} ({table.rows.length.toLocaleString("en-IN")})
      </Text>
      <Text style={styles.sectionHint}>
        {spec.table}
        {hidden > 0 ? ` - showing the first ${DETAIL_ROW_LIMIT.toLocaleString("en-IN")}; the workbook has all ${table.rows.length.toLocaleString("en-IN")} rows.` : ""}
      </Text>
      <View style={styles.tableHeader} fixed>
        {spec.columns.map((col) => (
          <Text key={col.key} style={{ ...styles.cell, flex: col.flex ?? 1, ...(col.numeric ? styles.numeric : {}) }}>
            {col.label}
          </Text>
        ))}
      </View>
      {shown.map((row, index) => (
        <View key={index} style={styles.tableRow} wrap={false}>
          {spec.columns.map((col) => (
            <Text key={col.key} style={{ ...styles.cell, flex: col.flex ?? 1, ...(col.numeric ? styles.numeric : {}) }}>
              {display(row[col.key])}
            </Text>
          ))}
        </View>
      ))}
      {table.rows.length === 0 && <Text style={styles.muted}>No records in this table.</Text>}
      {hidden > 0 && (
        <Text style={{ ...styles.muted, marginTop: 6 }}>
          + {hidden.toLocaleString("en-IN")} more rows in {input.files.xlsx}
        </Text>
      )}
    </Page>
  );
}

function SnapshotPdfDocument({ input }: { input: ReportPdfInput }) {
  return (
    <Document
      title={`Data Snapshot ${input.snapshot.generatedAt}`}
      author="Nyko Mart Order Management System"
      subject="Automated weekly data backup"
    >
      <CoverPage input={input} />
      <TableIndex input={input} />
      {DETAIL_TABLES.map((spec) => (
        <DetailSection key={spec.table} input={input} spec={spec} />
      ))}
    </Document>
  );
}

export async function renderSnapshotReportPdf(input: ReportPdfInput): Promise<Buffer> {
  return renderPdfToBuffer(<SnapshotPdfDocument input={input} />);
}
