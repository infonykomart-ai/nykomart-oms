"use server";

// Order Entry — Edit/Delete (2026-08-07 round). "order panal me order ko
// edit modify delet karne ka option" — the Orders hub page (page.tsx in
// this folder) is the new "panel"; createOrder/markOrderWhatsAppSent stay
// in ../new/actions.ts (still imported from there — the file boundary is
// just where each action was first written, not a hard module wall).
import { requireCapability, type AuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { computeCurrencyConversion } from "@/lib/orders/currency";
import { parseCountryFromAddress } from "@/lib/geo/parse-country";
import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

// 2026-08-18 — "jo order me photo dalte hai to usme photo ka preview nahi
// aata" + "jaha jaha par photo ke link hai vo kaam nahi karte": order
// photos were a plain paste-a-link field with no real upload, so staff
// often pasted a page/share link (not a direct image URL), which can never
// render as an <img>. This adds a real upload path (same pattern as
// direct_messages' message-attachments bucket) alongside the existing
// paste-a-link field — see photo-url-field.tsx, used from both the New
// Order form and the inline Order edit form. Bucket is PUBLIC (unlike the
// private message-attachments bucket) since order photos are plain product
// photos, not private content, and need to render directly in printed
// invoices/WhatsApp messages without going through an auth-gated proxy —
// requires `insert into storage.buckets (id, name, public) values
// ('order-photos', 'order-photos', true) on conflict (id) do nothing;`
// (see db/2026-08-18-order-photos-bucket.sql) to be run once in Supabase.
const ORDER_PHOTO_BUCKET = "order-photos";
const MAX_ORDER_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB — matches message-attachments' cap

export async function uploadOrderPhoto(formData: FormData): Promise<{ url: string | null; error: string | null }> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClient();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { url: null, error: "No file selected." };
  if (file.size > MAX_ORDER_PHOTO_BYTES) return { url: null, error: "File is too large — max 10MB." };
  if (!file.type.startsWith("image/")) return { url: null, error: "Please upload an image file." };

  const safeName = file.name.replace(/[^\w.\- ]/g, "_").slice(0, 150);
  const path = `${employee.id}/${randomUUID()}-${safeName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage.from(ORDER_PHOTO_BUCKET).upload(path, buffer, {
    contentType: file.type,
    upsert: false,
  });
  if (uploadError) return { url: null, error: `Upload failed: ${uploadError.message}` };

  const { data } = supabase.storage.from(ORDER_PHOTO_BUCKET).getPublicUrl(path);
  return { url: data.publicUrl, error: null };
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

  // 2026-08-22 — same auto-derive as createOrderCore (see
  // src/lib/geo/parse-country.ts): re-derived from whatever address text
  // is being saved here, so editing the address also refreshes the
  // country instead of leaving a stale value from before the edit.
  const buyerNameAddress = strOrNull(formData, "buyer_name_address");
  const buyerCountry = parseCountryFromAddress(buyerNameAddress) ?? "";

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
      buyer_name_address: buyerNameAddress,
      buyer_country: buyerCountry,
      contact_no: strOrNull(formData, "contact_no"),
      email_id: strOrNull(formData, "email_id"),
      tax_id: strOrNull(formData, "tax_id"),
      address_type: (str(formData, "address_type") || "Residential") as "Residential" | "Commercial",
      // 2026-08-11 additions — see db/2026-08-11-order-tax-destination-fields.sql
      vat_number: strOrNull(formData, "vat_number"),
      eori_number: strOrNull(formData, "eori_number"),
      ioss_number: strOrNull(formData, "ioss_number"),
      destination_country: strOrNull(formData, "destination_country"),
      vendor_party_id: strOrNull(formData, "vendor_party_id"),
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

// ============================================================================
// Order Hold / Cancel / Refund (pending item 2, 2026-08-08) — see
// claude/order-lifecycle-inventory-tracking-adspend-requests-2026-08-08.md.
// Design confirmed with the user:
//   - Hold = order fully blocked from further action (see invoices/
//     actions.ts's generateInvoice() and page.tsx's eligible-orders query,
//     both updated to exclude Hold/Cancelled orders) until taken off Hold
//     again via the normal status dropdown in OrderEditForm.
//   - Cancel is a plain status change; the Refund itself is a SEPARATE step
//     (order-hold-cancel-actions.tsx shows the refund mini-form right after
//     Cancel) since the refund amount is case-by-case, never auto-computed.
//   - Refund against an order that already has an invoice (order.invoice_id
//     set) additionally auto-generates a Credit Note for the refunded
//     amount — the "two separate refund systems depending on dispatch
//     state" the user described. Not-yet-invoiced orders just get the
//     order_refunds row on its own.
// ============================================================================

/**
 * Sets an order to Hold — buyer sent a cancel request, first step is to
 * stop it moving further (see invoices module's exclusion of Hold orders).
 * Does NOT touch dispatch_date/invoice_id — Hold is meant to be reversible
 * via the normal status dropdown, not a destructive action.
 */
export async function holdOrder(orderId: string): Promise<SimpleResult> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClient();

  const { data: order } = await supabase.from("orders").select("id, company_id, invoice_id").eq("id", orderId).single();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { error: "This order was not found, or you don't have access to this company.", success: false };
  }
  if (order.invoice_id) {
    return { error: "This order already has an invoice — Hold no longer applies once dispatched/invoiced.", success: false };
  }

  const { error } = await supabase.from("orders").update({ status: "Hold" }).eq("id", orderId);
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/orders");
  return { error: null, success: true };
}

/** Sets an order to Cancelled — the Refund step (if any) happens separately via saveOrderRefund below. */
export async function cancelOrder(orderId: string): Promise<SimpleResult> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClient();

  const { data: order } = await supabase.from("orders").select("id, company_id").eq("id", orderId).single();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { error: "This order was not found, or you don't have access to this company.", success: false };
  }

  const { error } = await supabase.from("orders").update({ status: "Cancelled" }).eq("id", orderId);
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/invoices");
  return { error: null, success: true };
}

export type OrderRefundState = { error: string | null; success: { creditNoteNo: string | null } | null };

// 2026-08-27 (bulk-upload round) — "jese order ki sheet bani hai vesi har
// section ki sheet banegi ... refund and any other all": split into
// saveOrderRefundCore (all the actual work, formData-free) + the thin
// saveOrderRefund wrapper below (parses formData, revalidates paths) so
// bulkSaveRefunds (documents/actions.ts) can drive the exact same logic
// per row — same "never approximate the bulk path" convention every other
// bulkSave* in this codebase already follows.
export type OrderRefundParams = {
  orderId: string;
  refundAmount: number;
  refundCurrency: string;
  refundDate: string;
  reason: string | null;
};

/**
 * Records a refund against a (normally already-Cancelled) order. Amount is
 * always manually typed — "case-by-case decide karna padta hai", no fixed
 * refund-% rule exists to compute it from. If the order already has an
 * invoice, this ALSO auto-generates a Credit Note for the same amount
 * (the "dispatched+invoiced" automatic path); otherwise it's just the
 * order_refunds row (the "not-yet-dispatched" path — its own small screen,
 * no invoice/Credit Note to tie it to yet).
 */
export async function saveOrderRefundCore(
  employee: AuthedEmployee,
  supabase: ReturnType<typeof createServiceRoleClient>,
  p: OrderRefundParams
): Promise<OrderRefundState> {
  const { orderId, refundAmount, refundCurrency, refundDate, reason } = p;

  if (!orderId) return { error: "Order missing.", success: null };
  if (!Number.isFinite(refundAmount) || refundAmount < 0) return { error: "Refund amount must be a valid number.", success: null };
  if (!refundDate) return { error: "Refund date is required.", success: null };

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, company_id, store_id, buyer_name_address, invoice_id, order_value_original, order_value_usd, order_value_inr, item_category_id, sku_label, size_label"
    )
    .eq("id", orderId)
    .single();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { error: "This order was not found, or you don't have access to this company.", success: null };
  }

  let creditNoteId: string | null = null;
  let creditNoteNo: string | null = null;

  if (order.invoice_id) {
    const { data: invoice } = await supabase.from("sales_invoices").select("id, invoice_no").eq("id", order.invoice_id).maybeSingle();
    const { data: creditNote, error: cnError } = await supabase
      .from("credit_notes")
      .insert({
        company_id: order.company_id,
        store_id: order.store_id,
        credit_note_date: refundDate,
        order_id: order.id,
        buyer_name: order.buyer_name_address,
        invoice_no: invoice?.invoice_no ?? null,
        invoice_value_usd: order.order_value_usd,
        invoice_value_inr: order.order_value_inr,
        refund_amount: refundAmount,
        refund_amt_usd: refundCurrency === "USD" ? refundAmount : null,
        refund_amt_inr: refundCurrency === "INR" ? refundAmount : null,
        refund_type: refundAmount >= Number(order.order_value_original) ? "FULL REFUND" : "PARTIAL REFUND",
        created_by_employee_id: employee.id,
        remark: reason,
      })
      .select("id, cn_no")
      .single();
    if (cnError || !creditNote) {
      return { error: `Failed to auto-generate Credit Note: ${cnError?.message ?? "unknown error"}`, success: null };
    }
    creditNoteId = creditNote.id;
    creditNoteNo = creditNote.cn_no;
  }

  const { error } = await supabase.from("order_refunds").insert({
    order_id: order.id,
    refund_amount: refundAmount,
    refund_currency: refundCurrency,
    refund_date: refundDate,
    reason,
    credit_note_id: creditNoteId,
    entry_by_employee_id: employee.id,
  });
  if (error) return { error: `Failed to save refund: ${error.message}`, success: null };

  // Pending item 4 (Inventory) — "order placed -> cancelled -> refunded,
  // but a Purchase entry was already made for it -> that stock should
  // automatically flow into Inventory instead of sitting orphaned." Only
  // fires when a purchase_bills row already exists against this order;
  // the purchased qty (not the order's own qty) is what flows into stock,
  // since that's the amount actually paid for and sitting in hand.
  const { data: purchases } = await supabase.from("purchase_bills").select("qty").eq("order_id", order.id);
  const purchasedQty = (purchases ?? []).reduce((sum, p) => sum + Number(p.qty || 0), 0);
  if (purchasedQty > 0) {
    const skuLabel = order.sku_label ?? "";
    const sizeLabel = order.size_label ?? "";
    const { data: existingStock } = await supabase
      .from("finished_stock")
      .select("id, qty")
      .eq("item_category_id", order.item_category_id)
      .eq("sku_label", skuLabel)
      .eq("size_label", sizeLabel)
      .maybeSingle();

    if (existingStock) {
      await supabase
        .from("finished_stock")
        .update({ qty: existingStock.qty + purchasedQty, updated_at: new Date().toISOString() })
        .eq("id", existingStock.id);
    } else {
      await supabase.from("finished_stock").insert({
        item_category_id: order.item_category_id,
        sku_label: skuLabel,
        size_label: sizeLabel,
        qty: purchasedQty,
      });
    }
    await supabase.from("finished_stock_movements").insert({
      item_category_id: order.item_category_id,
      sku_label: skuLabel,
      size_label: sizeLabel,
      qty_change: purchasedQty,
      reason: "auto_restock_cancelled_order",
      order_id: order.id,
      entry_by_employee_id: employee.id,
    });
  }

  return { error: null, success: { creditNoteNo } };
}

export async function saveOrderRefund(_prev: OrderRefundState, formData: FormData): Promise<OrderRefundState> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClient();

  const result = await saveOrderRefundCore(employee, supabase, {
    orderId: str(formData, "order_id"),
    refundAmount: Number(str(formData, "refund_amount")),
    refundCurrency: str(formData, "refund_currency") || "USD",
    refundDate: str(formData, "refund_date"),
    reason: strOrNull(formData, "reason"),
  });

  if (result.error) return result;

  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/documents");
  revalidatePath("/dashboard/inventory");
  return result;
}
