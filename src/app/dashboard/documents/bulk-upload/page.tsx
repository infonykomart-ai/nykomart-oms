import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { BulkUploadTabs } from "./bulk-upload-tabs";

// Document Entry bulk-CSV upload (2026-08-08) — same "all of them, one
// after another" round as the Ad Spend store-scoping + sidebar/header lock
// work. Covers all 6 Document Entry types (Credit Note, Debit Note,
// Washing Entry, Purchase Bill, Courier Bill, Duty & Tax Bill) — the user
// confirmed "Shipping Bill" = Courier Bill + Duty & Tax Bill, so no 7th
// type is needed. Each tab in BulkUploadTabs reuses the exact same
// saveXCore() logic as the single-entry forms on /dashboard/documents
// (see ../actions.ts) — nothing is approximated for the bulk path.
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
