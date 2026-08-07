"use server";

// Order Entry — Edit/Delete (2026-08-07 round). "order panal me order ko
// edit modify delet karne ka option" — the Orders hub page (page.tsx in
// this folder) is the new "panel"; createOrder/markOrderWhatsAppSent stay
// in ../new/actions.ts (still imported from there — the file boundary is
// just where each action was first written, not a hard module wall).
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { computeCurrencyConversion } from "@/lib/orders/currency";
import { revalidatePath } from "next/cache";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}

export type OrderEditState = { error: string | null; success: boolean };

/**
 * Edits a single order row in place. Deliberately does NOT touch ref_no
 * (or which buyer-batch it belongs to) — that's assigned by createOrder's
 * reservation/reuse/suffix logic and re-deriving it mid-edit would be its
 * own can of worms (what happens to sibling suffixes if you re-batch an
 * order into a different buyer's group?). Everything else about the order
 * — item, qty, value, buyer contact details, dates, status — is editable.
 */
export async function updateOrder(_prev: OrderEditState, formData: FormData): Promise<OrderEditState> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClient();

  const orderId = str(formData, "order_id");
  if (!orderId) return { error: "Order missing.", success: false };

  const { data: existing } = await supabase.from("orders").select("id, company_id, order_date").eq("id", orderId).single();
  if (!existing || !employee.companyIds.includes(existing.company_id)) {
    return { error: "This order was not found, or you don't have access to this company.", success: false };
  }

  const itemCategoryId = str(formData, "item_category_id");
  const qty = Number(str(formData, "qty"));
  const orderCurrency = str(formData, "order_currency") || "USD";
  const orderValueOriginal = Number(str(formData, "order_value_original"));
  const orderDate = str(formData, "order_date") || existing.order_date;

  if (!itemCategoryId) return { error: "Item Category is required.", success: false };
  if (!Number.isFinite(qty) || qty <= 0) return { error: "Quantity must be greater than 0.", success: false };
  if (!Number.isFinite(orderValueOriginal) || orderValueOriginal < 0) {
    return { error: "Order value must be a valid number.", success: false };
  }

  const conversion = await computeCurrencyConversion(supabase, orderCurrency, orderDate, orderValueOriginal);

  const { error } = await supabase
    .from("orders")
    .update({
      order_date: orderDate,
      status: str(formData, "status") as never,
      dispatch_date: strOrNull(formData, "dispatch_date"),
      marketplace_order_no: strOrNull(formData, "marketplace_order_no"),
      po_date: strOrNull(formData, "po_date"),
      delivery_date: strOrNull(formData, "delivery_date"),
      item_category_id: itemCategoryId,
      sku_label: strOrNull(formData, "sku_label"),
      size_label: strOrNull(formData, "size_label") ?? "",
      qty,
      colour: strOrNull(formData, "colour"),
      photo_type: (strOrNull(formData, "photo_type") as "Dispatch" | "Website" | null) ?? null,
      photo_url: strOrNull(formData, "photo_url"),
      tassel_fringes: formData.get("tassel_fringes") === "on",
      buyer_name_address: strOrNull(formData, "buyer_name_address"),
      contact_no: strOrNull(formData, "contact_no"),
      email_id: strOrNull(formData, "email_id"),
      tax_id: strOrNull(formData, "tax_id"),
      address_type: (str(formData, "address_type") || "Residential") as "Residential" | "Commercial",
      remark: strOrNull(formData, "remark"),
      order_currency: orderCurrency,
      order_value_original: orderValueOriginal,
      order_value_usd: conversion.usd,
      order_value_inr: conversion.inr,
      exchange_rate_source: conversion.source,
    })
    .eq("id", orderId);

  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/orders/new");
  return { error: null, success: true };
}

export type SimpleResult = { error: string | null; success: boolean };

/**
 * Deletes an order — but ONLY when it's still "clean" (no dispatch/invoice/
 * credit-debit-note/freight-duty-assignment references it yet). Once any of
 * those exist, deleting the order would orphan real financial/customs
 * records, so the safe move is to tell the user to set status to
 * "Cancelled" instead (order_status already has that value — a proper
 * soft-delete, not a workaround) rather than silently blocking with no
 * explanation or, worse, silently cascading deletes through paperwork.
 */
export async function deleteOrder(orderId: string): Promise<SimpleResult> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClient();

  const { data: order } = await supabase.from("orders").select("id, company_id, invoice_id").eq("id", orderId).single();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { error: "This order was not found, or you don't have access to this company.", success: false };
  }
  if (order.invoice_id) {
    return { error: "This order already has an invoice — it cannot be deleted. Set the status to Cancelled instead.", success: false };
  }

  const [dispatch, credit, debit, washing, freight, duty] = await Promise.all([
    supabase.from("dispatch_invoices").select("id").eq("order_id", orderId).limit(1).maybeSingle(),
    supabase.from("credit_notes").select("id").eq("order_id", orderId).limit(1).maybeSingle(),
    supabase.from("debit_notes").select("id").eq("order_id", orderId).limit(1).maybeSingle(),
    supabase.from("washing_entries").select("id").eq("order_id", orderId).limit(1).maybeSingle(),
    supabase.from("freight_bill_awb_assignments").select("id").eq("order_id", orderId).limit(1).maybeSingle(),
    supabase.from("duty_bill_awb_assignments").select("id").eq("order_id", orderId).limit(1).maybeSingle(),
  ]);
  const blocked = [dispatch, credit, debit, washing, freight, duty].some((r) => r.data);
  if (blocked) {
    return {
      error: "This order has linked dispatch/document/bill records — it cannot be deleted. Set the status to Cancelled instead.",
      success: false,
    };
  }

  const { error } = await supabase.from("orders").delete().eq("id", orderId);
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/orders/new");
  return { error: null, success: true };
}
