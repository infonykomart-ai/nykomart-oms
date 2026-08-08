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
function numOrNull(formData: FormData, key: string): number | null {
  const v = str(formData, key);
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
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
  // 2026-08-08: "WEIGHT OR DIMENSION KYU NAHI MANG RAHA" — typed in AT
  // invoice time for customs declaration; deliberately a value of its own
  // on sales_invoices, not a read of dispatch_invoices' freight-billing
  // weight/dimensions (which are filled in separately, later, and can
  // legitimately differ) — see schema.sql's comment on these columns.
  const weightKg = numOrNull(formData, "weight_kg");
  const lengthCm = numOrNull(formData, "length_cm");
  const widthCm = numOrNull(formData, "width_cm");
  const heightCm = numOrNull(formData, "height_cm");
  const remark = strOrNull(formData, "remark");
  const buyerNameAddressOverride = strOrNull(formData, "buyer_name_address");
  const invoiceDate = str(formData, "invoice_date") || new Date().toISOString().slice(0, 10);

  if (orderIds.length === 0) return { error: "Select at least one order.", success: null };
  if (!shipmentTerm) return { error: "Shipment Term is required.", success: null };
  if (csbType !== "CSB-V" && csbType !== "CSB-IV") return { error: "CSB type must be CSB-V or CSB-IV.", success: null };
  if (!courierCompany) return { error: "Courier Company is required.", success: null };

  const { data: orders, error: ordersError } = await supabase
    .from("orders")
    .select("id, company_id, store_id, buyer_name_address, invoice_id")
    .in("id", orderIds);
  if (ordersError || !orders || orders.length !== orderIds.length) {
    return { error: "Failed to load selected orders — please try again.", success: null };
  }
  if (orders.some((o) => o.invoice_id)) {
    return { error: "One or more of these orders are already used in an invoice.", success: null };
  }
  const companyId = orders[0].company_id;
  const storeId = orders[0].store_id;
  if (orders.some((o) => o.company_id !== companyId || o.store_id !== storeId)) {
    return { error: "All selected orders must belong to the same company and store.", success: null };
  }
  if (!employee.companyIds.includes(companyId)) {
    return { error: "You don't have access to this company.", success: null };
  }

  const [{ data: store }, { data: company }] = await Promise.all([
    supabase.from("stores").select("id, invoice_ref_prefix").eq("id", storeId).single(),
    supabase.from("companies").select("id, master_invoice_prefix").eq("id", companyId).single(),
  ]);
  if (!store?.invoice_ref_prefix) {
    return { error: "This store's invoice prefix is not set — ask an Admin to set it (Company & Items).", success: null };
  }
  if (!company?.master_invoice_prefix) {
    return { error: "This company's master invoice prefix is not set — ask an Admin to set it.", success: null };
  }

  const fy = fyLabel(invoiceDate);

  const { data: num, error: numError } = await supabase.rpc("reserve_next_number", {
    p_company_id: companyId,
    p_scope: `INVOICE_${store.invoice_ref_prefix}`,
    p_use_fy: true,
    p_as_of_date: invoiceDate,
  });
  if (numError || num == null) return { error: "Failed to reserve invoice number — please try again.", success: null };

  const { data: mnum, error: mnumError } = await supabase.rpc("reserve_next_number", {
    p_company_id: companyId,
    p_scope: "MASTER_INVOICE",
    p_use_fy: true,
    p_as_of_date: invoiceDate,
  });
  if (mnumError || mnum == null) return { error: "Failed to reserve master invoice number — please try again.", success: null };

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
      weight_kg: weightKg,
      length_cm: lengthCm,
      width_cm: widthCm,
      height_cm: heightCm,
      buyer_name_address: buyerNameAddressOverride || orders[0].buyer_name_address || "",
      remark,
      created_by_employee_id: employee.id,
    })
    .select("id, invoice_no")
    .single();

  if (insertError || !invoice) {
    return { error: `Failed to save invoice: ${insertError?.message ?? "unknown error"}`, success: null };
  }

  const { error: linkError } = await supabase.from("orders").update({ invoice_id: invoice.id }).in("id", orderIds);
  if (linkError) {
    return { error: `Invoice created (${invoice.invoice_no}) but an error occurred while linking the orders — please inform an Admin.`, success: null };
  }

  // 2026-08-08: "SABHI ORDER LIST INVOICE VALE SECTION ME DIKHE... JESE HI
  // INVOICE SUBMIT KARE TO USKA AUTOMATIC DISPATCH MARK HO JAYE SABHI JAGH"
  // — the Invoices page no longer requires an order to already be
  // Dispatched/Delivered before it's selectable (see page.tsx), which
  // removes the old manual "edit status first, then come invoice"
  // two-step. In exchange, generating the invoice now marks these orders
  // Dispatched itself, in the same request — status lives on `orders` as a
  // single column read everywhere else (Orders hub, Late Orders filter,
  // WhatsApp button, etc.), so updating it here is enough to reflect
  // "sabhi jagh" without touching any other table. Already-Delivered
  // orders are left alone (never downgraded back to Dispatched); an
  // existing dispatch_date is preserved, only orders that never had one
  // get it defaulted to the invoice date.
  const { data: notYetDispatched } = await supabase
    .from("orders")
    .select("id, dispatch_date")
    .in("id", orderIds)
    .not("status", "in", "(Dispatched,Delivered)");

  if (notYetDispatched && notYetDispatched.length > 0) {
    await Promise.all(
      notYetDispatched.map((o) =>
        supabase
          .from("orders")
          .update({ status: "Dispatched", dispatch_date: o.dispatch_date ?? invoiceDate })
          .eq("id", o.id)
      )
    );
  }

  revalidatePath("/dashboard/invoices");
  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/orders/new");
  return { error: null, success: { invoiceId: invoice.id, invoiceNo: invoice.invoice_no } };
}

