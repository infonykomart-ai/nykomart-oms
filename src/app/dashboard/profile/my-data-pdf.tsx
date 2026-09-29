// 2026-09-29 — Suggestion #2: "Download my data" — the signed-in employee's
// OWN profile record as a clean A4-portrait PDF, server-rendered with
// @react-pdf/renderer (the exact same pure-JS choice as ledger-pdf.tsx /
// bill-statement-pdf.tsx / fedex-invoice-pdf.tsx — no headless browser, so
// it's safe on serverless).
//
// Scope (deliberate): this is a PROFILE RECORD export, not an HR letter or
// a payslip — a single-page personal-data summary (work & access,
// personal, family, statutory/bank, recent security activity) in the same
// visual language as the redesigned profile page. It is the employee's OWN
// data, requested through their own authenticated session and re-read
// server-side — same trust model as viewing the page itself.
import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { renderPdfToBuffer } from "@/lib/pdf/render";

export type MyDataPdfInput = {
  employeeName: string;
  generatedAtLabel: string;
  companyName: string;
  roleName: string;
  // {label, value} pairs — value already "—" for null, so this component
  // stays presentational.
  identity: { label: string; value: string }[];
  personal: { label: string; value: string }[];
  family: { label: string; value: string }[];
  statutory: { label: string; value: string }[];
  activity: { when: string; label: string }[];
};

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#111827" },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: "#111827",
    paddingBottom: 10,
    marginBottom: 12,
  },
  docTitle: { fontSize: 16, fontWeight: 700 },
  docSub: { fontSize: 8, color: "#6b7280", marginTop: 2 },
  metaRight: { textAlign: "right", fontSize: 7.5, color: "#6b7280", lineHeight: 1.5 },
  nameRow: { fontSize: 12, fontWeight: 700, marginBottom: 2 },
  roleRow: { fontSize: 8.5, color: "#374151", marginBottom: 14 },
  section: { marginBottom: 12 },
  sectionTitle: {
    fontSize: 9,
    fontWeight: 700,
    color: "#111827",
    borderBottomWidth: 0.75,
    borderBottomColor: "#9ca3af",
    paddingBottom: 2,
    marginBottom: 4,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  label: { color: "#6b7280", width: "35%" },
  value: { textAlign: "right", fontWeight: 500, flex: 1 },
  activityRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  actLabel: { flex: 1 },
  actWhen: { color: "#6b7280", width: "38%", textAlign: "right" },
  footer: {
    position: "absolute",
    bottom: 30,
    left: 36,
    right: 36,
    fontSize: 7,
    color: "#9ca3af",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function Section({ title, rows }: { title: string; rows: { label: string; value: string }[] }) {
  if (rows.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {rows.map((r, i) => (
        <View style={styles.row} key={i}>
          <Text style={styles.label}>{r.label}</Text>
          <Text style={styles.value}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

export async function renderMyDataPdf(input: MyDataPdfInput): Promise<Buffer> {
  const doc = (
    <Document title="My Profile Data" author="Nykomart OMS">
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.docTitle}>My Profile Data</Text>
            <Text style={styles.docSub}>Personal record export — self-service</Text>
          </View>
          <View style={styles.metaRight}>
            <Text>{input.companyName}</Text>
            <Text>Generated: {input.generatedAtLabel}</Text>
          </View>
        </View>

        {/* Identity */}
        <Text style={styles.nameRow}>{input.employeeName}</Text>
        <Text style={styles.roleRow}>
          {[input.roleName, input.companyName].filter(Boolean).join(" · ")}
        </Text>

        <Section title="Work & Access" rows={input.identity} />
        <Section title="Personal" rows={input.personal} />
        <Section title="Family Contacts" rows={input.family} />
        <Section title="Statutory & Bank" rows={input.statutory} />

        {/* Recent activity */}
        {input.activity.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
            {input.activity.map((a, i) => (
              <View style={styles.activityRow} key={i}>
                <Text style={styles.actLabel}>{a.label}</Text>
                <Text style={styles.actWhen}>{a.when}</Text>
              </View>
            ))}
          </View>
        )}

        <View style={styles.footer} fixed>
          <Text>Nykomart OMS — generated from My Profile</Text>
          <Text>Page 1</Text>
        </View>
      </Page>
    </Document>
  );

  return renderPdfToBuffer(doc);
}
