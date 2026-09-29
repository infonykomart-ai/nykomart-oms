// 2026-09-29 — the printable TEAM DIRECTORY PDF ("Directory PDF" button on
// the Employees page). A contact book of ACTIVE employees: name, code,
// designation, role, company, email, WhatsApp, joining date — deliberately
// NO bank/statutory/family columns (this is the version that can be
// printed and shared; the Excel export is the HR-grade full-data one).
//
// Same pure-JS @react-pdf/renderer choice as every other PDF here
// (my-data-pdf.tsx / bill-statement-pdf.tsx) — no headless browser, safe
// on serverless. Card grid layout (3 per row by default) so it reads like
// a directory page rather than a data dump; react-pdf flows rows across
// pages automatically, so long rosters paginate cleanly.
import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { renderPdfToBuffer } from "@/lib/pdf/render";

export type DirectoryEntry = {
  name: string;
  employeeCode: string | null;
  designation: string | null;
  role: string;
  company: string;
  email: string | null;
  whatsapp: string | null;
  joined: string;
};

export type TeamDirectoryPdfInput = {
  generatedAtLabel: string;
  people: DirectoryEntry[];
  columns: number;
};

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 8.5, fontFamily: "Helvetica", color: "#111827" },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: "#111827",
    paddingBottom: 8,
    marginBottom: 14,
  },
  docTitle: { fontSize: 15, fontWeight: 700 },
  docSub: { fontSize: 7.5, color: "#6b7280", marginTop: 2 },
  metaRight: { textAlign: "right", fontSize: 7.5, color: "#6b7280", lineHeight: 1.5 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  card: {
    width: "32%",
    borderWidth: 0.75,
    borderColor: "#d1d5db",
    borderRadius: 6,
    padding: 8,
    marginBottom: 8,
  },
  name: { fontSize: 9.5, fontWeight: 700, marginBottom: 1 },
  sub: { fontSize: 7.5, color: "#374151", marginBottom: 4 },
  line: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1 },
  label: { color: "#6b7280" },
  value: { textAlign: "right", fontWeight: 500, maxWidth: "68%" },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 32,
    right: 32,
    fontSize: 7,
    color: "#9ca3af",
    flexDirection: "row",
    justifyContent: "space-between",
  },
});

function Card({ p }: { p: DirectoryEntry }) {
  return (
    <View style={styles.card}>
      <Text style={styles.name}>{p.name}</Text>
      <Text style={styles.sub}>{[p.designation, p.role].filter(Boolean).join(" · ")}</Text>
      <View style={styles.line}>
        <Text style={styles.label}>Code</Text>
        <Text style={styles.value}>{p.employeeCode ?? "—"}</Text>
      </View>
      <View style={styles.line}>
        <Text style={styles.label}>Company</Text>
        <Text style={styles.value}>{p.company}</Text>
      </View>
      <View style={styles.line}>
        <Text style={styles.label}>Email</Text>
        <Text style={styles.value}>{p.email ?? "—"}</Text>
      </View>
      <View style={styles.line}>
        <Text style={styles.label}>WhatsApp</Text>
        <Text style={styles.value}>{p.whatsapp ?? "—"}</Text>
      </View>
      <View style={styles.line}>
        <Text style={styles.label}>Joined</Text>
        <Text style={styles.value}>{p.joined}</Text>
      </View>
    </View>
  );
}

export async function renderTeamDirectoryPdf(input: TeamDirectoryPdfInput): Promise<Buffer> {
  const cols = Math.max(1, Math.min(4, input.columns || 3));
  // Chunk people into visual rows of `cols` cards; each chunk renders as
  // one flex row so cards align even when the last row is partial.
  const rows: DirectoryEntry[][] = [];
  for (let i = 0; i < input.people.length; i += cols) rows.push(input.people.slice(i, i + cols));

  const doc = (
    <Document title="Team Directory" author="Nykomart OMS">
      <Page size="A4" style={styles.page}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.docTitle}>Team Directory</Text>
            <Text style={styles.docSub}>
              Contact book — {input.people.length} active team member{input.people.length === 1 ? "" : "s"} · no
              statutory/bank data
            </Text>
          </View>
          <View style={styles.metaRight}>
            <Text>Nykomart OMS</Text>
            <Text>Generated: {input.generatedAtLabel}</Text>
          </View>
        </View>

        {rows.map((row, ri) => (
          <View style={styles.grid} key={ri}>
            {row.map((p, pi) => (
              <Card p={p} key={pi} />
            ))}
          </View>
        ))}

        <View style={styles.footer} fixed>
          <Text>Nykomart OMS — generated from the Employee Roster</Text>
          <Text
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  );

  return renderPdfToBuffer(doc);
}
