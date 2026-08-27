import { notFound } from "next/navigation";
import Link from "next/link";
import { getAuthedEmployee } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { OrderPrintSheet } from "../[id]/order-view";
import { PrintArea, PrintButton } from "@/components/print-view";

// 2026-08-26 — "ORDER SHEET JO BANI HAI USME EK SECTION VIEW KA OPTION HAI
// LEKIN PO SELECT KA OPTION NAHI HAI KISI PO KA JO EK SE JYADA SELECT KAR
// KE DENA HO TO AGAR PRINT DE TO KESE DENGE 1/2 2/2 TYPE KE": the Orders
// hub's "View"/"Download" only ever opened ONE order's print sheet
// (/dashboard/orders/[id]). This is the multi-order counterpart — the
// Orders table now has a checkbox column + "Print Selected" button that
// lands here with ?ids=id1,id2,id3 — fetches every selected order in one
// go and stacks their OrderPrintSheet cards one per page (page-break
// between each), with a "Page X of Y" footer on every sheet.
//
// Same auth/company-scoping shape as [id]/page.tsx: getAuthedEmployee()
// (no separate capability gate on read-only viewing), then every fetched
// order is filtered down to ones this employee's companyIds actually
// cover — an id slipped into the query string for a company this person
// can't see is silently dropped rather than erroring the whole batch.
export default async function OrdersPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string }>;
}) {
  const employee = await getAuthedEmployee();
  const sp = await searchParams;
  const requestedIds = (sp.ids ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!requestedIds.length) notFound();

  const supabase = await createClient();
  const { data: orders } = await supabase
    .from("orders")
    .select(
      "id, ref_no, company_id, store_id, order_date, po_date, delivery_date, dispatch_date, status, shipment_status, marketplace_order_no, buyer_name_address, contact_no, email_id, address_type, destination_country, item_category_id, sku_label, size_label, qty, colour, photo_type, photo_url, order_currency, order_value_original, order_value_usd, order_value_inr, exchange_rate_source, invoice_id, vendor_party_id, remark, entry_timestamp"
    )
    .in("id", requestedIds);

  const accessible = (orders ?? []).filter((o) => employee.companyIds.includes(o.company_id));
  if (!accessible.length) notFound();

  // Preserve the order the user selected/checked them in (the ?ids= order),
  // not whatever order Postgres happens to return them in.
  const byId = new Map(accessible.map((o) => [o.id, o]));
  const selected = requestedIds.map((id) => byId.get(id)).filter((o): o is NonNullable<typeof o> => !!o);

  const companyIds = Array.from(new Set(selected.map((o) => o.company_id)));
  const storeIds = Array.from(new Set(selected.map((o) => o.store_id)));
  const categoryIds = Array.from(new Set(selected.map((o) => o.item_category_id)));
  const invoiceIds = Array.from(new Set(selected.filter((o) => o.invoice_id).map((o) => o.invoice_id as string)));
  const vendorIds = Array.from(new Set(selected.filter((o) => o.vendor_party_id).map((o) => o.vendor_party_id as string)));

  const [{ data: companies }, { data: stores }, { data: categories }, { data: invoices }, { data: vendors }] = await Promise.all([
    companyIds.length ? supabase.from("companies").select("id, name, logo_url").in("id", companyIds) : Promise.resolve({ data: [] }),
    storeIds.length ? supabase.from("stores").select("id, name").in("id", storeIds) : Promise.resolve({ data: [] }),
    categoryIds.length
      ? supabase.from("item_categories").select("id, name, hsn_code").in("id", categoryIds)
      : Promise.resolve({ data: [] }),
    invoiceIds.length
      ? supabase
          .from("sales_invoices")
          .select("id, invoice_no, master_invoice_no, invoice_date, csb_type, courier_company")
          .in("id", invoiceIds)
      : Promise.resolve({ data: [] }),
    vendorIds.length ? supabase.from("parties").select("id, name").in("id", vendorIds) : Promise.resolve({ data: [] }),
  ]);

  const companyById = new Map((companies ?? []).map((c) => [c.id, c]));
  const storeById = new Map((stores ?? []).map((s) => [s.id, s]));
  const categoryById = new Map((categories ?? []).map((c) => [c.id, c]));
  const invoiceById = new Map((invoices ?? []).map((inv) => [inv.id, inv]));
  const vendorById = new Map((vendors ?? []).map((v) => [v.id, v]));

  const skippedCount = requestedIds.length - selected.length;

  return (
    <div>
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/dashboard/orders" className="text-sm text-slate-500 hover:underline">
          ← Back to Orders
        </Link>
        <div className="text-right">
          <PrintButton label={`🖨 Download PDF (${selected.length} order${selected.length === 1 ? "" : "s"})`} />
          {skippedCount > 0 && (
            <p className="mt-1 text-xs text-amber-600">
              {skippedCount} of the {requestedIds.length} selected order{requestedIds.length === 1 ? "" : "s"} couldn&apos;t be shown
              (not found, or not in a company you have access to).
            </p>
          )}
        </div>
      </div>

      <PrintArea id="orders-print-multi-area">
        <div className="space-y-6 print:space-y-0">
          {selected.map((order, idx) => {
            const company = companyById.get(order.company_id);
            const category = categoryById.get(order.item_category_id);
            const invoice = order.invoice_id ? invoiceById.get(order.invoice_id) ?? null : null;
            const vendor = order.vendor_party_id ? vendorById.get(order.vendor_party_id) : null;
            return (
              <OrderPrintSheet
                key={order.id}
                order={order}
                companyName={company?.name ?? ""}
                companyLogoUrl={company?.logo_url ?? null}
                storeName={storeById.get(order.store_id)?.name ?? ""}
                itemCategoryName={category?.name ?? ""}
                hsnCode={category?.hsn_code ?? ""}
                invoice={invoice}
                vendorName={vendor?.name ?? null}
                pageLabel={`Page ${idx + 1} of ${selected.length}`}
                pageBreakAfter={idx < selected.length - 1}
              />
            );
          })}
        </div>
      </PrintArea>
    </div>
  );
}
