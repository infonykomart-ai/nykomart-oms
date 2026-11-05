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
import { notifyCompanion } from "@/lib/companion/notify";
import { validateDateFields } from "@/lib/fy-date";
import { logAudit } from "@/lib/audit/log-audit";
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
function numOrNull(formData: FormData, key: string): number | null {
  const v = str(formData, key);
  return v ? Number(v) : null;
}
function numOrZero(formData: FormData, key: string): number {
  const v = str(formData, key);
  return v ? Number(v) : 0;
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

  // 2026-09-17 — FY-window validation on the edit path too (same gate as
  // createOrderCore; a typo'd year here would feed the P&L by Month view).
  const dateError = validateDateFields([
    { value: orderDate, label: "Order date" },
    { value: strOrNull(formData, "dispatch_date"), label: "Dispatch date" },
    { value: strOrNull(formData, "po_date"), label: "PO date" },
    { value: strOrNull(formData, "delivery_date"), label: "Delivery date" },
    { value: strOrNull(formData, "estimated_dispatch_date"), label: "Estimated dispatch date" },
  ]);
  if (dateError) return { error: dateError, success: false };

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
      estimated_dispatch_date: strOrNull(formData, "estimated_dispatch_date"),
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
      // 2026-09-08 additions — see
      // db/2026-09-08-order-address-fields-and-vendor-assignments.sql.
      buyer_address1: strOrNull(formData, "buyer_address1"),
      buyer_address2: strOrNull(formData, "buyer_address2"),
      buyer_address3: strOrNull(formData, "buyer_address3"),
      buyer_city: strOrNull(formData, "buyer_city"),
      buyer_state: strOrNull(formData, "buyer_state"),
      buyer_postal_code: strOrNull(formData, "buyer_postal_code"),
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
  // 2026-10-17 — the order's own page now has these controls too.
  revalidatePath(`/dashboard/orders/${orderId}`);
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
  revalidatePath(`/dashboard/orders/${orderId}`);
  revalidatePath("/dashboard/invoices");
  return { error: null, success: true };
}

/**
 * Sets an order to Returned — the post-delivery counterpart to cancelOrder
 * above. An order that was invoiced/dispatched/delivered and then sent back
 * by the buyer was never actually cancelled, so it gets its own status
 * ('Returned' — the same value courier-webhook RTO handling already uses)
 * instead of overloading 'Cancelled'. The Refund step (saveOrderRefund
 * below, unchanged) still runs exactly the same way afterward.
 *
 * 2026-08-27 hotfix: order-hold-cancel-actions.tsx already imports and
 * calls this function in production, but this file never got the matching
 * export uploaded alongside it — broke every build since ("The export
 * returnOrder was not found in module .../orders/actions.ts"). This restores
 * just the missing export, matching cancelOrder's exact shape.
 */
