"use server";

import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { originDeclarationFor } from "@/lib/invoices/origin-declaration";
import { computeDepartmentReferenceNo, isFedEx } from "@/lib/invoices/department-reference";
import { revalidatePath } from "next/cache";

export type InvoiceFormState = {
  error: string | null;
  success: { invoiceId: string; invoiceNo: string } | null;
};

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}

// Mirrors fy_label() in db/schema.sql exactly (April = start of Indian FY)
// — kept in sync deliberately rather than round-tripping an RPC call for
// something this cheap; see reserve_next_number()'s own RPC call below for
// the part that genuinely needs to be atomic/server-side.
function fyLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00Z");
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth() + 1; // 1-12
  const startYear = month < 4 ? year - 1 : year;
  const endYear = month < 4 ? year : year + 1;
  return `${String(startYear).slice(2)}-${String(endYear).slice(2)}`;
}

function formatInvoiceNo(prefix: string, fy: string, num: number): string {
  return `${prefix}-${fy}-${String(num).padStart(3, "0")}`;
}

/**
 * Generate a sales invoice against one or more `orders` rows (a buyer-
 * batch shipping together) — see claude/invoice-origin-declarations-and-
 * numbering.md for the full spec. Numbering, Department Reference No., and
 * the origin declaration default are all computed HERE at actual save
 * time (never earlier), same "reserve on save, not on render" rule as
 * order-entry's PO/RF/RG numbers.
 */
export async function generateInvoice(_prev: InvoiceFormState, formData: FormData): Promise<InvoiceFormState> {
  const employee = await requireCapability("invoicing");
  const supabase = createServiceRoleClient();

  const orderIds = formData.getAll("order_ids").map(String).filter(Boolean);
  const shipmentTerm = str(formData, "shipment_term");
  const csbType = str(formData, "csb_type");
  const courierCompany = str(formData, "courier_company");
  const destinationCountry = strOrNull(formData, "destination_country");
  const iossNumber = strOrNull(formData, "ioss_number");
  const remark = strOrNull(formData, "remark");
  const buyerNameAddressOverride = strOrNull(formData, "buyer_name_address");
  const invoiceDate = str(formData, "invoice_date") || new Date().toISOString().slice(0, 10);

  if (orderIds.length === 0) return { error: "Kam se kam ek order select karo.", success: null };
  if (!shipmentTerm) return { error: "Shipment Term zaroori hai.", success: null };
  if (csbType !== "CSB-V" && csbType !== "CSB-IV") return { error: "CSB type CSB-V ya CSB-IV honi chahiye.", success: null };
  if (!courierCompany) return { error: "Courier Company zaroori hai.", success: null };

  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, company_id, store_id, buyer_name_address, invoice_id")
    .in("id", orderIds);
  if (ordersError || !orders || orders.length !== orderIds.length) {
    return { error: "Selected orders load nahi ho paaye — dobara try karo.", success: null };
  }
  if (orders.some((o) => o.invoice_id)) {
    return { error: "In me se ek ya zyada order already kisi invoice me use ho chuke hain.", success: null };
  }
  const companyId = orders[0].company_id;
  const storeId = orders[0].store_id;
  if (orders.some((o) => o.company_id !== companyId || o.store_id !== storeId)) {
    return { error: "Sabhi selected orders ek hi company aur store ke hone chahiye.", success: null };
  }
  if (!employee.companyIds.includes(companyId)) {
    return { error: "Is company ke liye aapko access nahi hai.", success: null };
  }

  const [{ data: store }, { data: company }] = await Promise.all([
    supabase.from("stores").select("id, invoice_ref_prefix").eq("id", storeId).single(),
    supabase.from("companies").select("id, master_invoice_prefix").eq("id", companyId).single(),
  ]);
  if (!store?.invoice_ref_prefix) {
    return { error: "Is store ka invoice prefix set nahi hai — Admin se set karvao (Company & Items).", success: null };
  }
  if (!company?.master_invoice_prefix) {
    return { error: "Is company ka master invoice prefix set nahi hai — Admin se set karvao.", success: null };
  }

  const fy = fyLabel(invoiceDate);

  const { data: num, error: numError } = await supabase.rpc("reserve_next_number", {
    p_company_id: companyId,
    p_scope: `INVOICE_${store.invoice_ref_prefix}`,
    p_use_fy: true,
    p_as_of_date: invoiceDate,
  });
  if (numError || num == null) return { error: "Invoice number reserve nahi ho paaya — dobara try karo.", success: null };

  const { data: mnum, error: mnumError } = await supabase.rpc("reserve_next_number", {
    p_company_id: companyId,
    p_scope: "MASTER_INVOICE",
    p_use_fy: true,
    p_as_of_date: invoiceDate,
  });
  if (mnumError || mnum == null) return { error: "Master invoice number reserve nahi ho paaya — dobara try karo.", success: null };

  const invoiceNo = formatInvoiceNo(store.invoice_ref_prefix, fy, num);
  const masterInvoiceNo = formatInvoiceNo(company.master_invoice_prefix, fy, mnum);
  const departmentReferenceNo = isFedEx(courierCompany)
    ? computeDepartmentReferenceNo(csbType as "CSB-V" | "CSB-IV", shipmentTerm, invoiceDate)
    : null;

  const { data: invoice, error: insertError } = await supabase
    .from("sales_invoices")
    .insert({
      company_id: companyId,
      store_id: storeId,
      invoice_no: invoiceNo,
      master_invoice_no: masterInvoiceNo,
      invoice_date: invoiceDate,
      shipment_term: shipmentTerm,
      csb_type: csbType,
      courier_company: courierCompany,
      department_reference_no: departmentReferenceNo,
      destination_country: destinationCountry,
      origin_declaration: originDeclarationFor(destinationCountry),
      ioss_number: iossNumber,
      buyer_name_address: buyerNameAddressOverride || orders[0].buyer_name_address || "",
      remark,
      created_by_employee_id: employee.id,
    })
    .select("id, invoice_no")
    .single();

  if (insertError || !invoice) {
    return { error: `Invoice save nahi hua: ${insertError?.message ?? "unknown error"}`, success: null };
  }

  const { error: linkError } = await supabase.from("orders").update({ invoice_id: invoice.id }).in("id", orderIds);
  if (linkError) {
    return { error: `Invoice ban gaya (${invoice.invoice_no}) lekin orders link karte waqt error aayi — Admin ko batao.`, success: null };
  }

  revalidatePath("/dashboard/invoices");
  return { error: null, success: { invoiceId: invoice.id, invoiceNo: invoice.invoice_no } };
}

/**
 * Post-generation edits — invoice text (origin declaration, dept ref no.,
 * IOSS, buyer address, remark) stays editable after generation, same
 * "never auto-locked" principle as HR Letters/Certificates, but here it's
 * persisted (an invoice number is a real legal/tax document reference,
 * unlike a certificate — losing edits on refresh would be a real problem).
 */
export async function updateInvoiceFields(
  invoiceId: string,
  fields: {
    buyer_name_address?: string;
    destination_country?: string | null;
    origin_declaration?: string | null;
    department_reference_no?: string | null;
    ioss_number?: string | null;
    remark?: string | null;
  }
): Promise<{ error: string | null }> {
  await requireCapability("invoicing");
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("sales_invoices").update(fields).eq("id", invoiceId);
  if (error) return { error: error.message };
  revalidatePath(`/dashboard/invoices/${invoiceId}`);
  return { error: null };
}
