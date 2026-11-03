// 2026-11-03 — the agreement as a real PDF FILE (A4, multi-page), rendered
// server-side with @react-pdf/renderer — same pure-JS choice as
// bill-statement-pdf.tsx / doc-statement-pdf.tsx, so it runs on Vercel
// serverless with no headless browser.
//
// Layout requirements this file implements (Legal & Compliance spec §5):
//   • A4, fixed margins, one typography throughout (configurable family);
//   • the OFFICIAL LETTERHEAD on EVERY page — a fixed header (logo, legal
//     name, address, email, website, phone, GSTIN) and a fixed footer
//     (Confidential Document, unique reference, document version, page
//     number, company contact). Nothing is invented: an unconfigured GSTIN
//     simply prints no GSTIN line;
//   • numbered clauses with clear headings, vendor details, reference number,
//     effective date;
//   • vendor acceptance declaration, Nyko Mart authorised-representative
//     block, optional witness blocks, both signature images where configured;
//   • no truncation — clauses flow across pages with react-pdf's own
//     pagination, so a long agreement simply continues.
//
// PAGE-STYLE GOTCHA (learned the hard way): never put a numeric `lineHeight`
// on the `page` style. With it, @react-pdf/renderer silently drops the fixed
// footer from every page (verified by rendering a 3-page document and reading
// the text back out of the PDF). Line height belongs on the text styles only.
import React from "react";
import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import { renderPdfToBuffer } from "@/lib/pdf/render";
import type { AgreementLetterhead } from "@/lib/agreements/letterhead";

const MUTED = "#4b5563";
const RULE = "#d1d5db";

export type AgreementPdfParty = {
  name: string;
  lines: string[];
};

export type AgreementPdfData = {
  /** Printed document heading, e.g. "Manufacturer and Rug Supply Agreement". */
  title: string;
  subject: string;
  refNo: string;
  effectiveDate: string;
  /** Version number printed in the header/footer ("v1", "v2", …). */
  version: number;
  letterhead: AgreementLetterhead;
  parties: {
    company: AgreementPdfParty;
    vendor: AgreementPdfParty;
  };
  clauses: { title: string; paragraphs: string[] }[];
  specialTerms: string[];
  annexureTitle?: string;
  annexure: string[];
  signatories: {
    company: { name: string; designation: string };
    vendor: { name: string; designation: string };
  };
  includeWitnesses: boolean;
  /** Printed at the end of the document body (not part of the letterhead). */
  declaration: string;
  /** Extra line under the title, e.g. "Combined with: IP Protection". */
  combinationNote?: string;
  /** Role headings for the signature columns (e.g. DESIGNER / IP OWNER). */
  signatureHeadings?: { company: string; vendor: string };
  /** Opening party line, e.g. "This acknowledgment is made between". */
  partyHeading?: string;
};

