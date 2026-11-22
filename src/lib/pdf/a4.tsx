// 2026-11-22d — Phase 4: the shared A4 layout for every server-rendered
// document (Order Sheet / Invoice / Tax Invoice / Packing List / Purchase
// Order).
//
// Before this file each PDF generator (bill-statement-pdf.tsx,
// ledger-pdf.tsx, …) repeated its own page + header + footer styles, and
// NONE of them had page numbering or a header that repeats on later pages.
// This module is the one place those three things are implemented:
//
//   • A4Page — A4 portrait, the company/doc header painted on EVERY page
//     through react-pdf's `render` callback (so page 2, 3, … carry the same
//     letterhead as page 1), and a footer with "Page X of Y" + the
//     Generated-via line. The page's own padding reserves exactly the space
//     the header and footer occupy, so flowing content can never print
//     underneath them.
//   • A4Table — a column table whose header row is `fixed`, so it repeats
//     at the top of each page a long table spills onto. Rows use
//     `wrap={false}` so a line item is never cut in half across pages.
//   • A4Section / A4Facts / A4PhotoGrid / A4Signatures — the small blocks
//     the five documents share.
//
// Deliberately NOT a rewrite of the 13 existing generators: they keep
// working untouched, and new/upgraded documents use this layout.
import React from "react";
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

export type A4Meta = { label: string; value: string };

export type A4Header = {
  title: string;
  /** Small line under the title, e.g. "Export Invoice · E-COM". */
  subtitle?: string | null;
  docNo?: string | null;
  docDate?: string | null;
  /** Right-hand meta rows under the number/date (GSTIN, store, status…). */
  meta?: A4Meta[];
  companyName: string;
  companyLogoUrl?: string | null;
  companyLines?: (string | null | undefined)[];
};

export type A4PageProps = {
  header: A4Header;
  /** Repeated at the bottom of every page, above the page number. */
  footerNote?: string | null;
  /** 1-based page number, and how many pages this document has in total. */
  pageNumber: number;
  totalPages: number;
  children: React.ReactNode;
};

const GENERATED_BY = "Generated via NykoInfotech OMS · nykoinfotech.com";

export const a4Styles = StyleSheet.create({
  page: {
    paddingHorizontal: 30,
    fontSize: 8.5,
    fontFamily: "Helvetica",
    color: "#111827",
    lineHeight: 1.35,
  },
  headerChrome: { paddingTop: 22, paddingBottom: 6 },
  /** Grows so the footer always sits at the bottom of the A4 sheet. */
  body: { flexGrow: 1 },
  footerChrome: {
    marginTop: 6,
    paddingTop: 4,
    paddingBottom: 14,
    borderTopWidth: 0.5,
    borderTopColor: "#d1d5db",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  header: { paddingBottom: 2 },
  headerTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  brandRow: { flexDirection: "row", alignItems: "flex-start", flex: 1, paddingRight: 10 },
  logo: { width: 40, height: 40, objectFit: "contain", marginRight: 8 },
  companyName: { fontSize: 14, fontWeight: 700, marginBottom: 2 },
  companyLine: { fontSize: 7.5, color: "#4b5563" },
  metaCol: { textAlign: "right", fontSize: 7, lineHeight: 1.5, color: "#374151" },
  titleRow: {
    marginTop: 10,
    paddingTop: 5,
    paddingBottom: 5,
    borderTopWidth: 1.5,
    borderTopColor: "#111827",
    borderBottomWidth: 0.75,
    borderBottomColor: "#9ca3af",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
  },
  title: { fontSize: 11.5, fontWeight: 700, letterSpacing: 0.6 },
  subtitle: { fontSize: 7, color: "#6b7280", marginTop: 1 },
  docRef: { fontSize: 9, fontWeight: 700, textAlign: "right" },
  docMeta: { fontSize: 7.5, color: "#374151", textAlign: "right" },

  footerText: { fontSize: 6.5, color: "#6b7280", maxWidth: "70%" },
  pageNumber: { fontSize: 7, color: "#374151" },
  section: { marginBottom: 10 },
  sectionTitle: { fontSize: 8, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.4, marginBottom: 3 },
  row: { flexDirection: "row" },
  col: { flex: 1, paddingRight: 8 },
  label: { fontSize: 6.5, textTransform: "uppercase", letterSpacing: 0.3, color: "#6b7280" },
  value: { fontSize: 8.5 },
  tableHeader: {
    flexDirection: "row",
    borderBottomWidth: 0.75,
    borderBottomColor: "#9ca3af",
    paddingBottom: 2,
    marginBottom: 2,
    fontSize: 7,
    color: "#6b7280",
    textTransform: "uppercase",
  },
  tableRow: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#e5e7eb", paddingVertical: 2.5 },
  tabular: { fontFamily: "Helvetica" },
  right: { textAlign: "right" },
  bold: { fontWeight: 700 },
  muted: { color: "#6b7280" },
  totals: { marginTop: 6, alignSelf: "flex-end", width: 230 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1.5 },
  totalDivider: { borderTopWidth: 0.75, borderTopColor: "#9ca3af" },
  grand: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1.25,
    borderTopColor: "#111827",
    paddingTop: 3,
    marginTop: 2,
    fontSize: 10,
    fontWeight: 700,
  },
  photoGrid: { flexDirection: "row", flexWrap: "wrap", marginHorizontal: -3 },
  photoCell: { padding: 3 },
  photo: { width: "100%", objectFit: "cover", borderWidth: 0.5, borderColor: "#d1d5db" },
  emptyBox: {
    borderWidth: 0.75,
    borderStyle: "dashed",
    borderColor: "#d1d5db",
    paddingVertical: 14,
    textAlign: "center",
    color: "#9ca3af",
    fontSize: 8,
  },
  note: { fontSize: 7, color: "#6b7280", marginTop: 4 },
  signatures: { flexDirection: "row", justifyContent: "space-between", marginTop: 26 },
  signatureBox: { width: "40%", borderTopWidth: 0.75, borderTopColor: "#6b7280", paddingTop: 3 },
  signatureText: { fontSize: 7, color: "#4b5563" },
});

