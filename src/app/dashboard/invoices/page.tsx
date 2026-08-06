import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { InvoiceBatchList } from "./invoice-batch-list";

// Invoice Generation module (2026-08-06) — see
// claude/invoice-origin-declarations-and-numbering.md for the full spec
// this implements. Lists dispatched-but-not-yet-invoiced orders grouped
// into buyer-batches (same company + store + ref_no_base — mirrors the
// existing Order Entry buyer-batch concept), each generatable into one
// sales invoice; plus a list of already-generated invoices.
export default async function InvoicesPage() {
  const employee = await requireCapability("invoicing");
  const supabase = await createClient();

  const [{ data: pendingOrders }, { data: invoices }, { data: companies }, { data: stores }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        "id, ref_no, ref_no_base, order_date, company_id, store_id, buyer_name_address, contact_no, item_category_id, size_label, qty, order_value_original, order_currency, status, dispatch_date"
      )
      .in("company_id", employee.companyIds)
      .in("status", ["Dispatched", "Delivered"])
      .is("invoice_id", null)
      .order("ref_no_base", { ascending: false })
      .limit(500),
    supabase
      .from("sales_invoices")
      .select("id, invoice_no, master_invoice_no, invoice_date, company_id, store_id, buyer_name_address, courier_company, csb_type")
      .in("company_id", employee.companyIds)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("companies").select("id, name").in("id", employee.companyIds),
    supabase.from("stores").select("id, name, company_id, invoice_ref_prefix"),
  ]);

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const storeName = new Map((stores ?? []).map((s) => [s.id, s.name]));

  // Group pending orders into buyer-batches: same company + store +
  // ref_no_base — exactly the unit one invoice can cover (see actions.ts's
  // "sabhi selected orders ek hi company aur store ke hone chahiye" check).
  const batchMap = new Map<string, typeof pendingOrders>();
  for (const o of pendingOrders ?? []) {
    const key = `${o.company_id}|${o.store_id}|${o.ref_no_base}`;
    if (!batchMap.has(key)) batchMap.set(key, []);
    batchMap.get(key)!.push(o);
  }
  const batches = Array.from(batchMap.entries()).map(([key, orders]) => ({ key, orders: orders! }));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-900">🧾 Invoices</h1>
        <p className="mt-1 text-sm text-slate-500">
          Dispatched/Delivered orders jo abhi tak invoice nahi hue — buyer-batch wise group kiye gaye hain. Ek batch select
          karke invoice generate karo.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Invoice banane ke liye ready ({batches.length} batches)</h2>
          <InvoiceBatchList
            batches={batches.map((b) => ({
              key: b.key,
              companyName: companyName.get(b.orders[0].company_id) ?? "",
              storeName: storeName.get(b.orders[0].store_id) ?? "",
              orders: b.orders,
            }))}
          />
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Recent Invoices</h2>
          <div className="space-y-2">
            {(invoices ?? []).map((inv) => (
              <Link
                key={inv.id}
                href={`/dashboard/invoices/${inv.id}`}
                className="block rounded-lg border border-slate-200 bg-white p-3 text-sm transition hover:border-amber-300"
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">{inv.invoice_no}</span>
                  <span className="text-xs text-slate-400">{inv.invoice_date}</span>
                </div>
                <p className="mt-1 truncate text-slate-500">{inv.buyer_name_address}</p>
                <p className="mt-1 text-xs text-slate-400">
                  {companyName.get(inv.company_id)} · {storeName.get(inv.store_id)} · {inv.csb_type} · {inv.courier_company}
                </p>
                <p className="mt-1 text-xs text-slate-400">Master No.: {inv.master_invoice_no}</p>
              </Link>
            ))}
            {(invoices ?? []).length === 0 && <p className="text-sm text-slate-400">Abhi tak koi invoice nahi bana.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
