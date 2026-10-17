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
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // A fresh open re-runs the page (so the document is always current after
  // an edit) — keep the "loaded" flag honest for the Print button state.
  const openDialog = useCallback(() => {
    setLoaded(false);
    setOpen(true);
  }, []);

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
            src={href}
            title={title ?? "Print preview"}
            onLoad={() => setLoaded(true)}
            className="h-full w-full border-0 bg-white"
            style={{ minHeight: "min(70vh, calc(92vw * 1.4142))" }}
          />
        )}
      </A4Dialog>
    </>
  );
}