/**
 * Post-generation edits — invoice text (origin declaration, dept ref no.,
 * IOSS, buyer address, remark) stays editable after generation, same
 * "never auto-locked" principle as HR Letters/Certificates, but here it's
 * persisted (an invoice number is a real legal/tax document reference,
 * unlike a certificate — losing edits on refresh would be a real problem).
 */
export type SimpleResult = { error: string | null; success: boolean };

/**
 * 2026-08-07: "galat invoice ban gaya ya galat PO/RF/RG se ban gaya jiska
 * banna nahi tha uska bhi delete chahiye" — deleting a wrong/duplicate
 * invoice must ALSO free up the orders it was generated from, otherwise
 * they'd stay stuck showing as already-invoiced (orders.invoice_id set)
 * forever with no way to invoice them again. So: null out invoice_id on
 * every order pointing at this invoice FIRST (they reappear in "Ready to
 * invoice" on the Invoices page immediately), then delete the invoice row.
 * Nothing else references sales_invoices by a real foreign key — Credit
 * Notes/Debit Notes only store invoice_no as free text (a copy, not a
 * link, see db/schema.sql section 9) — so there's no other guard needed.
 */
export async function deleteInvoice(invoiceId: string): Promise<SimpleResult> {
  const employee = await requireCapability("invoicing");
  const supabase = createServiceRoleClient();

  const { data: invoice } = await supabase.from("sales_invoices").select("id, company_id").eq("id", invoiceId).single();
  if (!invoice || !employee.companyIds.includes(invoice.company_id)) {
    return { error: "Invoice not found or you don't have access to this company.", success: false };
  }

  const { error: unlinkError } = await supabase.from("orders").update({ invoice_id: null }).eq("invoice_id", invoiceId);
  if (unlinkError) return { error: `Could not unlink orders from this invoice: ${unlinkError.message}`, success: false };

  const { error } = await supabase.from("sales_invoices").delete().eq("id", invoiceId);
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/invoices");
  revalidatePath(`/dashboard/invoices/${invoiceId}`);
  return { error: null, success: true };
}

export async function updateInvoiceFields(
  invoiceId: string,
  fields: {
    buyer_name_address?: string;
    destination_country?: string | null;
    origin_declaration?: string | null;
    department_reference_no?: string | null;
    ioss_number?: string | null;
    weight_kg?: number | null;
    length_cm?: number | null;
    width_cm?: number | null;
    height_cm?: number | null;
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
