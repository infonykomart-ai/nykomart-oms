"use server";

import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { buyerMatchKey } from "@/lib/orders/buyer-match";
import { computeCurrencyConversion } from "@/lib/orders/currency";
import { revalidatePath } from "next/cache";

export type OrderFormState = {
  error: string | null;
  success: { refNo: string } | null;
};

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function strOrNull(formData: FormData, key: string): string | null {
  const v = str(formData, key);
  return v ? v : null;
}

/**
 * Order Entry — implements every business rule documented at the top of
 * db/schema.sql that applies to `orders`:
 *  - PO/RF/RG number reservation happens HERE, only on actual save (never
 *    when the form merely renders) — see reserve_next_number() comment.
 *  - Duplicate-dispatched-order reuse: same buyer + same marketplace order
 *    number, already Dispatched -> reuse that order's base ref_no instead
 *    of burning a fresh number.
 *  - Buyer-batch suffix: every order this buyer places today shares one
 *    base ref_no, distinguished by a "-position/total" suffix, recomputed
 *    from scratch across all of that buyer's rows today (see below).
 *  - Currency conversion computed server-side from the Exchange Rate
 *    Master (never trusted from the client).
 */
export async function createOrder(_prev: OrderFormState, formData: FormData): Promise<OrderFormState> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClient();

  const storeId = str(formData, "store_id");
  const orderDate = str(formData, "order_date");
  const itemCategoryId = str(formData, "item_category_id");
  const qtyRaw = str(formData, "qty");
  const orderCurrency = str(formData, "order_currency") || "USD";
  const orderValueRaw = str(formData, "order_value_original");
  const marketplaceOrderNo = strOrNull(formData, "marketplace_order_no");
  const buyerNameAddress = strOrNull(formData, "buyer_name_address");
  const contactNo = strOrNull(formData, "contact_no");
  const manualRefNo = strOrNull(formData, "manual_ref_no");

  if (!storeId || !orderDate || !itemCategoryId) {
    return { error: "Store, order date aur item category zaroori hain.", success: null };
  }
  const qty = Number(qtyRaw);
  if (!Number.isFinite(qty) || qty <= 0) {
    return { error: "Quantity 0 se zyada honi chahiye.", success: null };
  }
  const orderValueOriginal = Number(orderValueRaw);
  if (!Number.isFinite(orderValueOriginal) || orderValueOriginal < 0) {
    return { error: "Order value sahi number honi chahiye.", success: null };
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, ref_prefix")
    .eq("id", employee.currentCompanyId)
    .single();
  if (companyError || !company) {
    return { error: "Company record nahi mila — Admin se contact karo.", success: null };
  }

  const thisBuyerKey = buyerMatchKey(contactNo, buyerNameAddress);
  let baseRefNo: string | null = manualRefNo;

  if (!baseRefNo) {
    // 1. Duplicate-dispatched-order reuse (only meaningful when we have a
    // marketplace order number to match on — that's the whole basis of "is
    // this really the same portal order").
    if (marketplaceOrderNo) {
      const { data: candidates } = await supabase
        .from("orders")
        .select("ref_no_base, contact_no, buyer_name_address")
        .eq("company_id", employee.currentCompanyId)
        .eq("status", "Dispatched")
        .eq("marketplace_order_no", marketplaceOrderNo);

      const dispatchedMatch = (candidates ?? []).find(
        (row) => buyerMatchKey(row.contact_no, row.buyer_name_address) === thisBuyerKey
      );
      if (dispatchedMatch?.ref_no_base) {
        baseRefNo = dispatchedMatch.ref_no_base;
      }
    }

    // 2. Same buyer already has an order batch today -> reuse ITS base
    // (that's what makes them a "batch" sharing one ref_no with suffixes).
    if (!baseRefNo) {
      const { data: todaysOrders } = await supabase
        .from("orders")
        .select("ref_no_base, contact_no, buyer_name_address")
        .eq("company_id", employee.currentCompanyId)
        .eq("order_date", orderDate);

      const sibling = (todaysOrders ?? []).find(
        (row) => buyerMatchKey(row.contact_no, row.buyer_name_address) === thisBuyerKey
      );
      if (sibling?.ref_no_base) {
        baseRefNo = sibling.ref_no_base;
      }
    }

    // 3. Genuinely new — reserve a fresh number now, at actual save time.
    if (!baseRefNo) {
      const { data: num, error: reserveError } = await supabase.rpc("reserve_next_number", {
        p_company_id: employee.currentCompanyId,
        p_scope: "ORDER_REF",
        p_use_fy: false,
        p_as_of_date: orderDate,
      });
      if (reserveError || num == null) {
        return { error: "PO/RF/RG number reserve nahi ho paya — dobara try karo.", success: null };
      }
      baseRefNo = `${company.ref_prefix}-${String(num).padStart(4, "0")}`;
    }
  }

  const conversion = await computeCurrencyConversion(supabase, orderCurrency, orderDate, orderValueOriginal);

  // If this base ref_no already has sibling row(s) today (batch reuse from
  // step 2, or a same-day dispatched-duplicate reuse), the sibling's OWN
  // ref_no is currently still bare (e.g. "PO-0001") until the recompute
  // below runs — inserting this new row with that exact same bare ref_no
  // would collide with the UNIQUE (company_id, ref_no) constraint. Insert
  // with a provisional-but-valid suffix instead (matches the "-pos/total"
  // shape so ref_no_base still resolves to baseRefNo for the recompute
  // query below); the recompute immediately overwrites every row in the
  // batch, including this one, with the real final suffixes.
  const { count: existingSiblingsToday } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("company_id", employee.currentCompanyId)
    .eq("order_date", orderDate)
    .eq("ref_no_base", baseRefNo);
  const provisionalTotal = (existingSiblingsToday ?? 0) + 1;
  const provisionalRefNo =
    provisionalTotal > 1 ? `${baseRefNo}-${provisionalTotal}/${provisionalTotal}` : baseRefNo;

  const { error: insertError } = await supabase.from("orders").insert({
    company_id: employee.currentCompanyId,
    store_id: storeId,
    order_date: orderDate,
    ref_no: provisionalRefNo,
    po_date: strOrNull(formData, "po_date"),
    delivery_date: strOrNull(formData, "delivery_date"),
    marketplace_order_no: marketplaceOrderNo,
    photo_url: strOrNull(formData, "photo_url"),
    sku_label: strOrNull(formData, "sku_label"),
    size_label: strOrNull(formData, "size_label") ?? "",
    qty,
    item_category_id: itemCategoryId,
    buyer_name_address: buyerNameAddress,
    contact_no: contactNo,
    email_id: strOrNull(formData, "email_id"),
    tax_id: strOrNull(formData, "tax_id"),
    address_type: (str(formData, "address_type") || "Residential") as "Residential" | "Commercial",
    photo_type: (strOrNull(formData, "photo_type") as "Dispatch" | "Website" | null) ?? null,
    colour: strOrNull(formData, "colour"),
    remark: strOrNull(formData, "remark"),
    tassel_fringes: formData.get("tassel_fringes") === "on",
    entry_by_employee_id: employee.id,
    order_currency: orderCurrency,
    order_value_original: orderValueOriginal,
    order_value_usd: conversion.usd,
    order_value_inr: conversion.inr,
    exchange_rate_source: conversion.source,
  });

  if (insertError) {
    return { error: `Save nahi ho paya: ${insertError.message}`, success: null };
  }

  // Recompute the buyer-batch suffix across every one of this buyer's
  // orders today, from scratch (matches the documented rule exactly) — the
  // row we just inserted is included since it shares baseRefNo.
  const { data: batch } = await supabase
    .from("orders")
    .select("id, entry_timestamp")
    .eq("company_id", employee.currentCompanyId)
    .eq("order_date", orderDate)
    .eq("ref_no_base", baseRefNo)
    .order("entry_timestamp", { ascending: true });

  if (batch && batch.length > 0) {
    const total = batch.length;
    await Promise.all(
      batch.map((row, index) => {
        const newRefNo = total === 1 ? baseRefNo! : `${baseRefNo}-${index + 1}/${total}`;
        return supabase.from("orders").update({ ref_no: newRefNo }).eq("id", row.id);
      })
    );
  }

  revalidatePath("/dashboard/orders/new");

  const finalRefNo = batch && batch.length > 1 ? `${baseRefNo} (batch of ${batch.length})` : baseRefNo!;
  return { error: null, success: { refNo: finalRefNo } };
}

/**
 * WhatsApp — item 5. No Business API is used; the order-entry employee
 * shares the order (photo + details) via their OWN WhatsApp using the
 * browser's Web Share API / a wa.me link (see order-whatsapp-button.tsx).
 * This action only records that the share was triggered, so the "Aaj ki
 * recent entries" list can show a status and hide the button once sent.
 */
export async function markOrderWhatsAppSent(orderId: string): Promise<{ error: string | null }> {
  await requireCapability("order_entry");
  const supabase = createServiceRoleClient();

  const { error } = await supabase
    .from("orders")
    .update({ whatsapp_sent_at: new Date().toISOString() })
    .eq("id", orderId);

  if (error) return { error: error.message };
  revalidatePath("/dashboard/orders/new");
  return { error: null };
}
