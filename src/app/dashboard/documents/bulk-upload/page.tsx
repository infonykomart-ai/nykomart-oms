import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { BulkUploadTabs } from "./bulk-upload-tabs";

// Document Entry bulk-CSV upload (2026-08-08) — same "all of them, one
// after another" round as the Ad Spend store-scoping + sidebar/header lock
// work. Covers all Document Entry types (Credit Note, Debit Note,
// Washing Entry, Purchase Bill, Courier Bill, Duty & Tax Bill) — the user
// confirmed "Shipping Bill" = Courier Bill + Duty & Tax Bill, so no 7th
// type is needed. Each tab in BulkUploadTabs reuses the exact same
// saveXCore() logic as the single-entry forms on /dashboard/documents
// (see ../actions.ts) — nothing is approximated for the bulk path.
// 2026-08-14: CSB Filing (csb_filings — customs CSB-V filing confirmation
// register) added as a 7th tab, same pattern.
// 2026-08-27: Refund added as an 8th tab — "jese order ki sheet bani hai
// vesi har section ki sheet banegi ... refund and any other all" — the one
// gap left once Orders (orders/bulk-upload) and Invoice generation
// (invoices/bulk-upload) are counted alongside this page's existing 7 doc
// types. Drives the same saveOrderRefundCore the manual Cancel/Return
// refund screen uses (orders/actions.ts).
export default async function DocumentsBulkUploadPage() {
  await requireCapability("doc_entry");

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">📤 Bulk Document Upload (CSV/Excel)</h1>
          <p className="mt-1 text-sm text-slate-500">
            Download the template for the document type you need, fill one row per document, then upload it here.
            Each row is saved exactly like entering it by hand on the Document Entry screen.
          </p>
        </div>
        <Link
          href="/dashboard/documents"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          ← Back to Document Entry
        </Link>
      </div>

      <BulkUploadTabs />
    </div>
  );
}
