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
// 2026-08-19 fix — "ladger download karte hai to sirf single page hi
// download kyu hota hai": `position: fixed; inset: 0` pins the printable
// area to the browser's on-screen viewport, which in print/PDF output
// clips it to a single page — anything past one page's worth of content
// (any Party Ledger with more than ~30-40 rows, or any long Purchase/
// Courier/Duty bill or report) was silently cut off, not just this page.
// Chrome's print engine only paginates content that flows in normal
// document position; `fixed`/`absolute` positioning both opt an element
// OUT of that flow and pin it to one page. Switched to plain `static`
// positioning (the default — just needs `width: 100%` so it still spans
// the full printable width) so the browser's native print pagination
// flows the content across as many pages as it needs, same as printing
// any ordinary multi-page document.
export function PrintArea({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <>
      <style>{`
        @media print {
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
