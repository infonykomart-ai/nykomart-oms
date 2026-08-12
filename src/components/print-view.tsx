"use client";

// 2026-08-12 (round 10): "JITNI FILE BAN RAHI HAI SABKI PDF FILE UNKE SAME
// DOWNLOAD KARNE KA OPTION HONA CHAHIYE JESE PO KA INVOICE BAN GAYA" —
// the existing PO Invoice "PDF download" is really just window.print() on
// a normal page with @media print CSS hiding everything outside one
// #id'd area (see src/app/dashboard/invoices/[id]/invoice-view.tsx). That
// pattern was copy-pasted into 4+ other pages already; this pulls it into
// one shared pair of components so every new printable view (Purchase
// Bill, Courier Bill, Duty & Tax Bill, the 2 new reports) uses it the same
// way instead of re-copying the CSS block again.
export function PrintArea({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #${id}, #${id} * { visibility: visible; }
          #${id} { position: fixed; inset: 0; width: 100%; }
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
