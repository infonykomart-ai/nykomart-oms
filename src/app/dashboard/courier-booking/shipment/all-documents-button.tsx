"use client";

// Small client component — the parent Shipment Detail page is a Server
// Component and can't hold an onClick handler itself.
export function AllDocumentsButton({ labelUrl, invoiceId }: { labelUrl: string; invoiceId: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        window.open(labelUrl, "_blank");
        window.open(`/dashboard/invoices/${invoiceId}`, "_blank");
      }}
      className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
    >
      📑 All Documents
    </button>
  );
}
