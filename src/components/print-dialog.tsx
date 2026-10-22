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
import { useCallback, useEffect, useRef, useState } from "react";
import { A4Dialog } from "./a4-dialog";

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
    setOpen(true);
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
  const measure = useCallback(() => {
    const frame = iframeRef.current;
    const doc = frame?.contentDocument;
    const win = frame?.contentWindow;
    if (!doc || !win) return;
    try {
      const main = doc.querySelector("main");
      const content = main?.firstElementChild as HTMLElement | null;
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
  }, []);

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

  const printNow = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    try {
      win.focus();
      win.print();
    } catch {
      // Some browsers block printing a cross-document frame until it has
      // fully loaded — the button stays disabled until onLoad fires, so
      // this is only a last-resort guard, never a silent failure of the
      // feature itself. Tell the user rather than doing nothing.
      window.alert("The document is still loading — please try Print again in a moment.");
    }
  }, []);

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
        subtitle={subtitle ?? "A4 preview — prints exactly this document."}
        flushBody
        fitContent
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-[11px] text-slate-500">
              {loaded ? "A4 preview loaded." : "Loading document…"}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={printNow}
                disabled={!loaded}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                🖨 Print / Save PDF
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
