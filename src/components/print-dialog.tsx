"use client";

// 2026-10-17 — "print a4 page par same page par dialogbox me show hoye or
// vahi se print ka command run ho": every Document Entry row's Print button
// used to be a <Link> to that document's own /report page — a full page
// navigation away from the list. This opens the SAME existing report page
// inside the shared A4 dialog instead, and prints from there.
//
// Why an iframe and not a re-implementation of each document: there are
// already 10+ single-document report pages (credit/debit note, internal
// invoice, journal voucher, received chalan, freight bill, duty bill,
// washing entry, shipment chalan, ...) that each already handle their own
// data loading, access check and A4 print CSS. Embedding them means this
// feature works for ALL of them at once, with one component, and can never
// drift out of sync with what the print page itself shows.
//
// The print command runs on the IFRAME's own window, not the dashboard's —
// so only the document is sent to the printer (the report page's own
// PrintArea @media print rules apply inside it), and the surrounding
// dashboard/dialog is never included.
//
// 2026-10-22 — "jo ye alag se dikh rahi hai vo auto adjust honi chahiye na
// page bhi iske hisab se khud adjust ho jaye": the dialog used to hand the
// frame a fixed A4-ratio height, so a short document (a bill with 3 AWBs, a
// one-line note) floated at the top of a tall blank sheet. Two changes:
//   1. A4Dialog now runs in fitContent mode — panel height follows content.
//   2. After the frame loads, the embedded page's own scrollHeight is
//      measured (same-origin, so readable) and the frame is given exactly
//      that height. Re-measured once shortly after load so late layout
//      (fonts, logo, table reflow) is included.
// The embedded report pages hide their own "← Back / Download PDF" toolbar
// when ?embed=1 (see their `x-embed` check), so the sheet shows the document
// and nothing else.
//
// 2026-10-24 — "A4 DILOG BOX ME JO REPORT GENRATE HO RAHI HAI USME AUTO
// ADJUST HO OR USKA PRINT PORTRAIT & LANDSCAPE ME AUTO HO JAYE SATH ME PDF ME
// BHI SAHI SE HO JAYE":
//
//   AUTO ORIENTATION. Every report inside this dialog used to print on the
//   A4 PORTRAIT page size that PrintArea hard-codes. A wide sheet (the
//   courier bill has 21 columns) then printed with its right-hand columns
//   cut off — and so did the PDF, since "Save as PDF" is the same print
//   pipeline. Two halves to the fix:
//
//   (a) DETECT: after load, the document's own width is compared to its
//       visible width. The frame is ~850px wide (≈ A4 portrait), so content
//       that already overflows here would certainly be clipped on a portrait
//       sheet. When it overflows, the preview switches to LANDSCAPE
//       automatically (the dialog widens so the sheet on screen matches what
//       will print). Anything that fits stays portrait.
//
//   (b) OVERRIDE + APPLY: a Portrait / Landscape switch in the footer lets
//       the user force either one (e.g. a signed portrait letter). Whichever
//       is active is injected into the FRAME's own <head> as
//       `@page { size: A4 portrait|landscape }` immediately before printing,
//       so the physical print — and "Save as PDF", which uses the same page
//       box — is laid out for that orientation instead of being clipped.
import { useCallback, useEffect, useRef, useState } from "react";
import { A4Dialog } from "./a4-dialog";

type PrintOrientation = "portrait" | "landscape";

const ORIENTATION_STYLE_ID = "oms-print-orientation";