export async function returnOrder(orderId: string): Promise<SimpleResult> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClient();

  const { data: order } = await supabase.from("orders").select("id, company_id").eq("id", orderId).single();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { error: "This order was not found, or you don't have access to this company.", success: false };
  }

  const { error } = await supabase.from("orders").update({ status: "Returned" }).eq("id", orderId);
  if (error) return { error: error.message, success: false };

  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${orderId}`);
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
  // Refund calculator breakdown (order-hold-cancel-actions.tsx) — all
  // optional so bulkSaveRefunds (documents/actions.ts), which has no
  // calculator UI, keeps working unchanged: refundBasisPercent null and
  // the three amount fields default to 0, same as "calculator not used".
  refundBasisPercent?: number | null;
  orderValueRefundAmount?: number;
  shippingRefundAmount?: number;
  dutyRefundAmount?: number;
  // 2026-11-05 — editable refund detail (optional, so every existing caller
  // keeps compiling and saving exactly as before).
  refundQty?: number | null;
  paymentMode?: string | null;
  referenceNo?: string | null;
  remarks?: string | null;
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
  const {
    orderId,
    refundAmount,
    refundCurrency,
    refundDate,
    reason,
    refundBasisPercent = null,
    orderValueRefundAmount = 0,
    shippingRefundAmount = 0,
    dutyRefundAmount = 0,
    refundQty = null,
    paymentMode = null,
    referenceNo = null,
    remarks = null,
  } = p;

  if (!orderId) return { error: "Order missing.", success: null };
  if (!Number.isFinite(refundAmount) || refundAmount < 0) return { error: "Refund amount must be a valid number.", success: null };
  if (!refundDate) return { error: "Refund date is required.", success: null };

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, ref_no, company_id, store_id, buyer_name_address, invoice_id, order_currency, order_value_original, order_value_usd, order_value_inr, order_date, item_category_id, sku_label, size_label, qty"
    )
    .eq("id", orderId)
    .single();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { error: "This order was not found, or you don't have access to this company.", success: null };
  }

  const conversion = await computeCurrencyConversion(supabase, refundCurrency, refundDate, refundAmount);

  // Refund cap — the total refunded against this order must never exceed
  // the order's own value. Primary check, compared strictly in the order's
  // OWN currency (order_currency/order_value_original) — never cross-
  // currency for THIS check (e.g. never comparing a USD order against an
  // INR-converted refund total), per the owner's own explicit decision.
  // Only refund rows already entered in that same currency are summed on
  // either side.
  const { data: existingRefunds } = await supabase
    .from("order_refunds")
    .select("refund_amount, refund_currency, refund_amount_inr")
    .eq("order_id", order.id);
  // 2026-11-02 — "kabhi kabhi refund add nahi ho pa raha": an order whose
  // value was never filled in (NULL, or 0) turned this cap into "nothing may
  // ever be refunded" — every amount was rejected with "... exceeds the
  // order's value of 0.00". A cap only means something when there IS a value
  // to cap against, so both caps below now run only for a positive order
  // value; an order with a missing value keeps its refund entry (the entry
  // itself is still recorded, audited and reported) instead of being blocked
  // outright by a comparison against zero.
  const orderValueOriginal = Number(order.order_value_original ?? 0);

  // 2026-11-02b — the order's own value in INR, used by BOTH cross-currency
  // caps below. The stored order_value_inr is preferred; when an order never
  // got one it is computed here with the same computeCurrencyConversion()
  // (official Exchange Rate Master rate as of the ORDER's own date) the
  // order's own INR value is built from — so a fallback conversion never
  // introduces a rate or a date the app wouldn't already have used.
  let orderValueInr = Number(order.order_value_inr ?? 0);
  if (!(orderValueInr > 0) && orderValueOriginal > 0) {
    const orderConversion = await computeCurrencyConversion(supabase, order.order_currency, order.order_date ?? refundDate, orderValueOriginal);
    orderValueInr = orderConversion.inr ?? 0;
  }

  if (refundCurrency === order.order_currency && orderValueOriginal > 0) {
    const existingSameCurrencyTotal = (existingRefunds ?? [])
      .filter((r) => r.refund_currency === order.order_currency)
      .reduce((sum, r) => sum + Number(r.refund_amount), 0);
    const prospectiveTotal = existingSameCurrencyTotal + refundAmount;
    // Small epsilon for float rounding on values that flowed through the
    // calculator's own addition above.
    if (prospectiveTotal > orderValueOriginal + 0.01) {
      return {
        error: `This refund would bring total refunds on this order to ${prospectiveTotal.toFixed(2)} ${order.order_currency}, which exceeds the order's value of ${orderValueOriginal.toFixed(2)} ${order.order_currency}.`,
        success: null,
      };
    }
  }

  // 2026-11-02b — "order value se jyada refund nahi hoga, lekin currency
  // conversion se koi frq nahi padna chahiye": when the refund currency is
  // NOT the order's currency, the very same "never beyond the order's worth"
  // rule is applied after putting the order's value into the refund's own
  // currency. The rate used is derived from THIS refund's own conversion
  // (conversion.inr / refundAmount — i.e. the official rate as of the
  // refund date) and the order value side is the order's own INR value, so
  // both sides come from the same rate master and no third rate, no second
  // rounding and no manual conversion is ever involved — nothing to disagree
  // with. Without this a USD order refunded in INR had no same-currency cap
  // at all unless order_value_inr happened to be stored.
  // 2026-11-03 — "jis date me order aaya us din kya conversion rate thi or
  // jab refund hora tab kya": every cross-currency comparison now uses ONE
  // rate basis — the ORDER's value converted at the REFUND date's rate, via
  // the same computeCurrencyConversion() helper (official Exchange Rate
  // Master, falling back to the live estimate). Dividing an order-DATE INR
  // value by a refund-DATE rate mixed two different rates, which is what
  // rejected a legitimate 100% USD refund by ~₹25 of pure FX drift
  // ("₹6895.15 (converted) exceeds the order's value of ₹6870.53").
  let orderValueInrAtRefundRate: number | null = null;
  if (refundCurrency !== order.order_currency && orderValueOriginal > 0) {
    const orderValueAtRefundDate = await computeCurrencyConversion(
      supabase,
      order.order_currency,
      refundDate,
      orderValueOriginal
    );
    orderValueInrAtRefundRate = orderValueAtRefundDate.inr ?? (orderValueInr > 0 ? orderValueInr : null);
  }

  if (refundCurrency !== order.order_currency && orderValueInrAtRefundRate != null) {
    const refundRateToInr =
      conversion.inr != null && refundAmount > 0
        ? conversion.inr / refundAmount
        : refundCurrency === "INR"
          ? 1
          : null;
    if (refundRateToInr != null && refundRateToInr > 0) {
      const orderValueInRefundCurrency = orderValueInrAtRefundRate / refundRateToInr;
      const existingSameCurrencyTotal = (existingRefunds ?? [])
        .filter((r) => r.refund_currency === refundCurrency)
        .reduce((sum, r) => sum + Number(r.refund_amount), 0);
      const prospectiveTotal = existingSameCurrencyTotal + refundAmount;
      if (prospectiveTotal > orderValueInRefundCurrency + 0.01) {
        return {
          error: `This refund would bring total refunds on this order to ${prospectiveTotal.toFixed(2)} ${refundCurrency}, which exceeds the order's value of ${orderValueInRefundCurrency.toFixed(2)} ${refundCurrency} (the order's value converted at the ${refundDate} rate).`,
          success: null,
        };
      }
    }
  }

  // 2026-09-19 (audit fix) — INR safety-net cap, SECOND and independent of
  // the same-currency check above (both must pass; this never replaces
  // it). The owner's decision above was specifically to never
  // cross-convert for the PRIMARY cap, to avoid comparing an approximated
  // number — but that left a refund entered in a DIFFERENT currency than
  // the order with NO cap at all, not even a rough one: nothing stopped an
  // arbitrarily large refund once its currency didn't match the order's.
  // Every refund row already stores a real INR conversion
  // (refund_amount_inr, via this same computeCurrencyConversion() call —
  // the one helper every INR figure in this app is built from), and every
  // order already has its own order_value_inr — so this reuses numbers the
  // system is already computing and storing anyway, not a new
  // approximation invented for this check. A ₹1 epsilon (vs. same-currency
  // check's ₹0.01) allows for the small rounding noise that legitimately
  // compounds when several refunds, each separately converted at their own
  // refund-date rate, are summed together.
  // 2026-11-03 — same-currency refunds are governed exactly by the
  // same-currency check above, so they skip this net entirely (comparing
  // their refund-date INR value with the order-date INR value is what used
  // to reject a valid full refund whenever the rupee moved). For a refund in
  // another currency, both sides of this net are on the refund-date basis
  // fixed above.
  if (refundCurrency !== order.order_currency && orderValueInrAtRefundRate != null && conversion.inr != null) {
    const existingInrTotal = (existingRefunds ?? []).reduce((sum, r) => sum + Number(r.refund_amount_inr ?? 0), 0);
    const prospectiveInrTotal = existingInrTotal + conversion.inr;
    if (prospectiveInrTotal > orderValueInrAtRefundRate + 1) {
      return {
        error: `This refund would bring total refunds on this order to ₹${prospectiveInrTotal.toFixed(2)} (converted), which exceeds the order's value of ₹${orderValueInrAtRefundRate.toFixed(2)} (converted at the same refund-date rate).`,
        success: null,
      };
    }
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
        // 2026-09-19 (audit fix) — this used to compare the raw entered
        // refundAmount against order_value_original with NO currency check
        // at all, so a refund entered in a different currency than the
        // order could be mislabeled FULL/PARTIAL (e.g. a small refund in a
        // strong currency looking "FULL" against a large order value in a
        // weak one, or vice versa). Both sides are now compared in INR —
        // conversion.inr/order.order_value_inr are always in the same unit
        // regardless of which currency the refund/order were entered in —
        // falling back to the original same-currency-only comparison only
        // when an INR conversion genuinely isn't available (never silently
        // guessing a 1:1 rate).
        // Same positive-value guard as the caps above: an order with no
        // recorded value can never be "fully" refunded, so it is labelled
        // PARTIAL rather than claiming any amount equals 100% of zero.
        // Same currency: compare in that currency (exact). Different
        // currency: compare on the refund-date FX basis fixed above, so a
        // rate move can never label a 100% refund "PARTIAL".
        refund_type:
          refundCurrency === order.order_currency
            ? orderValueOriginal > 0 && refundAmount >= orderValueOriginal - 0.01
              ? "FULL REFUND"
              : "PARTIAL REFUND"
            : conversion.inr != null && orderValueInrAtRefundRate != null
              ? conversion.inr >= orderValueInrAtRefundRate - 1
                ? "FULL REFUND"
                : "PARTIAL REFUND"
              : orderValueOriginal > 0 && refundAmount >= orderValueOriginal
                ? "FULL REFUND"
                : "PARTIAL REFUND",
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

  // 2026-11-05 — accidental DOUBLE-SUBMIT guard (a second click, a page
  // resubmit): the exact same refund for the same order, currency, date,
  // amount and reason entered in the last ten minutes is treated as the same
  // entry, not a new one. Legitimate repeat refunds (different reason/date,
  // or later in the day) are never blocked — the cap above remains the real
  // financial rule.
  const { data: recentSame } = await supabase
    .from("order_refunds")
    .select("id, created_at, reason")
    .eq("order_id", order.id)
    .eq("refund_amount", refundAmount)
    .eq("refund_currency", refundCurrency)
    .eq("refund_date", refundDate)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (recentSame) {
    const ageMs = Date.now() - new Date(recentSame.created_at).getTime();
    if (ageMs >= 0 && ageMs < 10 * 60 * 1000 && (recentSame.reason ?? "") === (reason ?? "")) {
      return {
        error: "This exact refund was just saved for this order. Edit the existing entry instead of adding it twice.",
        success: null,
      };
    }
  }

  // 2026-11-05 — the four optional detail fields live in the same migration
  // as refund edit/delete. A pending migration must never block the existing
  // create-refund workflow, so an unknown-column rejection retries without
  // them exactly like the purchase-bill attribution fallback.
  const refundRow = {
    order_id: order.id,
    refund_amount: refundAmount,
    refund_currency: refundCurrency,
    refund_date: refundDate,
    reason,
    credit_note_id: creditNoteId,
    entry_by_employee_id: employee.id,
    refund_basis_percent: refundBasisPercent,
    order_value_refund_amount: orderValueRefundAmount,
    shipping_refund_amount: shippingRefundAmount,
    duty_refund_amount: dutyRefundAmount,
    refund_amount_inr: conversion.inr,
    refund_amount_usd: conversion.usd,
  };
  const refundDetail = {
    refund_qty: refundQty,
    payment_mode: paymentMode,
    reference_no: referenceNo,
    remarks,
  };
  let { error } = await supabase.from("order_refunds").insert({ ...refundRow, ...refundDetail });
  if (error && /refund_qty|payment_mode|reference_no|remarks/i.test(error.message)) {
    ({ error } = await supabase.from("order_refunds").insert(refundRow));
  }
  if (error) return { error: `Failed to save refund: ${error.message}`, success: null };

  // Inventory — every processed return/refund puts the item back into
  // sellable stock. Originally this only fired for the "order placed ->
  // cancelled -> refunded, but a Purchase entry was already made for it"
  // orphaned-purchase case (Pending item 4), gated on a purchase_bills row
  // existing for this order. Widened: restock now runs unconditionally on
  // every refund. Qty restocked is still the purchased qty when a
  // purchase_bills row exists (the amount actually paid for and sitting in
  // hand, same as before); otherwise it falls back to the order's own qty
  // (the amount actually returned). There's no "is this item still
  // sellable" signal anywhere in the schema (no damaged/condition flag), so
  // — per the decided scope — this restocks unconditionally rather than
  // trying to infer sellability.
  const { data: purchases } = await supabase.from("purchase_bills").select("qty").eq("order_id", order.id);
  const purchasedQty = (purchases ?? []).reduce((sum, p) => sum + Number(p.qty || 0), 0);
  const restockQty = purchasedQty > 0 ? purchasedQty : Number(order.qty || 0);
  if (restockQty > 0) {
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
        .update({ qty: existingStock.qty + restockQty, updated_at: new Date().toISOString() })
        .eq("id", existingStock.id);
    } else {
      await supabase.from("finished_stock").insert({
        item_category_id: order.item_category_id,
        sku_label: skuLabel,
        size_label: sizeLabel,
        qty: restockQty,
      });
    }
    await supabase.from("finished_stock_movements").insert({
      item_category_id: order.item_category_id,
      sku_label: skuLabel,
      size_label: sizeLabel,
      qty_change: restockQty,
      reason: "auto_restock_return_refund",
      order_id: order.id,
      entry_by_employee_id: employee.id,
    });
  }

  // 2026-09-05 — AI Companion: return/refund is one of the "zyada events"
  // (returns, shipment, attendance, etc.) the user asked to wire in
  // alongside order-placed and task-assigned. Notifies the employee who
  // processed the refund.
  await notifyCompanion(supabase, {
    employeeId: employee.id,
    eventType: "return_processed",
    message: `Return/refund processed for order ${order.ref_no ?? order.id}`,
  });

  return { error: null, success: { creditNoteNo } };
}

