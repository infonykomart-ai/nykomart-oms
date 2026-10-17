"use client";

// 2026-09-19 — "edit/view update karte hai to dusre page par le jane ki
// bajaye ek alag window dialogbox ki tarah open hoye ... A4 ke page me hi
// open hoyega": ONE shared A4-width modal dialog, reused by every edit/view
// surface so no page navigation is needed for an update.
//
// Sizing: "A4 sige" = A4's aspect ratio applied to the screen. Width scales
// with the viewport (min(92vw, 850px)) so it stays usable on smaller
// screens; height = width × √2 (A4's height:width ratio), capped by the
// viewport so short screens scroll INSIDE the dialog instead of clipping.
// The body area is the scroll container; the header/toolbar stays visible.
//
// Accessibility: role=dialog aria-modal, Esc closes, backdrop click closes,
// body scroll is locked while open, focus is moved into the dialog on
// open (first focusable or the dialog itself).
//
// The optional footer slot lets a printable document add its own Download
// PDF button (window.print() prints the dialog's contents — the shared
// print CSS makes every ancestor visible, so a document inside a modal
// prints like any other page).
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

// 2026-10-16 — two additions for "print/edit/view sabhi same page par
// dialog box me":
//
// (a) PORTAL: the dialog now renders into document.body instead of at its
//     click-position inside the page tree. It is a fixed overlay either
//     way, so nothing moves visually — but for PRINT it matters: a dialog
//     opened from a Document Entry row lives inside the lists' shared
//     #doc-lists-print-area, whose own PrintArea CSS marks EVERYTHING in
//     that list visible (an id+universal selector beats `body * {
//     visibility: hidden }`), so printing from inside the dialog would
//     have printed the whole Recent list around it. Portalled to body, the
//     dialog is outside every list PrintArea.
//
// (b) PRINT CSS below: with the dialog as a direct body child, printing
//     hides every OTHER body child with `display: none` — display, unlike
//     visibility, also removes it from layout, so the hidden shell/list
//     above the dialog can't emit blank pages before the document. The
//     overlay/panel go static + full width (a fixed overlay clips print
//     output to one page — the exact bug print-view.tsx's 2026-08-19 fix
//     documents), and the header/footer chrome is dropped so only the
//     dialog body (the PrintArea'd document) prints.

export const A4_DIALOG_WIDTH = "min(92vw, 850px)";

export function A4Dialog({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  flushBody = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  /** Sticky bottom bar — e.g. Save/Close buttons or a Download PDF button. */
  footer?: ReactNode;
  /** Edge-to-edge body (no padding/gray) — for iframe-embedded full pages. */
  flushBody?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => {
      const target = panelRef.current?.querySelector<HTMLElement>(
        "input:not([type=hidden]), select, textarea, button"
      );
      (target ?? panelRef.current)?.focus?.();
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      cancelAnimationFrame(raf);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="a4-dialog-overlay fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-2 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        className="a4-dialog-panel flex flex-col overflow-hidden rounded-xl bg-white shadow-2xl outline-none"
        style={{ width: A4_DIALOG_WIDTH, height: "min(calc(92vw * 1.4142), 96vh)" }}
      >
        <style>{`
          @media print {
            body > *:not(.a4-dialog-overlay) { display: none !important; }
            .a4-dialog-overlay { position: static !important; inset: auto !important; background: transparent !important; padding: 0 !important; display: block !important; }
            .a4-dialog-panel { width: 100% !important; height: auto !important; max-height: none !important; overflow: visible !important; border-radius: 0 !important; box-shadow: none !important; }
            .a4-dialog-header, .a4-dialog-footer { display: none !important; }
            .a4-dialog-body { overflow: visible !important; padding: 0 !important; background: #fff !important; }
          }
        `}</style>
        {/* Header */}
        <div className="a4-dialog-header flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg border border-slate-200 px-2 py-1 text-sm text-slate-500 hover:bg-slate-50"
          >
            ✕
          </button>
        </div>

        {/* A4-proportioned scrollable body */}
        <div
          className={`a4-dialog-body min-h-0 flex-1 overflow-y-auto ${flushBody ? "bg-white" : "bg-slate-50/60 p-4"}`}
        >
          {children}
        </div>

        {footer && <div className="a4-dialog-footer border-t border-slate-200 bg-white px-4 py-2">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}