function buildStyles(letterhead: AgreementLetterhead) {
  return StyleSheet.create({
    page: {
      paddingTop: 124,
      paddingBottom: 68,
      paddingHorizontal: 40,
      fontSize: 8.8,
      fontFamily: letterhead.fontFamily,
      color: "#111827",
    },
    // Fixed header/footer are absolutely positioned inside the page box.
    header: {
      position: "absolute",
      top: 26,
      left: 40,
      right: 40,
      borderBottomWidth: 1.6,
      borderBottomColor: letterhead.brandColor,
      paddingBottom: 7,
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
    },
    brandBlock: { flexDirection: "row", alignItems: "flex-start", flex: 1, paddingRight: 10 },
    logo: { width: 44, height: 44, objectFit: "contain", marginRight: 9 },
    legalName: { fontSize: 13, fontWeight: 700, color: letterhead.brandColor },
    companyLine: { fontSize: 7.2, color: MUTED, marginTop: 1, lineHeight: 1.35 },
    headerRight: { textAlign: "right", fontSize: 7, color: MUTED, lineHeight: 1.4 },
    docTitle: {
      fontSize: 11.5,
      fontWeight: 700,
      textAlign: "center",
      textTransform: "uppercase",
      letterSpacing: 0.7,
      color: letterhead.brandColor,
      marginBottom: 2,
    },
    subtitle: { fontSize: 8.4, textAlign: "center", color: MUTED, marginBottom: 2 },
    comboNote: { fontSize: 7.2, textAlign: "center", color: letterhead.accentColor, marginBottom: 6 },
    metaRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      borderTopWidth: 0.6,
      borderBottomWidth: 0.6,
      borderColor: RULE,
      paddingVertical: 4,
      marginTop: 8,
      marginBottom: 10,
      fontSize: 7.8,
    },
    partyHeading: {
      fontSize: 7.2,
      color: letterhead.accentColor,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      marginTop: 6,
      marginBottom: 1,
      fontWeight: 700,
    },
    partyName: { fontSize: 9.2, fontWeight: 700 },
    partyLine: { fontSize: 8.2, color: MUTED, lineHeight: 1.4 },
    clauseHeading: {
      fontSize: 8.9,
      fontWeight: 700,
      color: letterhead.brandColor,
      marginTop: 8,
      marginBottom: 2.5,
    },
    para: { marginBottom: 3.5, textAlign: "justify", lineHeight: 1.45 },
    annexureHead: { fontSize: 8.9, fontWeight: 700, marginTop: 12, marginBottom: 3 },
    annexureItem: { flexDirection: "row", marginBottom: 2 },
    annexureBullet: { width: 10, color: MUTED },
    annexureText: { flex: 1, lineHeight: 1.4 },
    declaration: {
      marginTop: 12,
      padding: 7,
      borderWidth: 0.6,
      borderColor: RULE,
      fontSize: 7.8,
      lineHeight: 1.45,
      textAlign: "justify",
    },
    signatureWrap: { flexDirection: "row", justifyContent: "space-between", marginTop: 18 },
    signatureCol: { width: "46%" },
    signatureFor: { fontSize: 7.6, color: MUTED, marginBottom: 4 },
    signatureImage: { width: 96, height: 34, objectFit: "contain", marginBottom: 2 },
    signatureSpace: { height: 34 },
    signatureRule: { borderTopWidth: 0.8, borderTopColor: "#111827", paddingTop: 3 },
    signatureName: { fontSize: 8.6, fontWeight: 700 },
    signatureMeta: { fontSize: 7.4, color: MUTED },
    witnessHead: { fontSize: 8.2, fontWeight: 700, marginTop: 14, marginBottom: 4 },
    // 2026-11-03 — the footer is three INDEPENDENT absolutely-positioned
    // fixed Texts, not a container View with rows. Two layouts were tried and
    // both lost text when the page overflowed onto later pages (verified by
    // reading the rendered PDF's text back): nested rows with
    // `justifyContent: space-between`, and nested rows with a flexed cell.
    // Independent absolute Texts render on every page reliably, so the footer
    // keeps its rule line + four required facts without the container.
    footerRule: {
      position: "absolute",
      bottom: 34,
      left: 40,
      right: 40,
      borderTopWidth: 0.5,
      borderTopColor: RULE,
      height: 0,
    },
    footerText: { position: "absolute", bottom: 20, left: 40, right: 112, fontSize: 6.6, lineHeight: 1.3, color: MUTED },
    // Page numbers come from react-pdf's per-page `render` callback. That
    // callback only fires when the Text sits inside a fixed View — an
    // absolutely-positioned Text with `render` renders nothing (checked by
    // reading the PDF back), so this is a boxed fixed View on purpose.
    footerPageBox: { position: "absolute", bottom: 20, right: 40, width: 80 },
    footerPage: { textAlign: "right", fontSize: 6.6, color: MUTED },
    footerMeta: {
      position: "absolute",
      bottom: 6,
      left: 40,
      right: 40,
      borderTopWidth: 0.5,
      borderTopColor: RULE,
      paddingTop: 2.5,
      fontSize: 6.2,
      lineHeight: 1.25,
      color: MUTED,
    },
  });
}

