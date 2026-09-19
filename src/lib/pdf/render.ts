import { pdf, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";

// 2026-09-19 — shared @react-pdf/renderer -> Buffer plumbing. Extracted
// from src/lib/bill-statement-pdf.tsx (which had its own private
// streamToBuffer) so every PDF generator in this app — the Bill Statement
// PDF and the new Doc Statement PDFs (Credit Note / CSB Filing / Refund /
// Order Refund) — shares ONE implementation instead of copy-pasting the
// same stream-draining boilerplate per file. Behavior is unchanged from
// the original bill-statement-pdf.tsx version.
//
// The element param is typed ReactElement<DocumentProps> (not a bare
// ReactElement) because @react-pdf/renderer's own `pdf()` signature
// requires it — a plain ReactElement's props type is `unknown`, which
// isn't assignable to DocumentProps, and every caller here always passes a
// real <Document>...</Document> anyway.
export async function renderPdfToBuffer(element: ReactElement<DocumentProps>): Promise<Buffer> {
  const instance = pdf(element);
  const blob = await instance.toBuffer();
  return streamToBuffer(blob as unknown as NodeJS.ReadableStream);
}

function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}
