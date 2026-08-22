import { notFound } from "next/navigation";
import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { OrderView } from "./order-view";

// Order detail / view page (2026-08-22) — until now the Orders hub
// (order-list-table.tsx) had no separate read-only page at all: "Edit"
// swaps the row in place for an inline form, there was never a
// /dashboard/orders/[id] to link someone to or to print/save-as-PDF on its
// own. Mirrors src/app/dashboard/invoices/[id]/page.tsx + invoice-view.tsx
// closely (auth -> fetch -> company-scope check -> hand off to a read-only
// view component with PrintArea/PrintButton), just without the editable
// form panel since this page is view-only — editing still happens back on
// the Orders hub's inline form, unchanged.
//
// Deliberately just getAuthedEmployee() (not requireCapability) — any
// signed-in employee who can already see this order's company (via
// employee.companyIds, same scoping every other page here uses) can view
// its detail/print page; there's no separate capability gate on read-only
// order viewing today (Orders hub itself is gated behind "order_entry" for
// the edit/delete panel, but that's a different concern from "can this
// person see one order's read-only detail").
//
// Out of scope on purpose: this does NOT show multi-package/AWB shipment
// data — that already lives at its own screen, /dashboard/order-packages
// (Order Shipments & Packages), and duplicating it here would just be two
// places to keep in sync.
export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const employee = await getAuthedEmployee();
  const { id } = await params;
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, ref_no, company_id, store_id, order_date, po_date, delivery_date, dispatch_date, status, shipment_status, marketplace_order_no, buyer_name_address, contact_no, email_id, address_type, destination_country, item_category_id, sku_label, size_label, qty, colour, photo_type, photo_url, order_currency, order_value_original, order_value_usd, order_value_inr, exchange_rate_source, invoice_id, vendor_party_id, remark, entry_timestamp"
    )
    .eq("id", id)
    .maybeSingle();

  if (!order || !employee.companyIds.includes(order.company_id)) notFound();

  const [{ data: company }, { data: store }, { data: itemCategory }, { data: invoice }, { data: vendor }] = await Promise.all([
    supabase.from("companies").select("id, name, logo_url").eq("id", order.company_id).single(),
    supabase.from("stores").select("id, name").eq("id", order.store_id).single(),
    supabase.from("item_categories").select("id, name, hsn_code").eq("id", order.item_category_id).single(),
    order.invoice_id
      ? supabase
          .from("sales_invoices")
          .select("id, invoice_no, master_invoice_no, invoice_date, csb_type, courier_company")
          .eq("id", order.invoice_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    order.vendor_party_id
      ? supabase.from("parties").select("id, name").eq("id", order.vendor_party_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return (
    <OrderView
      order={order}
      companyName={company?.name ?? ""}
      companyLogoUrl={company?.logo_url ?? null}
      storeName={store?.name ?? ""}
      itemCategoryName={itemCategory?.name ?? ""}
      hsnCode={itemCategory?.hsn_code ?? ""}
      invoice={invoice ?? null}
      vendorName={vendor?.name ?? null}
    />
  );
}
