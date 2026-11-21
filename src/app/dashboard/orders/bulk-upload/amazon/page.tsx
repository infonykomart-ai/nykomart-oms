import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { AmazonUploadForm } from "./amazon-upload-form";

// 2026-11-03 — "ye jo book.png hai ... amazon ka order ka data hai to isi
// formate me bulk order sirf amazon ke dalne ka set kar do": a dedicated
// Amazon upload, next to the general CSV template upload, that reads the
// sheet as it is actually kept (Amazon's own report columns, or the
// Order-No "book" layout) instead of forcing every row into this app's
// template columns. Only Amazon stores are offered here, and the county /
// category the sheet doesn't carry are picked once above the file.
export default async function AmazonBulkUploadPage() {
  const employee = await requireCapability("order_entry");
  const supabase = await createClient();

  const [{ data: companies }, { data: stores }, { data: itemCategories }, { data: currencies }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("stores").select("id, name, company_id").in("company_id", employee.companyIds).order("name"),
    supabase.from("item_categories").select("id, name").order("name"),
    supabase.from("currencies").select("code, name").order("code"),
  ]);
  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  // Same "Amazon store" test the rest of the app uses (ad-spend's Amazon
  // country section): the store NAME says Amazon.
  const amazonStores = (stores ?? [])
    .filter((s) => /amazon/i.test(s.name))
    .map((s) => ({ id: s.id, name: s.name, company: companyName.get(s.company_id) ?? "—" }));

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">📦 Amazon Bulk Order Entry</h1>
        </div>
        <Link
          href="/dashboard/orders/bulk-upload"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          ← Bulk Order Entry
        </Link>
      </div>

      {amazonStores.length === 0 && (
        <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          No Amazon store found — a store name must contain &quot;Amazon&quot; (for example &quot;Amazon Rugara&quot;).
        </p>
      )}

      <AmazonUploadForm
        stores={amazonStores}
        categories={itemCategories ?? []}
        currencies={currencies ?? []}
      />
    </div>
  );
}
