"use client";

// 2026-09-10 — real bug reported right after the FedEx label round-2 fix
// shipped: the shipment booked fine (tracking number + freight amount came
// through) and a label WAS generated, but clicking "🖨 Download label"
// opened what looked like an error — the user pasted back exactly what
// showed up, and it was the raw PDF byte stream itself
// ("%PDF-1.4 1 0 obj <</Type /Catalog ..." etc, base64-decoded) sitting on
// screen as plain text instead of a rendered PDF.
//
// Root cause: FedEx's label now comes back as a self-contained
// data:application/pdf;base64,... URI (see fedex-ship.ts's round-2 fix —
// that swap fixed the earlier "LOGIN.REAUTHENTICATE.ERROR" problem, which
// was a real fix). But every place in this app that opens a label link
// does `<a href={labelUrl} target="_blank">` or `window.open(labelUrl,
// "_blank")` — and Chrome's built-in PDF viewer does not reliably engage
// for a data: URI opened this way, especially a large one. Instead of
// rendering the PDF, the new tab just falls back to showing the underlying
// bytes as raw text. This never showed up for UPS/DHL before because it
// happened to get exercised in a way that worked, or wasn't tested the
// same way — this is the first real end-to-end click-test of a FedEx label
// since the round-2 fix, and it surfaced this.
//
// Fix: convert the data: URI into a real Blob client-side and open THAT
// (a blob: URL) instead of the data: URI directly. fetch() can read a
// data: URI with no actual network request, hand back a Blob, and a blob:
// URL opens in Chrome's PDF viewer exactly like any normal downloaded
// file. A courier that still hands back a plain http(s) URL (Delhivery,
// Shiprocket, or FedEx's own last-resort url fallback in
// resolveLabelAsDataUri) is opened exactly as before — untouched, since
// that path was never the problem.
export async function openLabelUrl(url: string): Promise<void> {
  if (!url.startsWith("data:")) {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  try {
    const blob = await (await fetch(url)).blob();
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, "_blank", "noopener,noreferrer");
    // Revoke after a delay rather than immediately — the new tab needs
    // time to actually load the blob: URL before it's invalidated.
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } catch {
    // Last resort — no worse than the old behavior if this ever fails.
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
