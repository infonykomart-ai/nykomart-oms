// 2026-11-22d — Phase 4: Order Sheet / Invoice / Tax Invoice / Packing List
// as real PDF files, rendered server-side with the shared A4 layout
// (src/lib/pdf/a4.tsx) from the pure model in ./order-document.ts.
//
// One builder serves all four documents because they differ only in what the
// model exposes (prices vs. no prices, HSN column) — see DOCUMENT_KINDS. The
// model is built by the API routes from the SAME rows the on-screen pages
// read, so the PDF can never show different quantities or values.
//
// Pagination is explicit: the lines are split into chunks by
// paginateLines(), and each chunk becomes its own A4 sheet. That is what makes
// the letterhead, the table head and "Page X of Y" correct on every page.
import React from "react";
import { A4Document, A4Facts, A4Note, A4Page, A4PhotoGrid, A4Section, A4Signatures, A4Table, type A4Column, type A4Header } from "@/lib/pdf/a4";
import { renderPdfToBuffer } from "@/lib/pdf/render";
import { formatMoney, LINES_PER_PAGE, paginateLines, type DocumentLine, type OrderDocumentModel } from "./order-document";
import { toPdfImageSources } from "./photo-data";

function headerFor(model: OrderDocumentModel): A4Header {
  const meta = [
    model.company.gstin ? { label: "GSTIN", value: model.company.gstin } : null,
    model.secondaryNo ? { label: "Master / Ref", value: model.secondaryNo } : null,
    model.status ? { label: "Order status", value: model.status } : null,
    model.currency ? { label: "Currency", value: model.currency } : null,
  ].filter((entry): entry is { label: string; value: string } => !!entry);

  return {
    title: model.title,
    subtitle: model.storeName ? `Store: ${model.storeName}` : null,
    docNo: model.docNo,
    docDate: model.docDate,
    meta,
    companyName: model.company.name || "NYKO MART",
    companyLogoUrl: model.company.logoUrl,
    companyLines: [
      model.company.address,
      model.company.phone ? `Phone: ${model.company.phone}` : null,
      model.company.email ? `Email: ${model.company.email}` : null,
    ],
  };
}

function itemLabel(line: DocumentLine): string {
  const parts = [line.sku, line.size, line.colour].filter((part): part is string => !!part && !!part.trim());
  return parts.length ? parts.join(" · ") : "—";
}

function orderColumns(model: OrderDocumentModel): A4Column[] {
  const columns: A4Column[] = [
    { label: "#", width: 20 },
    { label: "Ref no.", width: 78 },
    { label: "Item (SKU · size · colour)", flex: 3 },
  ];
  if (model.showTaxColumns) columns.push({ label: "HSN", width: 46 });
  columns.push({ label: "Qty", width: 34, align: "right" });
  if (model.showPrices) columns.push({ label: "Value", width: 74, align: "right" });
  return columns;
}

function orderRows(model: OrderDocumentModel, lines: DocumentLine[], startIndex: number) {
  return lines.map((line, index) => {
    const cells: React.ReactNode[] = [startIndex + index + 1, line.refNo ?? "—", itemLabel(line)];
    if (model.showTaxColumns) cells.push(line.hsn ?? "—");
    cells.push(line.qty);
    if (model.showPrices) {
      cells.push(line.amount === null ? "—" : `${line.currency ? `${line.currency} ` : ""}${formatMoney(line.amount)}`);
    }
    return { cells };
  });
}

function orderTotals(model: OrderDocumentModel): { label: string; value: string; grand?: boolean }[] | undefined {
  if (!model.showPrices) return undefined;
  const totals: { label: string; value: string; grand?: boolean }[] = model.totals.money.map((total) => ({
    label: `Total (${total.currency})`,
    value: formatMoney(total.amount),
  }));
  if (model.totals.inr !== null) {
    totals.push({ label: "Total (INR, converted)", value: `INR ${formatMoney(model.totals.inr)}` });
  }
  if (!totals.length) return undefined;
  // The last row is the emphasised one (the invoice's payable total).
  return totals.map((total, index) => (index === totals.length - 1 ? { ...total, grand: true } : total));
}

function footerNoteFor(model: OrderDocumentModel): string {
  if (model.kind === "tax-invoice") return "Tax invoice generated from the Nyko Mart Order Management System.";
  if (model.kind === "packing-list") {
    return "Packing list generated from the Nyko Mart Order Management System — quantities only, no commercial value declared.";
  }
  return "Computer-generated document from the Nyko Mart Order Management System — no signature required.";
}

export async function renderOrderDocumentPdf(model: OrderDocumentModel): Promise<Buffer> {
  const photos = await toPdfImageSources(model.photos);
  const withPhotos = model.kind !== "packing-list" && model.photos.length > 0;

  const chunks = paginateLines(model.lines, model.showPrices ? LINES_PER_PAGE : LINES_PER_PAGE + 2);
  const totalPages = chunks.length + (withPhotos ? 1 : 0);
  const header = headerFor(model);
  const footerNote = footerNoteFor(model);

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
                { label: model.party.heading, value: model.party.name },
                { label: "Contact", value: model.party.contact },
                { label: "Destination", value: model.party.destination },
                { label: "Total quantity", value: String(model.totals.qty) },
              ]}
            />
          </A4Section>
        ) : null}

        <A4Section title={`Lines (${model.lines.length})`}>
          <A4Table
            columns={orderColumns(model)}
            rows={orderRows(model, chunk, startIndex)}
            totals={isLastChunk ? orderTotals(model) : undefined}
            emptyText="No lines on this document."
          />
          {isLastChunk && model.showPrices && model.totals.mixedCurrency ? (
            <A4Note>
              Lines are in more than one currency, so each currency is totalled separately — they are never added
              together. The INR figure is the stored conversion of each line.
            </A4Note>
          ) : null}
        </A4Section>

        {isLastChunk && model.kind === "packing-list" ? (
          <A4Section title="Packing declaration">
            <A4Note>{model.totals.qty} piece(s) packed. Counted and checked against the invoice before dispatch.</A4Note>
          </A4Section>
        ) : null}

        {isLastChunk && !withPhotos ? (
          <A4Signatures labels={model.kind === "packing-list" ? ["Packed by", "Checked by"] : ["Authorised signatory", "Received by"]} />
        ) : null}
      </A4Page>
    );
  });

  if (withPhotos) {
    pages.push(
      <A4Page key="photos" header={header} footerNote={footerNote} pageNumber={totalPages} totalPages={totalPages}>
        <A4Section title={`Close-up photos (${photos.length} of ${model.photos.length})`}>
          <A4PhotoGrid srcs={photos} columns={3} height={150} emptyText="No photo could be embedded." />
          {photos.length < model.photos.length ? (
            <A4Note>
              {model.photos.length - photos.length} photo(s) could not be fetched and were left out of this PDF.
            </A4Note>
          ) : null}
        </A4Section>
        <A4Signatures labels={["Authorised signatory", "Received by"]} />
      </A4Page>
    );
  }

  return renderPdfToBuffer(
    <A4Document title={`${model.title} ${model.docNo}`} author={model.company.name}>
      {pages}
    </A4Document>
  );
}