export async function saveOrderRefund(_prev: OrderRefundState, formData: FormData): Promise<OrderRefundState> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClient();

  const orderId = str(formData, "order_id");
  const result = await saveOrderRefundCore(employee, supabase, {
    orderId,
    refundAmount: Number(str(formData, "refund_amount")),
    refundCurrency: str(formData, "refund_currency") || "USD",
    refundDate: str(formData, "refund_date"),
    reason: strOrNull(formData, "reason"),
    refundBasisPercent: numOrNull(formData, "refund_basis_percent"),
    orderValueRefundAmount: numOrZero(formData, "order_value_refund_amount"),
    shippingRefundAmount: numOrZero(formData, "shipping_refund_amount"),
    dutyRefundAmount: numOrZero(formData, "duty_refund_amount"),
    refundQty: numOrNull(formData, "refund_qty"),
    paymentMode: strOrNull(formData, "payment_mode"),
    referenceNo: strOrNull(formData, "reference_no"),
    remarks: strOrNull(formData, "remarks"),
  });

  if (result.error) return result;

  revalidatePath("/dashboard/orders");
  // 2026-10-17 — the refund was saved from the order's own page too.
  revalidatePath(`/dashboard/orders/${orderId}`);
  revalidatePath("/dashboard/documents");
  revalidatePath("/dashboard/inventory");
  revalidatePath("/dashboard/returns");
  return result;
}

