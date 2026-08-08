import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { BULK_INVOICE_COLUMNS } from "./columns";
import { BulkInvoiceUploadForm } from "./bulk-invoice-upload-form";

// Bulk Invoice Generation via CSV (2026-08-08 — "INVOICE DATA PADA HAI MERE
// PASS JIS JIS ORDER KA BANEGA TO CSV UPLOD OR TAMPLATE DOWNOLAD KA OPTION
// DO"). Runs every batch through the EXACT same generateInvoiceCore() the
// normal /dashboard/invoices screen uses — same numbering, same auto-
// Dispatch marking, nothing skipped or approximated for the bulk path. See
// ../actions.ts's bulkGenerateInvoices for the row-grouping logic.
export default async function BulkInvoiceUploadPage() {
  await requireCapability("invoicing");

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">📤 Bulk Invoice Generation (CSV/Excel)</h1>
          <p className="mt-1 text-sm text-slate-500">
            Download the template, fill one row per order, then upload it here. Orders sharing the same PO/RF/RG base
            number combine into one invoice — exactly like generating one by hand.
          </p>
        </div>
        <Link
          href="/dashboard/invoices"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          ← Back to Invoices
        </Link>
      </div>

      <BulkInvoiceUploadForm columns={BULK_INVOICE_COLUMNS} />
    </div>
  );
}
