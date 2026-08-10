import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { BulkStockUploadForm } from "./bulk-stock-upload-form";

export default async function StockBulkUploadPage() {
  await requireCapability("stock_entry");

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">📤 Bulk Stock Upload (CSV/Excel)</h1>
          <p className="mt-1 text-sm text-slate-500">
            Download the template, fill one row per movement, then upload it here — Stock In and Stock Out are
            separate ledgers, pick the right tab below.
          </p>
        </div>
        <Link
          href="/dashboard/stock"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          ← Back to Stock
        </Link>
      </div>

      <BulkStockUploadForm />
    </div>
  );
}
