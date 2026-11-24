// 2026-11-24 — ONE print entry point for every HTML surface (reports,
// bills, invoices, statements, order sheets) so page size + orientation are
// decided the same way everywhere.
//
// Why this exists: PrintArea hard-codes `@page { size: A4 }` (portrait) —
// right for a letter or an invoice, wrong for the 20-column reports that
// print through the same 56 call sites, which came out with their right-hand
// columns clipped. The A4 dialog already solved this for its own preview by
// measuring the embedded page and injecting `@page { size: A4 landscape }`;
// this module is the same idea for the plain `window.print()` buttons.
//
// It does two things, both of them reversible:
//   1. Chooses an orientation: the caller's explicit choice, or "auto" —
//      measure the printable area's own width against an A4 portrait sheet
//      and go landscape when the content is wider than that.
//   2. Writes that page box into the document. PrintArea's own @page rule is
//      rendered from a <style> in the BODY, so it beats anything injected
//      into <head>; that rule is rewritten in place (by its id) instead,
//      with a head rule as the fallback for pages without a PrintArea. The
//      injected/replaced rule is removed again after printing, so a later
//      Ctrl+P of the same screen is not silently stuck in landscape.

export type PrintOrientation = "portrait" | "landscape";

/** A4 portrait printable width in CSS px at 96dpi: 210mm − 24mm of margins. */
const A4_PORTRAIT_CONTENT_PX = 703;

/** PrintArea's own <style> id — its @page block must be rewritten, not duplicated. */
const PRINT_AREA_STYLE_ID = "oms-printarea-page";
/** The head-level rule this module owns. */
const PRINT_PAGE_STYLE_ID = "oms-print-page";

export const PRINT_MARGINS: Record<PrintOrientation, string> = {
  portrait: "14mm 12mm 16mm 12mm",
  landscape: "10mm 10mm 14mm 10mm",
};

export function printPageRule(orientation: PrintOrientation): string {
  return `@page { size: A4 ${orientation}; margin: ${PRINT_MARGINS[orientation]}; }`;
}

/**
 * Auto orientation for an element: a document wider than an A4 portrait
 * sheet would be clipped there, so it prints landscape. `+ 8` absorbs
 * sub-pixel/scrollbar rounding so a document that exactly fits stays
 * portrait.
 */
export function detectPrintOrientation(area?: HTMLElement | null): PrintOrientation {
  if (!area) return "portrait";
  // Measure the widest TABLE as well as the area itself: report tables sit
  // inside an `overflow-x-auto` wrapper, so the wrapper's own scrollWidth
  // never grows past the column — only the table inside it knows how wide
  // the document really is.
  let width = Math.max(area.scrollWidth, Math.ceil(area.getBoundingClientRect().width));
  area.querySelectorAll("table").forEach((table) => {
    width = Math.max(width, table.scrollWidth, Math.ceil(table.getBoundingClientRect().width));
  });
  return width > A4_PORTRAIT_CONTENT_PX + 8 ? "landscape" : "portrait";
}

/** Writes the page box; returns an undo function. */
function applyPrintPageBox(orientation: PrintOrientation): () => void {
  const rule = printPageRule(orientation);

  const areaStyle = document.getElementById(PRINT_AREA_STYLE_ID);
  let areaStyleBefore: string | null = null;
  if (areaStyle) {
    areaStyleBefore = areaStyle.textContent ?? "";
    const text = areaStyleBefore;
    areaStyle.textContent = /@page\s*{/.test(text)
      ? text.replace(/@page\s*{[^}]*}/g, rule)
      : `${rule}\n${text}`;
  }

  let headStyle = document.getElementById(PRINT_PAGE_STYLE_ID) as HTMLStyleElement | null;
  if (!headStyle) {
    headStyle = document.createElement("style");
    headStyle.id = PRINT_PAGE_STYLE_ID;
    document.head.appendChild(headStyle);
  }
  headStyle.textContent = rule;

  return () => {
    if (areaStyle && areaStyleBefore !== null) areaStyle.textContent = areaStyleBefore;
    headStyle?.remove();
  };
}

/**
 * Prints the page (or one print area) on A4, choosing landscape when the
 * content does not fit portrait. Returns the orientation actually used.
 *
 * Call this instead of `window.print()` from print / "Save as PDF" buttons.
 */
export function printDocument({
  areaId,
  orientation = "auto",
}: {
  /** The PrintArea wrapper's id, when the page prints only one area. */
  areaId?: string;
  /** Explicit user choice, or "auto" (default) to measure the area. */
  orientation?: PrintOrientation | "auto";
} = {}): PrintOrientation {
  const area = areaId ? document.getElementById(areaId) : null;
  const chosen = orientation === "auto" ? detectPrintOrientation(area) : orientation;

  const undo = applyPrintPageBox(chosen);
  let done = false;
  const cleanup = () => {
    if (done) return;
    done = true;
    window.removeEventListener("afterprint", cleanup);
    undo();
  };
  window.addEventListener("afterprint", cleanup);
  // Some embedded browsers never fire afterprint; don't leave the page box
  // stuck on a later manual Ctrl+P.
  window.setTimeout(cleanup, 60_000);

  window.print();
  return chosen;
}