// 2026-11-03 — "conversion rate bhi to work karegi na yaha ki jis date me
// order aaya us din kya conversion rate thi or jab refund hora tab kya":
// the refund sheet shows BOTH rates — the one that produced the order's own
// INR value (order date) and the one the refund will be converted at
// (refund date) — so a difference between them is visible instead of
// turning into a mysterious "exceeds the order's value" error. Read-only and
// computed by the exact same helper the save path uses
// (computeCurrencyConversion), so what the sheet prints is what gets stored.
// Never throws and never blocks a save: a missing rate just comes back null
// with the reason in `source`.
export type RefundFxPreview = {
  error: string | null;
  order: {
    currency: string;
    date: string;
    value: number;
    valueInr: number | null;
    /** INR per 1 unit of the order currency on the ORDER date. */
    rate: number | null;
  } | null;
  refund: {
    currency: string;
    date: string;
    amount: number;
    valueInr: number | null;
    /** INR per 1 unit of the refund currency on the REFUND date. */
    rate: number | null;
  } | null;
  source: string;
};

export async function getRefundFxPreview(orderId: string, currency: string, refundDate: string, amount: number): Promise<RefundFxPreview> {
  const empty: RefundFxPreview = { error: null, order: null, refund: null, source: "" };
  if (!orderId) return { ...empty, error: "Order missing." };

  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClient();
  const { data: order } = await supabase
    .from("orders")
    .select("id, ref_no, company_id, order_currency, order_value_original, order_date")
    .eq("id", orderId)
    .maybeSingle();
  if (!order || !employee.companyIds.includes(order.company_id)) return { ...empty, error: "Order not found." };

  const amountNum = Number.isFinite(amount) ? amount : 0;
  const orderValue = Number(order.order_value_original) || 0;
  const orderConversion = await computeCurrencyConversion(supabase, order.order_currency, order.order_date, orderValue);
  const refundConversion =
    refundDate && amountNum > 0
      ? await computeCurrencyConversion(supabase, currency || order.order_currency, refundDate, amountNum)
      : null;

  return {
    error: null,
    order: {
      currency: order.order_currency,
      date: order.order_date,
      value: orderValue,
      valueInr: orderConversion.inr,
      rate: orderConversion.inr != null && orderValue > 0 ? orderConversion.inr / orderValue : null,
    },
    refund: refundConversion
      ? {
          currency: currency || order.order_currency,
          date: refundDate,
          amount: amountNum,
          valueInr: refundConversion.inr,
          rate: refundConversion.inr != null && amountNum > 0 ? refundConversion.inr / amountNum : null,
        }
      : null,
    source: refundConversion?.source ?? orderConversion.source,
  };
}

