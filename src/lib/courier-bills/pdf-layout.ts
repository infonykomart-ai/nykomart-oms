// Reconstructs a courier-bill PDF's text in visual reading order (equivalent
// to `pdftotext -layout`), using pdfjs-dist directly instead of a system
// binary — see claude/order-lifecycle-inventory-tracking-adspend-requests-
// 2026-08-08.md for why: `pdftotext` isn't safe to ship to Vercel serverless,
// and pdf-parse's own default getText() output is NOT in visual order (it
// follows the PDF's internal content-stream order, which jumbles multi-
// column layouts like these courier bills badly enough that line-based
// regex parsing on it is unreliable). This groups text items by Y position
// into lines, sorts each line left-to-right by X, and joins with spacing
// roughly proportional to the pixel gap between items — verified against
// real UPS and FedEx sample bills to reproduce `pdftotext -layout` output.
//
// pdfjs-dist is marked in next.config.ts's serverExternalPackages so
// webpack doesn't try to bundle it — it's required natively at runtime,
// same as it works under plain Node (which is how this algorithm was
// validated against sample PDFs before being written here).
export async function extractLayoutText(buf: Buffer): Promise<string> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await getDocument({ data: new Uint8Array(buf) }).promise;

  let fullText = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = (content.items as Array<{ str?: string; transform: number[] }>).filter((it) => typeof it.str === "string");

    type Line = { y: number; items: { x: number; str: string }[] };
    const lines: Line[] = [];
    for (const it of items) {
      const y = Math.round(it.transform[5]);
      const x = it.transform[4];
      let line = lines.find((l) => Math.abs(l.y - y) <= 2);
      if (!line) {
        line = { y, items: [] };
        lines.push(line);
      }
      line.items.push({ x, str: it.str! });
    }
    lines.sort((a, b) => b.y - a.y);

    for (const line of lines) {
      line.items.sort((a, b) => a.x - b.x);
      let lineStr = "";
      let lastX: number | null = null;
      for (const it of line.items) {
        if (lastX !== null) {
          const gap = it.x - lastX;
          const spaces = gap > 20 ? Math.min(Math.round(gap / 5), 20) : 1;
          lineStr += " ".repeat(Math.max(1, spaces));
        }
        lineStr += it.str;
        lastX = it.x + it.str.length * 5; // rough width estimate, matches the validated prototype
      }
      fullText += lineStr + "\n";
    }
    fullText += "\n";
  }
  return fullText;
}
