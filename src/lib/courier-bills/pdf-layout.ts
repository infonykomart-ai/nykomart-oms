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
//
// pdfjs-dist internally tries to polyfill DOMMatrix/ImageData/Path2D (needed
// by some PDFs' font/glyph-path handling, even for plain text extraction)
// by `require("@napi-rs/canvas")` relative to its OWN install location. On
// Vercel, serverExternalPackages relocates the module to a hashed path
// (e.g. "pdfjs-dist-<hash>/legacy/build/pdf.mjs") whose require() can't
// find @napi-rs/canvas anymore, so that internal polyfill silently fails
// and a later unconditional `new DOMMatrix(...)` throws. Polyfilling these
// globals ourselves — using @napi-rs/canvas directly, which is already a
// prebuilt-binary (Vercel-safe, same pattern as the `sharp` dependency)
// transitive dep via pdf-parse — sidesteps pdfjs-dist's fragile internal
// resolution entirely: it checks `if (!globalThis.DOMMatrix)` before even
// attempting its own require.
async function ensureNodeCanvasPolyfills() {
  const g = globalThis as unknown as { DOMMatrix?: unknown; ImageData?: unknown; Path2D?: unknown };
  if (g.DOMMatrix && g.ImageData && g.Path2D) return;
  const canvas = await import("@napi-rs/canvas");
  g.DOMMatrix ??= canvas.DOMMatrix;
  g.ImageData ??= canvas.ImageData;
  g.Path2D ??= canvas.Path2D;
}

export async function extractLayoutText(buf: Buffer): Promise<string> {
  await ensureNodeCanvasPolyfills();
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