export function AgreementPdfDocument({ data }: { data: AgreementPdfData }) {
  const styles = buildStyles(data.letterhead);
  const { letterhead, parties } = data;
  const headerContact = [letterhead.email, letterhead.website, letterhead.phone ? `Ph: ${letterhead.phone}` : null]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <Document
      title={`${data.title} — ${parties.vendor.name}`}
      author={letterhead.legalName}
      subject={data.subject}
      creator="Nyko Mart OMS"
      producer="Nyko Mart OMS Agreement Generator"
      keywords={`${data.refNo}, ${data.subject}`}
    >
      <Page size="A4" style={styles.page}>
        {/* ---- Letterhead: fixed, so it repeats on every page ---- */}
        <View style={styles.header} fixed>
          <View style={styles.brandBlock}>
            {/* react-pdf's Image is a PDF primitive with no alt prop; eslint's
                jsx-a11y rule doesn't know that (same disable as the bill PDF). */}
            {/* eslint-disable-next-line jsx-a11y/alt-text */}
            {letterhead.logoUrl ? <Image src={letterhead.logoUrl} style={styles.logo} /> : null}
            <View>
              <Text style={styles.legalName}>{letterhead.legalName}</Text>
              {letterhead.address ? <Text style={styles.companyLine}>{letterhead.address}</Text> : null}
              {headerContact ? <Text style={styles.companyLine}>{headerContact}</Text> : null}
            </View>
          </View>
          <View style={styles.headerRight}>
            {letterhead.gstin ? <Text>GSTIN: {letterhead.gstin}</Text> : null}
            <Text>Ref: {data.refNo}</Text>
            <Text>Version: v{data.version}</Text>
            <Text>Date: {data.effectiveDate}</Text>
          </View>
        </View>

        {/* ---- Document body ---- */}
        <Text style={styles.docTitle}>{data.title}</Text>
        {data.subject && data.subject !== data.title ? <Text style={styles.subtitle}>{data.subject}</Text> : null}
        {data.combinationNote ? <Text style={styles.comboNote}>{data.combinationNote}</Text> : null}

        <View style={styles.metaRow}>
          <Text>Agreement Ref.: {data.refNo}</Text>
          <Text>Effective Date: {data.effectiveDate}</Text>
          <Text>Document Version: v{data.version}</Text>
        </View>

        <Text style={styles.partyHeading}>{data.partyHeading ?? "This agreement is made between"}</Text>
        <Text style={styles.partyName}>{parties.company.name}</Text>
        {parties.company.lines.map((line, index) => (
          <Text key={`c-${index}`} style={styles.partyLine}>
            {line}
          </Text>
        ))}

        <Text style={styles.partyHeading}>and</Text>
        <Text style={styles.partyName}>{parties.vendor.name}</Text>
        {parties.vendor.lines.map((line, index) => (
          <Text key={`v-${index}`} style={styles.partyLine}>
            {line}
          </Text>
        ))}

        {data.clauses.map((clause, index) => (
          <View key={`${index}-${clause.title}`}>
            <Text style={styles.clauseHeading}>
              {index + 1}. {clause.title}
            </Text>
            {clause.paragraphs.map((paragraph, pIndex) => (
              <Text key={pIndex} style={styles.para}>
                {paragraph}
              </Text>
            ))}
          </View>
        ))}

        {data.specialTerms.length > 0 ? (
          <View>
            <Text style={styles.clauseHeading}>{data.clauses.length + 1}. Special Terms</Text>
            {data.specialTerms.map((paragraph, index) => (
              <Text key={index} style={styles.para}>
                {paragraph}
              </Text>
            ))}
          </View>
        ) : null}

        {data.annexure.length > 0 ? (
          <View>
            <Text style={styles.annexureHead}>{data.annexureTitle ?? "Annexure"}</Text>
            {data.annexure.map((line, index) => (
              <View key={index} style={styles.annexureItem}>
                <Text style={styles.annexureBullet}>•</Text>
                <Text style={styles.annexureText}>{line}</Text>
              </View>
            ))}
          </View>
        ) : null}

        <Text style={styles.declaration}>{data.declaration}</Text>

        {/* ---- Signatures ---- */}
        <View style={styles.signatureWrap} wrap={false}>
          <View style={styles.signatureCol}>
            <Text style={styles.signatureFor}>{data.signatureHeadings?.company ?? `For and on behalf of ${parties.company.name}`}</Text>
            {letterhead.signatureUrl ? (
              // eslint-disable-next-line jsx-a11y/alt-text
              <Image src={letterhead.signatureUrl} style={styles.signatureImage} />
            ) : (
              <View style={styles.signatureSpace} />
            )}
            <View style={styles.signatureRule}>
              <Text style={styles.signatureName}>{data.signatories.company.name || " "}</Text>
              <Text style={styles.signatureMeta}>{data.signatories.company.designation}</Text>
              <Text style={styles.signatureMeta}>Date: {data.effectiveDate}</Text>
            </View>
          </View>
          <View style={styles.signatureCol}>
            <Text style={styles.signatureFor}>{data.signatureHeadings?.vendor ?? `For and on behalf of ${parties.vendor.name}`}</Text>
            <View style={styles.signatureSpace} />
            <View style={styles.signatureRule}>
              <Text style={styles.signatureName}>{data.signatories.vendor.name || " "}</Text>
              <Text style={styles.signatureMeta}>{data.signatories.vendor.designation}</Text>
              <Text style={styles.signatureMeta}>Date: ____________________</Text>
            </View>
          </View>
        </View>

        {data.includeWitnesses ? (
          <View style={styles.signatureWrap} wrap={false}>
            <View style={styles.signatureCol}>
              <Text style={styles.witnessHead}>Witness 1</Text>
              <View style={styles.signatureRule}>
                <Text style={styles.signatureMeta}>Name: ______________________________</Text>
                <Text style={styles.signatureMeta}>Address: ____________________________</Text>
              </View>
            </View>
            <View style={styles.signatureCol}>
              <Text style={styles.witnessHead}>Witness 2</Text>
              <View style={styles.signatureRule}>
                <Text style={styles.signatureMeta}>Name: ______________________________</Text>
                <Text style={styles.signatureMeta}>Address: ____________________________</Text>
              </View>
            </View>
          </View>
        ) : null}

        {/* ---- Letterhead footer: three sibling fixed nodes, repeats on
            every page. This exact shape is the one that survives pagination:
            a static Text + a boxed dynamic (pageNumber/totalPages) Text + the
            meta line, all absolutely positioned. A single container with
            rows, a bare dynamic Text, and an extra empty fixed View each lost
            text on later pages (verified by reading the rendered PDFs back on
            7-page documents). ---- */}
        <Text style={styles.footerText} fixed>
          {letterhead.footerText}
        </Text>
        <View style={styles.footerPageBox} fixed>
          <Text style={styles.footerPage} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
        <Text style={styles.footerMeta} fixed>
          {data.refNo} · Version v{data.version} ·{" "}
          {[letterhead.legalName, letterhead.email, letterhead.phone, letterhead.website].filter(Boolean).join("  ·  ")}
        </Text>
      </Page>
    </Document>
  );
}

/** Server-side entry point used by the generate/preview server actions. */
export function renderAgreementPdf(data: AgreementPdfData): Promise<Buffer> {
  return renderPdfToBuffer(<AgreementPdfDocument data={data} />);
}