function HeaderBlock({ header }: { header: A4Header }) {
  const lines = (header.companyLines ?? []).filter((line): line is string => !!line && !!line.trim());
  return (
    <View style={a4Styles.header}>
      <View style={a4Styles.headerTop}>
        <View style={a4Styles.brandRow}>
          {/* react-pdf's Image is a PDF primitive — it has no alt prop. */}
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          {header.companyLogoUrl ? <Image src={header.companyLogoUrl} style={a4Styles.logo} /> : null}
          <View>
            <Text style={a4Styles.companyName}>{header.companyName}</Text>
            {lines.map((line, index) => (
              <Text key={index} style={a4Styles.companyLine}>
                {line}
              </Text>
            ))}
          </View>
        </View>
        <View style={a4Styles.metaCol}>
          <Text>{GENERATED_BY}</Text>
          {(header.meta ?? []).map((meta, index) => (
            <Text key={index}>
              {meta.label}: {meta.value}
            </Text>
          ))}
        </View>
      </View>

      <View style={a4Styles.titleRow}>
        <View>
          <Text style={a4Styles.title}>{header.title.toUpperCase()}</Text>
          {header.subtitle ? <Text style={a4Styles.subtitle}>{header.subtitle}</Text> : null}
        </View>
        <View>
          {header.docNo ? <Text style={a4Styles.docRef}>{header.docNo}</Text> : null}
          {header.docDate ? <Text style={a4Styles.docMeta}>Date: {header.docDate}</Text> : null}
        </View>
      </View>
    </View>
  );
}

/**
 * One A4 portrait page.
 *
 * One explicit A4 sheet. Documents paginate themselves (see
 * `paginateDocumentLines` in src/lib/documents/order-document.ts) instead of
 * relying on react-pdf's automatic page breaks: that is what makes the
 * letterhead, the table head and "Page X of Y" correct on EVERY page — the
 * caller knows the page number and the total while building each sheet.
 */
export function A4Page({ header, footerNote, pageNumber, totalPages, children }: A4PageProps) {
  return (
    <Page size="A4" style={a4Styles.page}>
      <View style={a4Styles.headerChrome}>
        <HeaderBlock header={header} />
      </View>
      <View style={a4Styles.body}>{children}</View>
      <View style={a4Styles.footerChrome}>
        <Text style={a4Styles.footerText}>{footerNote ?? "Computer-generated document — no signature required."}</Text>
        <Text style={a4Styles.pageNumber}>
          Page {pageNumber} of {totalPages}
        </Text>
      </View>
    </Page>
  );
}