// ============================================================================
// REFUND EDIT / UPDATE / DELETE (2026-11-05)
//
// "refund entry ... usko edit update ya delete karne ka koi option nahi hai":
// every refund row can now be corrected or removed. The financial rules are
// the SAME three caps saveOrderRefundCore enforces on creation, re-run with
// the row being edited EXCLUDED from its own total (otherwise editing ₹100 to
// ₹100 would look like a duplicate ₹100 and fail against the cap).
//
// All writes go through the two SQL functions in
// db/2026-11-05-refund-edit-delete-and-measurement.sql so the refund row and
// the credit note it generated (or, on delete, the restock it caused) move in
// ONE transaction. No calculation happens in SQL — this file computes the
// exchange conversion and the refund type, exactly like creation does.
// ============================================================================

const REFUND_EDIT_MIGRATION_FILE = "db/2026-11-05-refund-edit-delete-and-measurement.sql";

function refundEditPending(error: { code?: string | null; message?: string | null } | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "PGRST204") return true;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("apply_order_refund_") ||
    message.includes("refund_qty") ||
    message.includes("payment_mode") ||
    message.includes("reference_no") ||
    message.includes("could not find the 'remarks'")
  );
}

const REFUND_EDIT_PENDING_HINT = `Run ${REFUND_EDIT_MIGRATION_FILE} in the Supabase SQL editor to enable refund edit / delete.`;

