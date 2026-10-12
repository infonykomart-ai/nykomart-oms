// 2026-10-12 — the Performance & KPIs report as a real PDF file, the same
// server-rendered @react-pdf/renderer approach as ledger-pdf.tsx /
// bill-statement-pdf.tsx (pure JS, no headless browser — safe on serverless).
// A4 PORTRAIT, company logo + profile header, the report period, generation
// timestamp, the filters it was built with, summary KPI cards, the daily
// trend, the full per-employee table (with the table header repeated on every
// page) and an approval block.
//
// The rows arrive from the report page via POST /api/performance-report-pdf,
// so the PDF always shows EXACTLY what was on screen — no second derivation,
// no drift between the dashboard and the file. Authorization is re-checked in
// that route (never trusted from the payload).
//
// NOT included, deliberately: quality/review metrics, manager comments and
// blocker text. The tasks schema has no reviewer, acceptance or comment
// columns today, and printing empty boxes would read as "zero" — the spec is
// explicit that missing data must be reported, not invented. The signature
// block is blank on purpose so a human signs the printed copy.
import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import { renderPdfToBuffer } from "@/lib/pdf/render";

export type PerformancePdfRow = {
  name: string;
  designation: string;
  active: boolean;
  assigned: number;
  completed: number;
  completionRate: number | null;
  overdue: number;
  onTimeRate: number | null;
  avgTurnaroundHours: number | null;
  taskHours: number | null;
  logs: number;
  submittedLogs: number;
  plannedQty: number;
  actualQty: number;
  achievementRate: number | null;
};

export type PerformancePdfKpi = { label: string; value: string; detail: string };

export type PerformancePdfInput = {
  companyName: string;
  logoUrl: string | null;
  profile: { address: string | null; phone: string | null; email: string | null; gstin: string | null } | null;
  title: string;
  periodLabel: string;
  periodFrom: string;
  periodTo: string;
  prevLabel: string;
  prevFrom: string;
  prevTo: string;
  generatedAt: string;
  filtersLine: string;
  kpis: PerformancePdfKpi[];
  trend: { date: string; assigned: number; completed: number }[];
  rows: PerformancePdfRow[];
  totals: {
    assigned: number;
    completed: number;
    completionRate: number | null;
    overdue: number;
    onTimeRate: number | null;
    taskHours: number | null;
    logs: number;
    submittedLogs: number;
    plannedQty: number;
    actualQty: number;
    achievementRate: number | null;
    cancelled: number;
  };
};

const PAGE_W = 595; // A4 portrait in points
const PAGE_PAD = 34;
const CONTENT_W = PAGE_W - PAGE_PAD * 2;
/** Rows per printed page — leaves room for header, table header, footer. */
const ROWS_PER_PAGE = 24;

const pctText = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}%`);
const num = (v: number) => v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
const hrs = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)}`);

