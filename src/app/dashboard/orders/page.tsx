import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { OrderListTable } from "./order-list-table";

const STATUSES = ["Pending", "Confirmed", "In Production", "Dispatched", "Delivered", "Cancelled", "Returned"];

// Orders hub (2026-08-07) — "order panal me order ko edit modify delet
// karne ka option" + WhatsApp-sent visual status. This is the list/search/
// edit/delete panel; fast day-to-day entry stays at /dashboard/orders/new
// (linked from here, and linking back).
export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("order_entry");
  const supabase = await createClient();
  const sp = await searchParams;

  const companyId = typeof sp.company === "string" && sp.company ? sp.company : "";
  const status = typeof sp.status === "string" && sp.status ? sp.status : "";
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const fromDate = typeof sp.from === "string" ? sp.from : "";
  const toDate = typeof sp.to === "string" ? sp.to : "";

  const [{ data: companies }, { data: itemCategories }, { data: sizes }, { data: currencies }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("item_categories").select("id, name").order("name"),
    supabase.from("sizes").select("id, label").order("label"),
    supabase.from("currencies").select("code, name").order("code"),
  ]);

  let query = supabase
    .from("orders")
    .select(
      "id, ref_no, order_date, company_id, status, dispatch_date, marketplace_order_no, buyer_name_address, contact_no, email_id, tax_id, address_type, po_date, delivery_date, photo_url, sku_label, size_label, qty, item_category_id, order_value_original, order_currency, colour, photo_type, tassel_fringes, remark, whatsapp_sent_at, invoice_id, entry_timestamp"
    )
    .in("company_id", companyId ? [companyId] : employee.companyIds)
    .order("entry_timestamp", { ascending: false })
    .limit(300);

  if (status) query = query.eq("status", status as never);
  if (fromDate) query = query.gte("order_date", fromDate);
  if (toDate) query = query.lte("order_date", toDate);
  if (q) query = query.or(`ref_no.ilike.%${q}%,buyer_name_address.ilike.%${q}%,contact_no.ilike.%${q}%`);

  const { data: orders } = await query;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">📋 Orders — Edit / Modify / Delete</h1>
          <p className="mt-1 text-sm text-slate-500">
            Orders already sent on WhatsApp are shown in green. The PO/RF/RG number cannot be edited (it&apos;s tied to batch/suffix logic) — everything else is editable.
          </p>
        </div>
        <Link
          href="/dashboard/orders/new"
          className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600"
        >
          + New Order
        </Link>
      </div>

      <form method="get" className="mb-4 flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="q">Search (Ref/Buyer/Contact)</label>
          <input id="q" name="q" defaultValue={q} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="from">From</label>
          <input id="from" name="from" type="date" defaultValue={fromDate} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="to">To</label>
          <input id="to" name="to" type="date" defaultValue={toDate} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="company">Company</label>
          <select id="company" name="company" defaultValue={companyId} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500">
            <option value="">All</option>
            {(companies ?? []).map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500" htmlFor="status">Status</label>
          <select id="status" name="status" defaultValue={status} className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-amber-500">
            <option value="">All</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <button type="submit" className="rounded-lg bg-slate-800 px-4 py-1.5 text-sm font-semibold text-white hover:bg-slate-700">
          Filter
        </button>
        <a href="/dashboard/orders" className="text-xs text-slate-400 underline">Clear</a>
      </form>

      <OrderListTable
        orders={orders ?? []}
        itemCategories={itemCategories ?? []}
        sizes={sizes ?? []}
        currencies={currencies ?? []}
        statuses={STATUSES}
      />
    </div>
  );
}
