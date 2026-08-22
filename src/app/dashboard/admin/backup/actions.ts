"use server";

import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";

// Backup Export (2026-08-22) — admin-only, all-companies data export. See
// db/2026-08-22-backup-export-admin.sql for the capability grant and full
// rationale. Deliberately NOT scoped to employee.currentCompanyId/
// companyIds like every other report in this app (Invoices, Ad Spend,
// Party Ledger, ...) — this is a whole-business backup dump, gated on its
// own narrow capability instead (Admin/MD only).
//
// One row per order, joined with:
//  - sales_invoices (the GENERATED export invoice — CSB-V/CSB-IV — via
//    orders.invoice_id, same relationship the Invoices module itself
//    uses) for invoice_no/master_invoice_no/csb_type/etc.
//  - dispatch_invoices (the old "Dispatch & Invoice" sheet — 1 row per
//    order via dispatch_invoices.order_id) for the per-order financial/
//    shipment invoice fields (AWB, buyer country, sale/invoice amounts,
//    delivered status).
//
// Plain separate queries + client-side Map joins, not embedded-resource
// selects — same reason as every other page here (see
// require-capability.ts's own comment): the hand-rolled Database type
// doesn't carry full Relationships metadata for every join shape.
export type BackupExportRow = {
  companyName: string;
  storeName: string;
  refNo: string;
  orderDate: string;
  status: string;
  dispatchDate: string | null;
  marketplaceOrderNo: string | null;
  itemCategory: string;
  skuLabel: string | null;
  sizeLabel: string | null;
  qty: number;
  buyerNameAddress: string | null;
  contactNo: string | null;
  emailId: string | null;
  orderCurrency: string;
  orderValueOriginal: number;
  orderValueUsd: number | null;
  orderValueInr: number | null;
  // Generated sales invoice (orders.invoice_id -> sales_invoices)
  invInvoiceNo: string | null;
  invMasterInvoiceNo: string | null;
  invInvoiceDate: string | null;
  invCsbType: string | null;
  invCourierCompany: string | null;
  invDestinationCountry: string | null;
  invInvoiceValueUsd: number | null;
  invTaxableValueInr: number | null;
  // Dispatch & Invoice (dispatch_invoices, 1:1 via order_id)
  diInvoiceNo: string | null;
  diInvoiceDate: string | null;
  diAwbNo: string | null;
  diBuyerCountry: string | null;
  diCourierName: string | null;
  diOrgSaleAmtUsd: number | null;
  diOrgSaleAmtInr: number | null;
  diInvoiceAmtUsd: number | null;
  diInvoiceAmtInr: number | null;
  diTotalAmt: number | null;
  diDeliveredStatus: string | null;
  diDeliveredDate: string | null;
};

const PAGE_SIZE = 1000;

// Supabase/PostgREST caps a single response at its configured max rows
// (1000 by default, and this project never overrides db.max_rows — see
// every other list page here just using a flat .limit()). A whole-business
// export can easily exceed that, so page through with .range() until a
// page comes back short.
async function fetchAllPages<T>(
  run: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const out: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await run(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : "Query failed");
    const page = data ?? [];
    out.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return out;
}

export async function getBackupExportRows(): Promise<BackupExportRow[]> {
  await requireCapability("data_export_admin");
  const supabase = createServiceRoleClient();

  const [orders, dispatchInvoices, salesInvoices, companies, stores, itemCategories] = await Promise.all([
    fetchAllPages((from, to) =>
      supabase
        .from("orders")
        .select(
          "id, company_id, store_id, ref_no, order_date, status, dispatch_date, marketplace_order_no, item_category_id, sku_label, size_label, qty, buyer_name_address, contact_no, email_id, order_currency, order_value_original, order_value_usd, order_value_inr, invoice_id"
        )
        .order("order_date", { ascending: false })
        .range(from, to)
    ),
    fetchAllPages((from, to) =>
      supabase
        .from("dispatch_invoices")
        .select(
          "order_id, invoice_no, invoice_date, awb_no, buyer_country, courier_name, org_sale_amt_usd, org_sale_amt_inr, invoice_amt_usd, invoice_amt_inr, total_amt, delivered_status, delivered_date"
        )
        .range(from, to)
    ),
    fetchAllPages((from, to) =>
      supabase
        .from("sales_invoices")
        .select("id, invoice_no, master_invoice_no, invoice_date, csb_type, courier_company, destination_country, invoice_value_usd, taxable_value_inr")
        .range(from, to)
    ),
    supabase.from("companies").select("id, name"),
    supabase.from("stores").select("id, name"),
    supabase.from("item_categories").select("id, name"),
  ]);

  const companyName = new Map((companies.data ?? []).map((c) => [c.id, c.name]));
  const storeName = new Map((stores.data ?? []).map((s) => [s.id, s.name]));
  const itemCategoryName = new Map((itemCategories.data ?? []).map((c) => [c.id, c.name]));
  const dispatchByOrder = new Map(dispatchInvoices.map((d) => [d.order_id, d]));
  const invoiceById = new Map(salesInvoices.map((i) => [i.id, i]));

  return orders.map((o): BackupExportRow => {
    const di = dispatchByOrder.get(o.id);
    const inv = o.invoice_id ? invoiceById.get(o.invoice_id) : undefined;
    return {
      companyName: companyName.get(o.company_id) ?? "",
      storeName: storeName.get(o.store_id) ?? "",
      refNo: o.ref_no,
      orderDate: o.order_date,
      status: o.status,
      dispatchDate: o.dispatch_date,
      marketplaceOrderNo: o.marketplace_order_no,
      itemCategory: itemCategoryName.get(o.item_category_id) ?? "",
      skuLabel: o.sku_label,
      sizeLabel: o.size_label,
      qty: o.qty,
      buyerNameAddress: o.buyer_name_address,
      contactNo: o.contact_no,
      emailId: o.email_id,
      orderCurrency: o.order_currency,
      orderValueOriginal: o.order_value_original,
      orderValueUsd: o.order_value_usd,
      orderValueInr: o.order_value_inr,
      invInvoiceNo: inv?.invoice_no ?? null,
      invMasterInvoiceNo: inv?.master_invoice_no ?? null,
      invInvoiceDate: inv?.invoice_date ?? null,
      invCsbType: inv?.csb_type ?? null,
      invCourierCompany: inv?.courier_company ?? null,
      invDestinationCountry: inv?.destination_country ?? null,
      invInvoiceValueUsd: inv?.invoice_value_usd ?? null,
      invTaxableValueInr: inv?.taxable_value_inr ?? null,
      diInvoiceNo: di?.invoice_no ?? null,
      diInvoiceDate: di?.invoice_date ?? null,
      diAwbNo: di?.awb_no ?? null,
      diBuyerCountry: di?.buyer_country ?? null,
      diCourierName: di?.courier_name ?? null,
      diOrgSaleAmtUsd: di?.org_sale_amt_usd ?? null,
      diOrgSaleAmtInr: di?.org_sale_amt_inr ?? null,
      diInvoiceAmtUsd: di?.invoice_amt_usd ?? null,
      diInvoiceAmtInr: di?.invoice_amt_inr ?? null,
      diTotalAmt: di?.total_amt ?? null,
      diDeliveredStatus: di?.delivered_status ?? null,
      diDeliveredDate: di?.delivered_date ?? null,
    };
  });
}