/** `<Document>` wrapper with the title/author every PDF should carry. */
export function A4Document({
  title,
  author,
  children,
}: {
  title: string;
  author?: string;
  children: React.ReactNode;
}) {
  return (
    <Document title={title} author={author}>
      {children}
    </Document>
  );
}

export function A4Section({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View style={a4Styles.section}>
      {title ? <Text style={a4Styles.sectionTitle}>{title}</Text> : null}
      {children}
    </View>
  );
}

/** Label/value pairs laid out in two columns (party, buyer, shipping…). */
export function A4Facts({ facts }: { facts: { label: string; value: string | null | undefined }[] }) {
  const visible = facts.filter((fact) => fact.value !== null && fact.value !== undefined && `${fact.value}`.trim() !== "");
  return (
    <View style={a4Styles.row}>
      {visible.map((fact, index) => (
        <View key={index} style={a4Styles.col}>
          <Text style={a4Styles.label}>{fact.label}</Text>
          <Text style={a4Styles.value}>{fact.value}</Text>
        </View>
      ))}
    </View>
  );
}

export type A4Column = {
  label: string;
  flex?: number;
  width?: number;
  align?: "left" | "right";
};

export type A4TableRow = {
  cells: React.ReactNode[];
  bold?: boolean;
  muted?: boolean;
};

/**
 * Column table. The header row is `fixed`, so a table that spills onto a
 * second page repeats its column labels there; rows never split.
 */
export function A4Table({
  columns,
  rows,
  totals,
  emptyText = "No lines.",
}: {
  columns: A4Column[];
  rows: A4TableRow[];
  totals?: { label: string; value: string; grand?: boolean }[];
  emptyText?: string;
}) {
  const colStyle = (column: A4Column) => ({
    ...(column.width ? { width: column.width } : { flex: column.flex ?? 1 }),
    ...(column.align === "right" ? { textAlign: "right" as const } : {}),
  });

  return (
    <View>
      <View style={a4Styles.tableHeader}>
        {columns.map((column, index) => (
          <Text key={index} style={colStyle(column)}>
            {column.label}
          </Text>
        ))}
      </View>

      {rows.length === 0 ? (
        <Text style={a4Styles.emptyBox}>{emptyText}</Text>
      ) : (
        rows.map((row, rowIndex) => (
          <View
            key={rowIndex}
            style={[a4Styles.tableRow, row.bold ? a4Styles.bold : {}]}
            wrap={false}
          >
            {columns.map((column, cellIndex) => (
              <Text
                key={cellIndex}
                style={[colStyle(column), row.muted ? a4Styles.muted : {}]}
              >
                {row.cells[cellIndex] ?? ""}
              </Text>
            ))}
          </View>
        ))
      )}

      {totals && totals.length > 0 ? (
        <View style={a4Styles.totals}>
          {totals.map((total, index) =>
            total.grand ? (
              <View key={index} style={a4Styles.grand}>
                <Text>{total.label}</Text>
                <Text>{total.value}</Text>
              </View>
            ) : (
              <View key={index} style={a4Styles.totalRow}>
                <Text style={a4Styles.muted}>{total.label}</Text>
                <Text>{total.value}</Text>
              </View>
            )
          )}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Photos already converted to data URIs by the caller (see
 * src/lib/documents/photo-data.ts) — an unreachable URL is simply absent from
 * the list rather than breaking the whole PDF.
 */
export function A4PhotoGrid({
  srcs,
  columns = 4,
  height = 96,
  emptyText = "No photos.",
}: {
  srcs: string[];
  columns?: number;
  height?: number;
  emptyText?: string;
}) {
  if (!srcs.length) return <Text style={a4Styles.emptyBox}>{emptyText}</Text>;
  const width = 100 / columns;
  return (
    <View style={a4Styles.photoGrid}>
      {srcs.map((src, index) => (
        <View key={index} style={[a4Styles.photoCell, { width: `${width}%` }]}>
          {/* eslint-disable-next-line jsx-a11y/alt-text */}
          <Image src={src} style={[a4Styles.photo, { height }]} />
        </View>
      ))}
    </View>
  );
}

export function A4Signatures({ labels }: { labels: string[] }) {
  if (!labels.length) return null;
  return (
    <View style={a4Styles.signatures}>
      {labels.map((label) => (
        <View key={label} style={a4Styles.signatureBox}>
          <Text style={a4Styles.signatureText}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

export function A4Note({ children }: { children: React.ReactNode }) {
  return <Text style={a4Styles.note}>{children}</Text>;
}