export function PrintDialog({
  href,
  label = "🖨 Print",
  title,
  subtitle,
  className,
}: {
  /** Path of the existing single-document report page to embed. */
  href: string;
  label?: string;
  title?: string;
  subtitle?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [docHeight, setDocHeight] = useState<number | null>(null);
  const [orientation, setOrientation] = useState<PrintOrientation>("portrait");
  // Set once the user picks an orientation by hand, so the automatic
  // overflow detection stops overriding their choice for this document.
  // Kept in a ref for the measurement callback (which must read the latest
  // value without re-running) AND mirrored into state for the footer label —
  // reading a ref during render is not allowed.
  const manualOrientation = useRef(false);
  const [manualPicked, setManualPicked] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  // 2026-10-19 — "dialog box me open ho to sirf page hi open ho": the page
  // this previews is a normal dashboard route, so without ?embed=1 the
  // frame would render the whole app shell (sidebar/header/tabs) around the
  // one document being printed. proxy.ts turns that param into the x-embed
  // header dashboard/layout.tsx reads to skip just the chrome.
  const src = `${href}${href.includes("?") ? "&" : "?"}embed=1`;

  // A fresh open re-runs the page (so the document is always current after
  // an edit) — keep the "loaded" flag honest for the Print button state.
  const openDialog = useCallback(() => {
    setLoaded(false);
    setDocHeight(null);
    setOrientation("portrait");
    manualOrientation.current = false;
    setManualPicked(false);
    setOpen(true);
  }, []);

  // Writes (or refreshes) the frame document's @page rule. Kept out of the
  // report pages themselves: they are shared by the full-page route and this
  // embed, and the page size is only this dialog's decision to make.
  //
  // 2026-10-24 (b) — TWO fixes for "preview landscape me aara hai par print
  // karte hi portrait ho jati hai aur puri nahi aati":
  //   1. Cascade order. PrintArea emits its own `@page { size: A4 }` from a
  //      React-rendered <style> in the frame's BODY — which comes AFTER the
  //      head-injected rule this dialog used to write, so the browser picked
  //      PrintArea's portrait rule for the actual print/PDF while the preview
  //      happily said landscape. The PrintArea rule is now found by its
  //      #oms-printarea-page id and its @page block stripped here (the fresh
  //      iframe loads a new document every open, so nothing is lost for the
  //      page's own full-page print).
  //   2. Nothing gets cut. A sheet wider than the printable page width is
  //      clipped by the browser, not shrunk — so in addition to the correct
  //      page box, the print rules below cap every table at the page's width
  //      (cells wrap instead of the right-hand columns being chopped off).
  const applyOrientation = useCallback((doc: Document, value: PrintOrientation) => {
    // (1) Neutralise the embedded page's own hard-coded portrait @page.
    doc.querySelectorAll("style").forEach((el) => {
      if (el.id !== "oms-printarea-page") return;
      const text = el.textContent ?? "";
      if (text.includes("@page")) el.textContent = text.replace(/@page\s*{[^}]*}/g, "").trim();
    });

    let style = doc.getElementById(ORIENTATION_STYLE_ID) as HTMLStyleElement | null;
    if (!style) {
      style = doc.createElement("style");
      style.id = ORIENTATION_STYLE_ID;
      // Appended to the BODY, not the head: it must win the cascade over any
      // other @page rule the embedded report may render.
      (doc.body ?? doc.head)?.appendChild(style);
    }
    style.textContent = [
      `@page { size: A4 ${value}; margin: ${
        value === "landscape" ? "10mm 10mm 14mm 10mm" : "14mm 12mm 16mm 12mm"
      }; }`,
      // (2) Fit the content to the printed page width instead of letting the
      // printer clip it. Applied to every embedded document — a table that
      // already fits is unaffected by max-width, one that is wider now wraps
      // its cells inside the sheet rather than losing its right-hand columns.
      "@media print { table { max-width: 100% !important; } th, td { overflow-wrap: anywhere; word-break: break-word; } }",
    ].join("\n");
  }, []);

  // Height of the embedded document itself (not the iframe's own viewport),
  // so the dialog can shrink to fit it. Same-origin iframe → readable; if a
  // browser ever refuses, the fixed minHeight below keeps it usable.
  //
  // Measured on the page's OWN content (the dashboard shell's <main> scrolls
  // inside a fixed h-dvh shell, so documentElement.scrollHeight would just
  // echo the iframe's current height and never shrink): content block height
  // + main's top padding + a normal bottom padding — main's pb-24 exists for
  // the floating messenger/companion widgets, which embed mode doesn't
  // render, so it is capped rather than counted in full.
  //
  // Also decides the print orientation (see the 2026-10-24 note above).
  const measure = useCallback(() => {
    const frame = iframeRef.current;
    const doc = frame?.contentDocument;
    const win = frame?.contentWindow;
    if (!doc || !win) return;
    try {
      const main = doc.querySelector("main");
      const content = main?.firstElementChild as HTMLElement | null;

      // Overflow detection: any horizontal overflow inside a frame that is
      // already about A4-portrait wide means a portrait sheet would clip the
      // right-hand columns, so default this document to landscape.
      const rootEl = doc.documentElement;
      const contentOverflow = content ? content.scrollWidth - content.clientWidth : 0;
      const rootOverflow = rootEl ? rootEl.scrollWidth - rootEl.clientWidth : 0;
      const overflows = Math.max(contentOverflow, rootOverflow) > 8;
      if (!manualOrientation.current) {
        const next: PrintOrientation = overflows ? "landscape" : "portrait";
        setOrientation(next);
        applyOrientation(doc, next);
      }

      if (main && content) {
        const cs = win.getComputedStyle(main);
        const padT = parseFloat(cs.paddingTop) || 0;
        const padB = Math.min(parseFloat(cs.paddingBottom) || 0, 32);
        const h = Math.ceil(content.getBoundingClientRect().height + padT + padB);
        if (h > 0) {
          setDocHeight(h);
          return;
        }
      }
      const h = Math.max(doc.documentElement?.scrollHeight ?? 0, doc.body?.scrollHeight ?? 0);
      if (h > 0) setDocHeight(h);
    } catch {
      // Cross-origin or a document mid-navigation — keep the default height.
    }
  }, [applyOrientation]);

  const handleLoad = useCallback(() => {
    setLoaded(true);
    measure();
    // Second pass: tables/logos/fonts can settle a frame later.
    window.setTimeout(measure, 300);
  }, [measure]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  // Re-apply the page box whenever the orientation changes, so a manual
  // switch also applies if the frame is printed with the browser's own
  // Ctrl+P instead of the button below.
  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (doc) applyOrientation(doc, orientation);
  }, [orientation, applyOrientation]);

  const printNow = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      // The @page rule must be in the frame before print() snapshots layout.
      if (win.document) applyOrientation(win.document, orientation);
      win.focus();
      win.print();
    } catch {
      // Some browsers block printing a cross-document frame until it has
      // fully loaded — the button stays disabled until onLoad fires, so
      // this is only a last-resort guard, never a silent failure of the
      // feature itself. Tell the user rather than doing nothing.
      window.alert("The document is still loading — please try Print again in a moment.");
    }
  }, [applyOrientation, orientation]);

  const pickOrientation = useCallback((value: PrintOrientation) => {
    manualOrientation.current = true;
    setManualPicked(true);
    setOrientation(value);
  }, []);

  // 2026-10-24 (b) — "A4 DILOG ME JO REPORT GENRATE HOTI HAI VO DOWNLOAD BHI
  // HONI CHAHIYE PDF EXCEL FORMAT ME LANDSCAPE OR PORTRAIT ME": PDF already
  // goes through the print pipeline (which now honours the orientation
  // switch, and "Save as PDF" uses the same page box), so the missing half
  // was a real FILE download for spreadsheets. Every report in this dialog is
  // an HTML table, so the frame's own tables are wrapped into an Excel
  // workbook (.xls, the HTML-table flavour every Excel/Sheets/LibreOffice
  // imports) — no library, no per-report wiring, and it always matches
  // exactly what is on screen.
  const downloadExcel = useCallback(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    try {
      const tables = Array.from(doc.querySelectorAll("table"));
      if (tables.length === 0) {
        window.alert("This document has no table to put in a spreadsheet — use “Download PDF” instead.");
        return;
      }
      const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      const heading = doc.querySelector("h1")?.textContent?.trim() || title || "Report";
      const body = tables
        .map((t, i) =>
          `<h3>${escape(heading)}${tables.length > 1 ? ` — table ${i + 1}` : ""}</h3>${t.outerHTML}`
        )
        .join("<br/>");
      const html = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8" /></head><body>${body}</body></html>`;
      const blob = new Blob([html], { type: "application/vnd.ms-excel;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const base = (title ?? "report").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      link.href = url;
      link.download = `${base || "report"}-${new Date().toISOString().slice(0, 10)}.xls`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch {
      window.alert("Could not read the document to build the spreadsheet — please use “Download PDF”.");
    }
  }, [title]);

  const segBtn = (value: PrintOrientation) =>
    `rounded px-2 py-1 text-[11px] font-medium ${
      orientation === value ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"
    }`;

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={
          className ??
          "rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
        }
        title="Open this document in an A4 dialog and print from there"
      >
        {label}
      </button>

      <A4Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title ?? "Print Preview"}
        subtitle={
          subtitle ??
          `A4 ${orientation} preview — “Download PDF” saves it in this orientation, “Excel” saves the same sheet as a spreadsheet.`
        }
        flushBody
        fitContent
        wide={orientation === "landscape"}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 p-0.5">
                <button type="button" onClick={() => pickOrientation("portrait")} className={segBtn("portrait")}>
                  📄 Portrait
                </button>
                <button type="button" onClick={() => pickOrientation("landscape")} className={segBtn("landscape")}>
                  📐 Landscape
                </button>
              </div>
              <span className="text-[11px] text-slate-500">
                {manualPicked
                  ? `Printing A4 ${orientation}.`
                  : orientation === "landscape"
                    ? "Wide sheet — landscape picked automatically."
                    : "Fits A4 portrait."}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={downloadExcel}
                disabled={!loaded}
                title="Download this sheet as an Excel file (.xls) — one section per table on the document"
                className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
              >
                ⬇ Excel
              </button>
              <button
                type="button"
                onClick={printNow}
                disabled={!loaded}
                title={`Prints / saves the PDF on A4 ${orientation} — pick “Save as PDF” as the printer`}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                ⬇ PDF (A4 {orientation})
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Close
              </button>
            </div>
          </div>
        }
      >
        {open && (
          <iframe
            ref={iframeRef}
            src={src}
            title={title ?? "Print preview"}
            onLoad={handleLoad}
            className="w-full border-0 bg-white"
            style={{ height: docHeight ?? "min(70vh, calc(92vw * 1.4142))" }}
          />
        )}
      </A4Dialog>
    </>
  );
}
