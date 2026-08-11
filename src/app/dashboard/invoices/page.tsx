import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { InvoicePoSelector } from "./invoice-po-selector";
import { RecentInvoicesList } from "./recent-invoices-list";

// Invoice Generation module (2026-08-06) — see
// claude/invoice-origin-declarations-and-numbering.md for the full spec
// this implements. Lists orders grouped into buyer-batches (same company +
// store + ref_no_base — mirrors the existing Order Entry buyer-batch
// concept) as a searchable PO/RF/RG selector; picking one shows its order
// detail + a generate-invoice form (or, if already invoiced, a link
// straight to the existing invoice); plus a list of already-generated
// invoices.
//
// 2026-08-11: "po vagera select karne ka option aana chiahiye ... po
// number rf number rg number select ka option ho kis kis ka bana hai
// invoice" — this now fetches EVERY batch (not just un-invoiced ones, the
// old `.is("invoice_id", null)` filter is gone) so the selector can show a
// status badge per PO/RF/RG. See invoice-po-selector.tsx for how
// invoiced/partial/pending is derived and rendered.
export default async function InvoicesPage() {
  const employee = await requireCapability("invoicing");
  const supabase = await createClient();

  const [{ data: allOrders }, { data: invoices }, { data: companies }, { data: stores }, { data: itemCategories }] =
    await Promise.all([
      // 2026-08-08: "SABHI ORDER LIST INVOICE VALE SECTION ME DIKHE NAYE
      // PURANE" — used to only list orders already Dispatched/Delivered,
      // forcing a manual "edit status first, then come invoice" two-step.
      // Now every order shows here regardless of status (Pending/Confirmed/
      // In Production included) or invoice status — pick any batch and
      // generate; generateInvoice() below auto-marks Dispatched on submit,
      // so there's no separate status-edit step anymore.
      //
      // Limit raised 500 -> 800 now that invoiced orders are included too
      // (they used to be filtered out entirely) — ordered newest-batch-
      // first, so active/recent POs stay within the window even as
      // invoiced history accumulates. The selector's search box keeps a
      // longer list usable; if this ever needs to look further back than
      // the limit reaches, that's a sign to add a date-range filter here.
      supabase
        .from("orders")
        .select(
          "id, ref_no, ref_no_base, order_date, company_id, store_id, buyer_name_address, contact_no, sku_label, item_category_id, size_label, qty, order_value_original, order_currency, status, dispatch_date, invoice_id"
        )
        .in("company_id", employee.companyIds)
        // Pending item 2 (2026-08-08): a Hold order is fully blocked from
        // further action, and a Cancelled order should never be dispatched/
        // invoiced — both excluded here even though every other status is
        // intentionally left invoiceable (see the 2026-08-08 comment above).
        .not("status", "in", "(Hold,Cancelled)")
        .order("ref_no_base", { ascending: false })
        .limit(800),
      supabase
        .from("sales_invoices")
        .select("id, invoice_no, master_invoice_no, invoice_date, company_id, store_id, buyer_name_address, courier_company, csb_type")
        .in("company_id", employee.companyIds)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase.from("companies").select("id, name").in("id", employee.companyIds),
      supabase.from("stores").select("id, name, company_id, invoice_ref_prefix"),
      supabase.from("item_categories").select("id, name"),
    ]);

  const companyName = new Map((companies ?? []).map((c) => [c.id, c.name]));
  const storeName = new Map((stores ?? []).map((s) => [s.id, s.name]));
  const itemCategoryName = Object.fromEntries((itemCategories ?? []).map((c) => [c.id, c.name]));

  // Group orders into buyer-batches: same company + store + ref_no_base —
  // exactly the unit one invoice can cover (see actions.ts's "sabhi
  // selected orders ek hi company aur store ke hone chahiye" check).
  const batchMap = new Map<string, typeof allOrders>();
  for (const o of allOrders ?? []) {
    const key = `${o.company_id}|${o.store_id}|${o.ref_no_base}`;
    if (!batchMap.has(key)) batchMap.set(key, []);
    batchMap.get(key)!.push(o);
  }
  const batches = Array.from(batchMap.entries()).map(([key, orders]) => ({ key, orders: orders! }));

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">🧾 Invoices</h1>
          <p className="mt-1 text-sm text-slate-500">
            Orders grouped by PO/RF/RG number (buyer-batch). Search and select one to see its order detail and
            generate an invoice — already-invoiced ones link straight to that invoice.
          </p>
        </div>
        <Link
          href="/dashboard/invoices/bulk-upload"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          📤 Bulk Upload (CSV)
        </Link>
      </div>

      <div className="mb-8">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">PO / RF / RG Number ({batches.length} total)</h2>
        <InvoicePoSelector
          batches={batches.map((b) => ({
            key: b.key,
            companyName: companyName.get(b.orders[0].company_id) ?? "",
            storeName: storeName.get(b.orders[0].store_id) ?? "",
            orders: b.orders,
          }))}
          itemCategoryName={itemCategoryName}
        />
      </div>

      <div>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Recent Invoices</h2>
        <RecentInvoicesList
          invoices={(invoices ?? []).map((inv) => ({
            ...inv,
            companyLabel: companyName.get(inv.company_id) ?? "",
            storeLabel: storeName.get(inv.store_id) ?? "",
          }))}
        />
      </div>
    </div>
  );
}
