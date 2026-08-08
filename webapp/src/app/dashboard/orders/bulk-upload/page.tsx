import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { BULK_ORDER_COLUMNS } from "./columns";
import { BulkOrderUploadForm } from "./bulk-order-upload-form";

// Bulk Order Entry via CSV/Excel (2026-08-08, pending item 7 — "Bulk order
// entry — CSV se ek sath bahut sare orders enter kar sake"). Runs every row
// through the EXACT same business logic as the normal /dashboard/orders/new
// form (see createOrderCore() in ../new/actions.ts) — same PO/RF/RG
// reservation, same buyer-batch suffixing, same currency conversion —
// nothing is skipped or approximated for the bulk path.
export default async function BulkOrderUploadPage() {
  const employee = await requireCapability("order_entry");
  const supabase = await createClient();

  const [{ data: stores }, { data: itemCategories }] = await Promise.all([
    supabase.from("stores").select("name").eq("company_id", employee.currentCompanyId).order("name"),
    supabase.from("item_categories").select("name").order("name"),
  ]);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">📤 Bulk Order Entry (CSV/Excel)</h1>
          <p className="mt-1 text-sm text-slate-500">
            Download the template, fill one row per item, then upload it here. Each row is saved exactly like a normal
            order entry — PO/RF/RG numbers, buyer-batching, and currency conversion all work the same way.
          </p>
        </div>
        <Link
          href="/dashboard/orders"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          ← Back to Orders
        </Link>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-1 text-xs font-semibold text-slate-500">Valid Store names (type exactly)</p>
          <p className="text-sm text-slate-700">{(stores ?? []).map((s) => s.name).join(", ") || "—"}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="mb-1 text-xs font-semibold text-slate-500">Valid Item Category names (type exactly)</p>
          <p className="text-sm text-slate-700">{(itemCategories ?? []).map((c) => c.name).join(", ") || "—"}</p>
        </div>
      </div>

      <BulkOrderUploadForm columns={BULK_ORDER_COLUMNS} />
    </div>
  );
}
