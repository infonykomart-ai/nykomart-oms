import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { VENDOR_ASSIGN_COLUMNS } from "./columns";
import { BulkVendorAssignmentForm } from "./bulk-vendor-assignment-form";

// Bulk Vendor Assignment (2026-09-13) — "Vendor Assignment (assign to
// party) me ek sath agar 100-200 po par ek sath party assign karna ho to
// kese kerenge. abhi to ek ek po rf rg ke against me hota hai isko modify
// karo". Same one-party-per-order rules as the order page's assign button
// (see actions.ts's header) — this page just feeds it N Ref Nos at once,
// with a CSV template + per-row results report like Bulk Tracking Update.
export default async function BulkVendorAssignmentPage() {
  await requireCapability("order_entry");
  const supabase = createServiceRoleClient();

  const { data: parties } = await supabase.from("parties").select("id, name, invoice_type, party_type").order("name");

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">👷 Bulk Vendor Assignment (CSV/Excel)</h1>
        </div>
        <Link
          href="/dashboard/orders"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          ← Back to Orders
        </Link>
      </div>

      <BulkVendorAssignmentForm columns={VENDOR_ASSIGN_COLUMNS} parties={parties ?? []} />
    </div>
  );
}