export type OrderRefundEditState = { error: string | null; success: { orderId: string } | null };

type RefundCapOrder = {
  order_currency: string;
  order_value_original: number | null;
  order_value_inr: number | null;
  order_date: string | null;
};

type RefundCapRow = { refund_amount: number; refund_currency: string; refund_amount_inr: number | null };

/**
 * The creation caps, applied to an EDIT. `existingRefunds` must already have
 * the edited row filtered out. Returns the refund-date INR basis as well, so
 * the credit note's FULL/PARTIAL label uses the same number the cap did.
 */
async function refundCapError(
  supabase: ReturnType<typeof createServiceRoleClient>,
  order: RefundCapOrder,
  refundCurrency: string,
  refundDate: string,
  refundAmount: number,
  conversionInr: number | null,
  existingRefunds: RefundCapRow[]
): Promise<{ error: string | null; orderValueInrAtRefundRate: number | null }> {
  const orderValueOriginal = Number(order.order_value_original ?? 0);
  let orderValueInr = Number(order.order_value_inr ?? 0);
  if (!(orderValueInr > 0) && orderValueOriginal > 0) {
    const conversion = await computeCurrencyConversion(
      supabase,
      order.order_currency,
      order.order_date ?? refundDate,
      orderValueOriginal
    );
    orderValueInr = conversion.inr ?? 0;
  }

  if (refundCurrency === order.order_currency && orderValueOriginal > 0) {
    const existing = existingRefunds
      .filter((r) => r.refund_currency === order.order_currency)
      .reduce((sum, r) => sum + Number(r.refund_amount), 0);
    const total = existing + refundAmount;
    if (total > orderValueOriginal + 0.01) {
      return {
        error: `This refund would bring total refunds on this order to ${total.toFixed(2)} ${order.order_currency}, which exceeds the order's value of ${orderValueOriginal.toFixed(2)} ${order.order_currency}.`,
        orderValueInrAtRefundRate: null,
      };
    }
  }

  let orderValueInrAtRefundRate: number | null = null;
  if (refundCurrency !== order.order_currency && orderValueOriginal > 0) {
    const conversion = await computeCurrencyConversion(supabase, order.order_currency, refundDate, orderValueOriginal);
    orderValueInrAtRefundRate = conversion.inr ?? (orderValueInr > 0 ? orderValueInr : null);
  }

  if (refundCurrency !== order.order_currency && orderValueInrAtRefundRate != null) {
    const refundRateToInr =
      conversionInr != null && refundAmount > 0
        ? conversionInr / refundAmount
        : refundCurrency === "INR"
          ? 1
          : null;
    if (refundRateToInr != null && refundRateToInr > 0) {
      const orderValueInRefundCurrency = orderValueInrAtRefundRate / refundRateToInr;
      const existing = existingRefunds
        .filter((r) => r.refund_currency === refundCurrency)
        .reduce((sum, r) => sum + Number(r.refund_amount), 0);
      const total = existing + refundAmount;
      if (total > orderValueInRefundCurrency + 0.01) {
        return {
          error: `This refund would bring total refunds on this order to ${total.toFixed(2)} ${refundCurrency}, which exceeds the order's value of ${orderValueInRefundCurrency.toFixed(2)} ${refundCurrency} (the order's value converted at the ${refundDate} rate).`,
          orderValueInrAtRefundRate,
        };
      }
    }
  }

  if (refundCurrency !== order.order_currency && orderValueInrAtRefundRate != null && conversionInr != null) {
    const existingInr = existingRefunds.reduce((sum, r) => sum + Number(r.refund_amount_inr ?? 0), 0);
    const totalInr = existingInr + conversionInr;
    if (totalInr > orderValueInrAtRefundRate + 1) {
      return {
        error: `This refund would bring total refunds on this order to ₹${totalInr.toFixed(2)} (converted), which exceeds the order's value of ₹${orderValueInrAtRefundRate.toFixed(2)} (converted at the same refund-date rate).`,
        orderValueInrAtRefundRate,
      };
    }
  }

  return { error: null, orderValueInrAtRefundRate };
}