const styles = StyleSheet.create({
  page: { padding: PAGE_PAD, fontSize: 8, fontFamily: "Helvetica", color: "#111827" },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    borderBottomWidth: 2,
    borderBottomColor: "#111827",
    paddingBottom: 10,
    marginBottom: 10,
  },
  logo: { width: 42, height: 42, objectFit: "contain", marginRight: 10 },
  companyName: { fontSize: 14, fontWeight: 700 },
  companyLine: { fontSize: 7.5, color: "#4b5563", marginTop: 2 },
  rightBlock: { textAlign: "right", fontSize: 7, lineHeight: 1.5, color: "#4b5563" },
  title: { fontSize: 13, fontWeight: 700, marginBottom: 4 },
  metaLine: { fontSize: 7.5, color: "#4b5563", marginBottom: 2 },
  sectionTitle: { fontSize: 9, fontWeight: 700, marginTop: 12, marginBottom: 6 },

  kpiGrid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 4 },
  kpiCard: {
    width: (CONTENT_W - 12) / 3,
    border: 0.75,
    borderColor: "#e5e7eb",
    borderRadius: 3,
    padding: 6,
    marginRight: 6,
    marginBottom: 6,
  },
  kpiLabel: { fontSize: 6.5, color: "#6b7280", textTransform: "uppercase", letterSpacing: 0.4 },
  kpiValue: { fontSize: 13, fontWeight: 700, marginTop: 2 },
  kpiDetail: { fontSize: 6.5, color: "#6b7280", marginTop: 1 },

  trendRow: { flexDirection: "row", alignItems: "center", marginBottom: 2 },
  trendDate: { width: 46, fontSize: 6.5, color: "#6b7280" },
  trendBarWrap: { flexDirection: "row", alignItems: "center", flex: 1 },
  trendLabel: { width: 26, fontSize: 6, color: "#6b7280", textAlign: "right", marginRight: 3 },
  trendBar: { height: 6, borderRadius: 3 },

  tableHead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#111827", paddingBottom: 3, marginBottom: 2 },
  tableHeadText: { fontSize: 6.2, fontWeight: 700, color: "#374151" },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#f1f5f9", paddingVertical: 3 },
  tableRowAlt: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#f1f5f9", paddingVertical: 3, backgroundColor: "#f8fafc" },
  cell: { fontSize: 6.6 },
  cellRight: { fontSize: 6.6, textAlign: "right" },
  totalsRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#111827", paddingTop: 4, marginTop: 4 },
  signRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 34 },
  signBox: { width: "30%" },
  signLine: { borderBottomWidth: 0.75, borderBottomColor: "#9ca3af", marginBottom: 4, height: 22 },
  signLabel: { fontSize: 7, color: "#4b5563" },
  footNote: { fontSize: 6.5, color: "#9ca3af", marginTop: 10, fontStyle: "italic" },
});

// Column widths sum to CONTENT_W — employee 108, designation 74, then the
// numeric columns.
const COLS: { key: string; label: string; w: number; right?: boolean }[] = [
  { key: "name", label: "Employee", w: 108 },
  { key: "desig", label: "Designation", w: 74 },
  { key: "assigned", label: "Assigned", w: 44, right: true },
  { key: "done", label: "Done", w: 38, right: true },
  { key: "donePct", label: "Done %", w: 42, right: true },
  { key: "overdue", label: "Overdue", w: 40, right: true },
  { key: "ontime", label: "On-time %", w: 44, right: true },
  { key: "tat", label: "TAT (h)", w: 38, right: true },
  { key: "hours", label: "Hours", w: 38, right: true },
  { key: "logs", label: "Logs", w: 34, right: true },
  { key: "target", label: "Target %", w: 43, right: true },
];

function cellText(r: PerformancePdfRow, key: string): string {
  switch (key) {
    case "name":
      return r.name;
    case "desig":
      return r.designation || "—";
    case "assigned":
      return num(r.assigned);
    case "done":
      return num(r.completed);
    case "donePct":
      return pctText(r.completionRate);
    case "overdue":
      return String(r.overdue);
    case "ontime":
      return pctText(r.onTimeRate);
    case "tat":
      return hrs(r.avgTurnaroundHours);
    case "hours":
      return r.taskHours === null ? "—" : `${r.taskHours}`;
    case "logs":
      return `${num(r.logs)}${r.submittedLogs < r.logs ? ` (${r.logs - r.submittedLogs} dr)` : ""}`;
    case "target":
      return pctText(r.achievementRate);
    default:
      return "";
  }
}

function TableHeader() {
  return (
    <View style={styles.tableHead} fixed>
      {COLS.map((c) => (
        <Text key={c.key} style={[styles.tableHeadText, { width: c.w, textAlign: c.right ? "right" : "left" }]}>
          {c.label}
        </Text>
      ))}
    </View>
  );
}

