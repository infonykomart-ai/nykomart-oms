import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { TRACKING_COLUMNS } from "./columns";
import { BulkTrackingUpdateForm } from "./bulk-tracking-update-form";

// Bulk Courier Tracking Update via CSV (2026-08-08, pending item 8).
// Updates EXISTING orders (matched by Ref No.) — see actions.ts's header
// comment for exactly which fields go where. Item 7 (pulling tracking
// automatically from a courier's own API) is still blocked on the user
// telling us which courier(s) + API credentials — this manual path covers
// the need in the meantime, and stays useful as a backfill either way.
export default async function BulkTrackingUpdatePage() {
  await requireCapability("order_entry");

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">🚚 Bulk Courier Tracking Update (CSV/Excel)</h1>
          <p className="mt-1 text-sm text-slate-500">
            Download the template, fill one row per order (matched by Ref No.), then upload it here to update
            Shipment Status, AWB No., Courier Name, and Delivered info in bulk.
          </p>
        </div>
        <Link
          href="/dashboard/orders"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          ← Back to Orders
        </Link>
      </div>

      <BulkTrackingUpdateForm columns={TRACKING_COLUMNS} />
    </div>
  );
}