/** Same FULL / PARTIAL label rule saveOrderRefundCore applies on creation. */
function refundTypeFor(
  orderCurrency: string,
  orderValueOriginal: number,
  refundCurrency: string,
  refundAmount: number,
  conversionInr: number | null,
  orderValueInrAtRefundRate: number | null
): "FULL REFUND" | "PARTIAL REFUND" {
  if (refundCurrency === orderCurrency) {
    return orderValueOriginal > 0 && refundAmount >= orderValueOriginal - 0.01 ? "FULL REFUND" : "PARTIAL REFUND";
  }
  if (conversionInr != null && orderValueInrAtRefundRate != null) {
    return conversionInr >= orderValueInrAtRefundRate - 1 ? "FULL REFUND" : "PARTIAL REFUND";
  }
  return orderValueOriginal > 0 && refundAmount >= orderValueOriginal ? "FULL REFUND" : "PARTIAL REFUND";
}

export async function updateOrderRefund(
  _prev: OrderRefundEditState,
  formData: FormData
): Promise<OrderRefundEditState> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClient();

  const refundId = str(formData, "refund_id");
  if (!refundId) return { error: "Missing refund entry.", success: null };

  const refundAmount = Number(str(formData, "refund_amount"));
  const refundCurrency = str(formData, "refund_currency").toUpperCase();
  const refundDate = str(formData, "refund_date");
  const reason = strOrNull(formData, "reason");
  const refundQty = numOrNull(formData, "refund_qty");
  const paymentMode = strOrNull(formData, "payment_mode");
  const referenceNo = strOrNull(formData, "reference_no");
  const remarks = strOrNull(formData, "remarks");

  if (!Number.isFinite(refundAmount) || refundAmount < 0) {
    return { error: "Refund amount must be a valid number.", success: null };
  }
  if (!refundCurrency) return { error: "Refund currency is required.", success: null };
  if (!refundDate) return { error: "Refund date is required.", success: null };
  if (refundQty != null && (!Number.isFinite(refundQty) || refundQty < 0)) {
    return { error: "Refund quantity must be a valid number.", success: null };
  }

  const { data: refund, error: refundError } = await supabase
    .from("order_refunds")
    .select("id, order_id, refund_amount, refund_currency, refund_date, reason, credit_note_id, refund_qty, payment_mode, reference_no, remarks, refund_amount_inr")
    .eq("id", refundId)
    .maybeSingle();
  if (refundError) {
    if (refundEditPending(refundError)) return { error: REFUND_EDIT_PENDING_HINT, success: null };
    return { error: refundError.message, success: null };
  }
  if (!refund) return { error: "Refund not found.", success: null };

  const { data: order } = await supabase
    .from("orders")
    .select("id, ref_no, company_id, order_currency, order_value_original, order_value_inr, order_date")
    .eq("id", refund.order_id)
    .single();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { error: "This refund's order was not found, or you don't have access to its company.", success: null };
  }

  const conversion = await computeCurrencyConversion(supabase, refundCurrency, refundDate, refundAmount);

  const { data: otherRefunds } = await supabase
    .from("order_refunds")
    .select("id, refund_amount, refund_currency, refund_amount_inr")
    .eq("order_id", order.id)
    .neq("id", refund.id);

  const cap = await refundCapError(
    supabase,
    order,
    refundCurrency,
    refundDate,
    refundAmount,
    conversion.inr,
    (otherRefunds ?? []).map((r) => ({
      refund_amount: Number(r.refund_amount),
      refund_currency: r.refund_currency,
      refund_amount_inr: r.refund_amount_inr != null ? Number(r.refund_amount_inr) : null,
    }))
  );
  if (cap.error) return { error: cap.error, success: null };

  const refundType = refundTypeFor(
    order.order_currency,
    Number(order.order_value_original ?? 0),
    refundCurrency,
    refundAmount,
    conversion.inr,
    cap.orderValueInrAtRefundRate
  );

  const { error: updateError } = await supabase.rpc("apply_order_refund_update", {
    p_refund_id: refund.id,
    p_employee_id: employee.id,
    p_amount: refundAmount,
    p_currency: refundCurrency,
    p_date: refundDate,
    p_reason: reason,
    p_qty: refundQty,
    p_payment_mode: paymentMode,
    p_reference_no: referenceNo,
    p_remarks: remarks,
    p_basis: numOrNull(formData, "refund_basis_percent"),
    p_order_value: numOrZero(formData, "order_value_refund_amount"),
    p_shipping: numOrZero(formData, "shipping_refund_amount"),
    p_duty: numOrZero(formData, "duty_refund_amount"),
    p_inr: conversion.inr,
    p_usd: conversion.usd,
    p_refund_type: refundType,
  });
  if (updateError) {
    if (refundEditPending(updateError)) return { error: REFUND_EDIT_PENDING_HINT, success: null };
    return { error: `Failed to update the refund: ${updateError.message}`, success: null };
  }

  await logAudit(supabase, {
    companyId: order.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "order_refund.updated",
    entityType: "order_refund",
    entityId: refund.id,
    entityLabel: order.ref_no,
    changes: {
      refund_amount: { from: Number(refund.refund_amount), to: refundAmount },
      refund_currency: { from: refund.refund_currency, to: refundCurrency },
      refund_date: { from: refund.refund_date, to: refundDate },
      reason: { from: refund.reason, to: reason },
      refund_qty: { from: refund.refund_qty, to: refundQty },
      payment_mode: { from: refund.payment_mode, to: paymentMode },
      reference_no: { from: refund.reference_no, to: referenceNo },
      remarks: { from: refund.remarks, to: remarks },
      refund_amount_inr: { from: refund.refund_amount_inr, to: conversion.inr },
    },
  });

  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${order.id}`);
  revalidatePath("/dashboard/returns");
  revalidatePath("/dashboard/documents");
  return { error: null, success: { orderId: order.id } };
}

export type OrderRefundDeleteState = { error: string | null; success: boolean };

export async function deleteOrderRefund(refundId: string): Promise<OrderRefundDeleteState> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClient();
  if (!refundId) return { error: "Missing refund entry.", success: false };

  const { data: refund, error: refundError } = await supabase
    .from("order_refunds")
    .select("id, order_id, refund_amount, refund_currency, refund_date, reason, credit_note_id, refund_qty, payment_mode, reference_no, remarks")
    .eq("id", refundId)
    .maybeSingle();
  if (refundError) {
    if (refundEditPending(refundError)) return { error: REFUND_EDIT_PENDING_HINT, success: false };
    return { error: refundError.message, success: false };
  }
  if (!refund) return { error: "Refund not found.", success: false };

  const { data: order } = await supabase
    .from("orders")
    .select("id, ref_no, company_id")
    .eq("id", refund.order_id)
    .single();
  if (!order || !employee.companyIds.includes(order.company_id)) {
    return { error: "This refund's order was not found, or you don't have access to its company.", success: false };
  }

  const { data, error } = await supabase.rpc("apply_order_refund_delete", {
    p_refund_id: refund.id,
    p_employee_id: employee.id,
  });
  if (error) {
    if (refundEditPending(error)) return { error: REFUND_EDIT_PENDING_HINT, success: false };
    return { error: `Failed to delete the refund: ${error.message}`, success: false };
  }

  const result = (data ?? {}) as { ok?: boolean; error?: string; reversed_qty?: number };
  if (!result.ok) return { error: result.error ?? "The refund could not be deleted.", success: false };

  await logAudit(supabase, {
    companyId: order.company_id,
    employeeId: employee.id,
    employeeName: employee.name,
    action: "order_refund.deleted",
    entityType: "order_refund",
    entityId: refund.id,
    entityLabel: order.ref_no,
    changes: {
      refund_amount: refund.refund_amount,
      refund_currency: refund.refund_currency,
      refund_date: refund.refund_date,
      reason: refund.reason,
      refund_qty: refund.refund_qty,
      payment_mode: refund.payment_mode,
      reference_no: refund.reference_no,
      remarks: refund.remarks,
      credit_note_id: refund.credit_note_id,
      restock_reversed: Number(result.reversed_qty ?? 0),
    },
  });

  revalidatePath("/dashboard/orders");
  revalidatePath(`/dashboard/orders/${order.id}`);
  revalidatePath("/dashboard/returns");
  revalidatePath("/dashboard/documents");
  revalidatePath("/dashboard/inventory");
  return { error: null, success: true };
}