export function PerformanceReportPdf({ input }: { input: PerformancePdfInput }) {
  const chunks: PerformancePdfRow[][] = [];
  for (let i = 0; i < input.rows.length; i += ROWS_PER_PAGE) {
    chunks.push(input.rows.slice(i, i + ROWS_PER_PAGE));
  }
  // Always at least one page, even with zero employees.
  const pages = chunks.length > 0 ? chunks : [[]];

  // Trend bars: only worth printing when it fits on one page comfortably.
  const showTrend = input.trend.length > 0 && input.trend.length <= 31;
  const trendMax = Math.max(1, ...input.trend.flatMap((t) => [t.assigned, t.completed]));

  return (
    <Document
      title={input.title}
      author={input.companyName}
      subject={`${input.periodLabel} ${input.periodFrom} to ${input.periodTo}`}
    >
      {pages.map((chunk, pageIndex) => (
        <Page key={pageIndex} size="A4" style={styles.page}>
          {/* Company header — only on the first page; later pages carry the
              compact repeating table header instead. */}
          {pageIndex === 0 && (
            <View style={styles.headerRow} fixed>
              <View style={{ flexDirection: "row", alignItems: "flex-start", flex: 1 }}>
                {/* react-pdf's <Image> has no alt prop — the jsx-a11y rule
                    targets the DOM <img>, not this component. Same handling as
                    couriers/csb-v-invoice-pdf.tsx and ledger-pdf.tsx. */}
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                {input.logoUrl ? <Image src={input.logoUrl} style={styles.logo} /> : null}
                <View style={{ flex: 1 }}>
                  <Text style={styles.companyName}>{input.companyName}</Text>
                  {input.profile?.address ? <Text style={styles.companyLine}>{input.profile.address}</Text> : null}
                  <Text style={styles.companyLine}>
                    {[input.profile?.phone, input.profile?.email, input.profile?.gstin ? `GSTIN ${input.profile.gstin}` : null]
                      .filter(Boolean)
                      .join("  ·  ") || " "}
                  </Text>
                </View>
              </View>
              <View style={[styles.rightBlock, { width: 170 }]}>
                <Text style={{ fontSize: 7.5, fontWeight: 700, color: "#111827" }}>Generated</Text>
                <Text>{input.generatedAt}</Text>
                <Text>IST business timezone</Text>
              </View>
            </View>
          )}

          {pageIndex === 0 && (
            <>
              <Text style={styles.title}>{input.title}</Text>
              <Text style={styles.metaLine}>
                Period: {input.periodLabel} · {input.periodFrom === input.periodTo ? input.periodFrom : `${input.periodFrom} to ${input.periodTo}`}
              </Text>
              <Text style={styles.metaLine}>
                Compared with: {input.prevLabel} · {input.prevFrom === input.prevTo ? input.prevFrom : `${input.prevFrom} to ${input.prevTo}`}
              </Text>
              <Text style={styles.metaLine}>Filters: {input.filtersLine}</Text>

              {/* KPI cards */}
              <Text style={styles.sectionTitle}>Summary</Text>
              <View style={styles.kpiGrid}>
                {input.kpis.map((k) => (
                  <View key={k.label} style={styles.kpiCard} wrap={false}>
                    <Text style={styles.kpiLabel}>{k.label}</Text>
                    <Text style={styles.kpiValue}>{k.value}</Text>
                    <Text style={styles.kpiDetail}>{k.detail}</Text>
                  </View>
                ))}
              </View>

              {showTrend && (
                <>
                  <Text style={styles.sectionTitle}>Daily trend — assigned vs completed</Text>
                  {input.trend.map((t) => (
                    <View key={t.date} style={styles.trendRow} wrap={false}>
                      <Text style={styles.trendDate}>{t.date}</Text>
                      <View style={styles.trendBarWrap}>
                        <Text style={styles.trendLabel}>A {t.assigned}</Text>
                        <View style={{ width: `${(t.assigned / trendMax) * 100}%`, minWidth: t.assigned > 0 ? 3 : 0 }}>
                          <View style={[styles.trendBar, { backgroundColor: "#94a3b8", width: "100%" }]} />
                        </View>
                      </View>
                      <View style={styles.trendBarWrap}>
                        <Text style={styles.trendLabel}>C {t.completed}</Text>
                        <View style={{ width: `${(t.completed / trendMax) * 100}%`, minWidth: t.completed > 0 ? 3 : 0 }}>
                          <View style={[styles.trendBar, { backgroundColor: "#059669", width: "100%" }]} />
                        </View>
                      </View>
                    </View>
                  ))}
                </>
              )}
              {!showTrend && input.trend.length > 0 && (
                <Text style={styles.footNote}>
                  Daily trend omitted from the PDF (period longer than 31 days) — see the on-screen chart.
                </Text>
              )}

              <Text style={styles.sectionTitle}>Employee performance</Text>
            </>
          )}

          {/* Repeated on every page */}
          <TableHeader />

          {chunk.length === 0 && (
            <Text style={{ fontSize: 7, color: "#9ca3af", paddingVertical: 8 }}>
              No employees found for this filter.
            </Text>
          )}
          {chunk.map((r, i) => (
            <View key={`${r.name}-${i}`} style={i % 2 ? styles.tableRowAlt : styles.tableRow}>
              {COLS.map((c) => (
                <Text key={c.key} style={[c.right ? styles.cellRight : styles.cell, { width: c.w }]}>
                  {cellText(r, c.key)}
                </Text>
              ))}
            </View>
          ))}

          {/* Totals + approval block on the final page */}
          {pageIndex === pages.length - 1 && (
            <>
              <View style={styles.totalsRow}>
                {COLS.map((c) => (
                  <Text
                    key={c.key}
                    style={[styles.tableHeadText, { width: c.w, textAlign: c.right ? "right" : "left" }]}
                  >
                    {c.key === "name"
                      ? "TOTAL"
                      : c.key === "desig"
                        ? ""
                        : c.key === "assigned"
                          ? num(input.totals.assigned)
                          : c.key === "done"
                            ? num(input.totals.completed)
                            : c.key === "donePct"
                              ? pctText(input.totals.completionRate)
                              : c.key === "overdue"
                                ? String(input.totals.overdue)
                                : c.key === "ontime"
                                  ? pctText(input.totals.onTimeRate)
                                  : c.key === "tat"
                                    ? "—"
                                    : c.key === "hours"
                                      ? input.totals.taskHours === null ? "—" : `${input.totals.taskHours}`
                                      : c.key === "logs"
                                        ? num(input.totals.logs)
                                        : pctText(input.totals.achievementRate)}
                  </Text>
                ))}
              </View>

              <Text style={styles.footNote}>
                Cancelled tasks (excluded from the rates above, reported separately): {input.totals.cancelled}.
                Rates show “—” where the underlying data was insufficient rather than 0%.
              </Text>

              <View style={styles.signRow} wrap={false}>
                <View style={styles.signBox}>
                  <View style={styles.signLine} />
                  <Text style={styles.signLabel}>Prepared by</Text>
                </View>
                <View style={styles.signBox}>
                  <View style={styles.signLine} />
                  <Text style={styles.signLabel}>Reviewed by (Manager)</Text>
                </View>
                <View style={styles.signBox}>
                  <View style={styles.signLine} />
                  <Text style={styles.signLabel}>Approved by</Text>
                </View>
              </View>
            </>
          )}

          <Text
            style={[styles.footNote, { position: "absolute", bottom: 18, left: PAGE_PAD, right: PAGE_PAD }]}
            fixed
            render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
          />
        </Page>
      ))}
    </Document>
  );
}

/**
 * Renders the performance report to a real PDF file (Buffer) — A4 portrait,
 * company logo header, KPI cards, trend and the full employee table.
 */
export async function renderPerformanceReportPdf(input: PerformancePdfInput): Promise<Buffer> {
  return renderPdfToBuffer(<PerformanceReportPdf input={input} />);
}
