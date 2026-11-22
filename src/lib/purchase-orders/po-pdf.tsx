// 2026-11-22d — Phase 4: the Purchase Order as a real PDF file.
//
// Uses the shared A4 layout (src/lib/pdf/a4.tsx): company letterhead, table
// head and "Page X of Y" on every sheet, with the lines split into explicit
// pages (paginateLines) so the numbering is exact. The close-up photos are
// fetched from the linked order's LIVE list at render time — never a stored
// copy — and an unreachable one is omitted instead of failing the document
// (src/lib/documents/photo-data.ts).
import React from "react";
import { A4Document, A4Facts, A4Note, A4Page, A4PhotoGrid, A4Section, A4Signatures, A4Table, type A4Header } from "@/lib/pdf/a4";
import { renderPdfToBuffer } from "@/lib/pdf/render";
import { formatMoney, paginateLines } from "@/lib/documents/order-document";
import { toPdfImageSources } from "@/lib/documents/photo-data";
import { poTotal, type ParsedPoLine } from "./lines";

export type PoPdfInput = {
  poNo: string;
  poDate: string;
  expectedDate: string | null;
  status: string;
  currency: string | null;
  supplierName: string | null;
  orderRef: string | null;
  buyerName: string | null;
  companyName: string;
  companyLogoUrl: string | null;
  companyLines?: (string | null | undefined)[];
  companyGstin?: string | null;
  lines: Pick<ParsedPoLine, "sku_label" | "qty" | "unit_cost">[];
  photoUrls: string[];
};

const PO_LINES_PER_PAGE = 24;

export function poPdfTotals(lines: Pick<ParsedPoLine, "qty" | "unit_cost">[]): {
  qty: number;
  amount: number;
} {
  return {
    qty: lines.reduce((sum, line) => sum + line.qty, 0),
    amount: poTotal(lines),
  };
}

function headerFor(input: PoPdfInput): A4Header {
  return {
    title: "Purchase Order",
    subtitle: input.supplierName ? `Supplier: ${input.supplierName}` : null,
    docNo: input.poNo,
    docDate: input.poDate,
    meta: [
      input.expectedDate ? { label: "Expected", value: input.expectedDate } : null,
      { label: "Status", value: input.status },
      input.orderRef ? { label: "Linked order", value: input.orderRef } : null,
      input.companyGstin ? { label: "GSTIN", value: input.companyGstin } : null,
    ].filter((entry): entry is { label: string; value: string } => !!entry),
    companyName: input.companyName || "NYKO MART",
    companyLogoUrl: input.companyLogoUrl,
    companyLines: input.companyLines ?? [],
  };
}

export async function renderPurchaseOrderPdf(input: PoPdfInput): Promise<Buffer> {
  const photos = await toPdfImageSources(input.photoUrls);
  const totals = poPdfTotals(input.lines);

  const chunks = paginateLines(input.lines, PO_LINES_PER_PAGE);
  const totalPages = chunks.length + 1; // + the photo/acknowledgement page
  const header = headerFor(input);
  const footerNote = "Purchase order generated from the Nyko Mart Order Management System.";

  const pages: React.ReactNode[] = chunks.map((chunk, chunkIndex) => {
    const isLastChunk = chunkIndex === chunks.length - 1;
    const startIndex = chunks.slice(0, chunkIndex).reduce((sum, page) => sum + page.length, 0);

    return (
      <A4Page
        key={`lines-${chunkIndex}`}
        header={header}
        footerNote={footerNote}
        pageNumber={chunkIndex + 1}
        totalPages={totalPages}
      >
        {chunkIndex === 0 ? (
          <A4Section>
            <A4Facts
              facts={[
                { label: "Supplier", value: input.supplierName },
                { label: "Linked order", value: input.orderRef },
                { label: "Buyer", value: input.buyerName },
                { label: "Total quantity", value: String(totals.qty) },
              ]}
            />
          </A4Section>
        ) : null}

        <A4Section title={`Line items (${input.lines.length})`}>
          <A4Table
            columns={[
              { label: "#", width: 22 },
              { label: "SKU / item", flex: 3 },
              { label: "Qty", width: 40, align: "right" },
              { label: "Unit cost", width: 80, align: "right" },
              { label: "Amount", width: 86, align: "right" },
            ]}
            rows={chunk.map((line, index) => ({
              cells: [
                startIndex + index + 1,
                line.sku_label || "—",
                line.qty,
                formatMoney(line.unit_cost),
                formatMoney(line.qty * line.unit_cost),
              ],
            }))}
            totals={
              isLastChunk
                ? [
                    {
                      label: `Total${input.currency ? ` (${input.currency})` : ""}`,
                      value: formatMoney(totals.amount),
                      grand: true,
                    },
                  ]
                : undefined
            }
            emptyText="No lines on this purchase order."
          />
        </A4Section>
      </A4Page>
    );
  });

  pages.push(
    <A4Page key="photos" header={header} footerNote={footerNote} pageNumber={totalPages} totalPages={totalPages}>
      <A4Section title={`Close-up photos from the linked order (${photos.length})`}>
        <A4PhotoGrid
          srcs={photos}
          columns={3}
          height={150}
          emptyText={
            input.orderRef ? "This order has no close-up photos." : "This purchase order is no longer linked to an order."
          }
        />
        {photos.length < input.photoUrls.length ? (
          <A4Note>
            {input.photoUrls.length - photos.length} photo(s) could not be fetched and were left out of this PDF.
          </A4Note>
        ) : null}
      </A4Section>
      <A4Signatures labels={["Authorised signatory", "Supplier acknowledgement"]} />
    </A4Page>
  );

  return renderPdfToBuffer(
    <A4Document title={`Purchase Order ${input.poNo}`} author={input.companyName}>
      {pages}
    </A4Document>
  );
}
