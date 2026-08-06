import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { InvoiceView } from "./invoice-view";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const employee = await requireCapability("invoicing");
  const { id } = await params;
  const supabase = await createClient();

  const { data: invoice } = await supabase.from("sales_invoices").select("*").eq("id", id).single();
  if (!invoice || !employee.companyIds.includes(invoice.company_id)) notFound();

  const [{ data: orders }, { data: company }, { data: profile }, { data: store }, { data: itemCategories }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, ref_no, sku_label, size_label, qty, item_category_id, order_value_original, order_currency, order_value_usd, colour")
      .eq("invoice_id", id),
    supabase.from("companies").select("id, name, logo_url").eq("id", invoice.company_id).single(),
    supabase.from("company_profiles").select("*").eq("company_id", invoice.company_id).single(),
    supabase.from("stores").select("id, name").eq("id", invoice.store_id).single(),
    supabase.from("item_categories").select("id, name, hsn_code"),
  ]);

  const categoryMap = new Map((itemCategories ?? []).map((c) => [c.id, c]));
  const items = (orders ?? []).map((o) => ({
    ...o,
    item_category_name: categoryMap.get(o.item_category_id)?.name ?? "",
    hsn_code: categoryMap.get(o.item_category_id)?.hsn_code ?? "",
  }));

  return (
    <InvoiceView
      invoice={invoice}
      items={items}
      company={company ?? null}
      profile={profile ?? null}
      storeName={store?.name ?? ""}
    />
  );
}
