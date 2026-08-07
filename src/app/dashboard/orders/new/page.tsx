import Link from "next/link";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { OrderForm } from "./order-form";
import { OrderWhatsAppButton } from "./order-whatsapp-button";

export default async function NewOrderPage() {
  const employee = await requireCapability("order_entry");
  const supabase = await createClient();

  const [{ data: stores }, { data: itemCategories }, { data: sizes }, { data: currencies }, { data: recentOrders }] =
    await Promise.all([
      supabase.from("stores").select("id, name").eq("company_id", employee.currentCompanyId).eq("active", true).order("name"),
      supabase.from("item_categories").select("id, name").order("name"),
      supabase.from("sizes").select("id, label").order("label"),
      supabase.from("currencies").select("code, name").order("code"),
      supabase
        .from("orders")
        .select(
          "id, ref_no, order_date, buyer_name_address, contact_no, photo_url, qty, size_label, item_category_id, order_value_original, order_currency, status, whatsapp_sent_at"
        )
        .eq("company_id", employee.currentCompanyId)
        .order("entry_timestamp", { ascending: false })
        .limit(10),
    ]);

  const categoryName = new Map((itemCategories ?? []).map((c) => [c.id, c.name]));

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Order Entry</h1>
          <p className="mt-1 text-sm text-slate-500">
            PO/RF/RG number automatic hai — save karte hi assign hoga. Duplicate-dispatched-order aur
            buyer-batch grouping bhi automatic check hote hain. Ek se zyada item ho to &quot;+ Add More Item&quot; use karo.
          </p>
        </div>
        <Link
          href="/dashboard/orders"
          className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          📋 Saare Orders (Edit/Delete)
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <OrderForm
            stores={stores ?? []}
            itemCategories={itemCategories ?? []}
            sizes={sizes ?? []}
            currencies={currencies ?? []}
          />
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Aaj ki recent entries</h2>
          <div className="space-y-2">
            {(recentOrders ?? []).map((o) => (
              <div
                key={o.id}
                className={`rounded-lg border p-3 text-sm ${
                  o.whatsapp_sent_at ? "border-green-200 bg-green-50" : "border-slate-200 bg-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">{o.ref_no}</span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{o.status}</span>
                </div>
                <p className="mt-1 truncate text-slate-500">{o.buyer_name_address || "—"}</p>
                <p className="mt-1 text-xs text-slate-400">
                  Qty {o.qty} · {o.order_value_original} {o.order_currency}
                </p>
                <div className="mt-2 border-t border-slate-100 pt-2">
                  <OrderWhatsAppButton
                    order={{
                      id: o.id,
                      ref_no: o.ref_no,
                      buyer_name_address: o.buyer_name_address,
                      contact_no: o.contact_no,
                      photo_url: o.photo_url,
                      item_category_name: categoryName.get(o.item_category_id) ?? null,
                      size_label: o.size_label,
                      qty: o.qty,
                      order_value_original: o.order_value_original,
                      order_currency: o.order_currency,
                      whatsapp_sent_at: o.whatsapp_sent_at,
                    }}
                  />
                </div>
              </div>
            ))}
            {(recentOrders ?? []).length === 0 && (
              <p className="text-sm text-slate-400">Abhi tak koi order entry nahi hui.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
