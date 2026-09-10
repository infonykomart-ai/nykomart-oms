"use client";

import { openLabelUrl } from "@/lib/couriers/open-label-url";

// Small client component — the parent Shipment Detail page is a Server
// Component and can't hold an onClick handler itself.
export function AllDocumentsButton({ labelUrl, invoiceId }: { labelUrl: string; invoiceId: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        // 2026-09-10: was a bare window.open(labelUrl, "_blank") — see
        // open-label-url.ts's header comment for why that silently shows
        // raw PDF bytes as text instead of the PDF for a data: URI label.
        openLabelUrl(labelUrl);
        window.open(`/dashboard/invoices/${invoiceId}`, "_blank");
      }}
      className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
    >
      📑 All Documents
    </button>
  );
}
