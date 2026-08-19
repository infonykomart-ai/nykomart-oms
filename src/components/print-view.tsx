"use client";

// 2026-08-12 (round 10): "JITNI FILE BAN RAHI HAI SABKI PDF FILE UNKE SAME
// DOWNLOAD KARNE KA OPTION HONA CHAHIYE JESE PO KA INVOICE BAN GAYA" —
// the existing PO Invoice "PDF download" is really just window.print() on
// a normal page with @media print CSS hiding everything outside one
// #id'd area (see src/app/dashboard/invoices/[id]/invoice-view.tsx). That
// pattern was copy-pasted into 4+ other pages already; this pulls it into
// one shared pair of components so every new printable view (Purchase
// Bill, Courier Bill, Duty & Tax Bill, the 2 new reports, Party Ledger)
// uses it the same way instead of re-copying the CSS block again.
//
// 2026-08-19 fix (part 1) — "ladger download karte hai to sirf single page
// hi download kyu hota hai": `position: fixed; inset: 0` pinned the
// printable area to the browser's on-screen viewport, which in print/PDF
// output clips it to a single page. Chrome's print engine only paginates
// content that flows in normal document position; `fixed`/`absolute`
// positioning both opt an element OUT of that flow and pin it to one page.
// Switched to plain `static` positioning.
//
// 2026-08-19 fix (part 2) — this alone turned out NOT to be enough: the
// user re-reported the exact same single-page symptom after this first
// fix was live. Root cause #2: `src/app/dashboard/layout.tsx`'s shell
// pins the WHOLE dashboard to the viewport height and clips overflow —
// `h-screen overflow-hidden` on the outer flex row, another
// `overflow-hidden` on the middle column, and `overflow-y-auto` on
// `<main>` (the "LEFT WINDOW AND TOP DESBORD LOCK KARO" fix from
// 2026-08-08, so the sidebar/header stay put while only `<main>`
// scrolls). Every printable page's content lives inside that `<main>`,
// so even with the printable area itself back in normal `static` flow,
// its scrollable/height-clamped ANCESTOR was still capping it to one
// viewport-height "page" — the print area's own CSS can't undo a
// constraint set by an element further up the tree. Confirmed with a
// Playwright print-to-PDF test reproducing the real shell structure:
// position:static alone still produced 1 page with content cut off;
// adding the rule below (neutralizing height/overflow on the shell's own
// utility classes, print-only) produced all 5 pages with every row
// present. Targets the exact Tailwind classes the shell uses
// (`h-screen`, `overflow-hidden`, `overflow-y-auto`) rather than walking
// the DOM, since this stylesheet has no way to reference the layout
// component directly — safe to do broadly here because everything except
// the printable area is already `visibility: hidden` above, so relaxing
// height/overflow on hidden ancestors has no visible effect except
// letting the real printable content's true height be measured and
// paginated correctly.
export function PrintArea({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <>
      <style>{`
        @media print {
          html, body { height: auto !important; overflow: visible !important; }
          .h-screen, .overflow-hidden, .overflow-y-auto {
            height: auto !important;
            max-height: none !important;
            overflow: visible !important;
          }
          body * { visibility: hidden; }
          #${id}, #${id} * { visibility: visible; }
          #${id} { position: static; width: 100%; }
        }
      `}</style>
      <div id={id}>{children}</div>
    </>
  );
}

export function PrintButton({ label = "🖨 Download PDF" }: { label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="print:hidden rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700"
    >
      {label}
    </button>
  );
}
