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

type ParsedItem = {
  itemCategoryId: string;
  skuLabel: string | null;
  sizeLabel: string | null;
  qty: number;
  colour: string | null;
  photoType: "Dispatch" | "Website" | null;
  photoUrl: string | null;
  tasselFringes: boolean;
  orderCurrency: string;
  orderValueOriginal: number;
};

/**
 * 2026-08-07: "Add More Item" — a buyer ordering more than one distinct
 * item (e.g. jute rug + cotton rug) in one sitting fills ONE buyer/date/
 * store section but N "Item" blocks. order-form.tsx keeps those N blocks
 * as ordinary React state (so Add/Remove is trivial) and serializes them
 * into a single hidden "items_json" field on submit — simpler and more
 * robust than trying to zip N parallel formData.getAll() arrays back
 * together (which breaks the moment a checkbox is unchecked, since
 * unchecked checkboxes don't appear in FormData at all). Each item becomes
 * its own `orders` row (that's the real grain of the table — see
 * schema.sql SECTION 5) sharing ONE base ref_no; the EXISTING buyer-batch
 * suffix mechanism below ("-position/total") is what turns that into
 * "PO-0001-1/2" / "PO-0001-2/2" — single item still gets zero suffix,
 * exactly as before, since suffixing only kicks in when the batch has 2+
 * rows total.
 */
function parseItems(formData: FormData): { items: ParsedItem[] | null; error: string | null } {
  const raw = str(formData, "items_json");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw || "[]");
  } catch {
    return { items: null, error: "Item data corrupt hai — page reload karke dobara try karo." };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { items: null, error: "Kam se kam ek item zaroori hai." };
  }

  const items: ParsedItem[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i] as Record<string, unknown>;
    const label = parsed.length > 1 ? `Item ${i + 1}: ` : "";
    const itemCategoryId = String(raw.itemCategoryId ?? "").trim();
    if (!itemCategoryId) return { items: null, error: `${label}Item Category zaroori hai.` };
    const qty = Number(raw.qty);
    if (!Number.isFinite(qty) || qty <= 0) return { items: null, error: `${label}Quantity 0 se zyada honi chahiye.` };
    const orderValueOriginal = Number(raw.orderValueOriginal);
    if (!Number.isFinite(orderValueOriginal) || orderValueOriginal < 0) {
      return { items: null, error: `${label}Order value sahi number honi chahiye.` };
    }
    const skuLabel = String(raw.skuLabel ?? "").trim();
    const sizeLabel = String(raw.sizeLabel ?? "").trim();
    const colour = String(raw.colour ?? "").trim();
    const photoType = String(raw.photoType ?? "").trim();
    const photoUrl = String(raw.photoUrl ?? "").trim();
    const orderCurrency = String(raw.orderCurrency ?? "").trim();
    items.push({
      itemCategoryId,
      skuLabel: skuLabel || null,
      sizeLabel,
      qty,
      colour: colour || null,
      photoType: photoType === "Dispatch" || photoType === "Website" ? photoType : null,
      photoUrl: photoUrl || null,
      tasselFringes: raw.tasselFringes === true,
      orderCurrency: orderCurrency || "USD",
      orderValueOriginal,
    });
  }
  return { items, error: null };
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
 *  - Multi-item ("Add More Item") — see parseItems() above.
 */
export async function createOrder(_prev: OrderFormState, formData: FormData): Promise<OrderFormState> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClient();

  const storeId = str(formData, "store_id");
  const orderDate = str(formData, "order_date");
  const marketplaceOrderNo = strOrNull(formData, "marketplace_order_no");
  const buyerNameAddress = strOrNull(formData, "buyer_name_address");
  const contactNo = strOrNull(formData, "contact_no");
  const manualRefNo = strOrNull(formData, "manual_ref_no");

  if (!storeId || !orderDate) {
    return { error: "Store aur order date zaroori hain.", success: null };
  }

  const { items, error: itemsError } = parseItems(formData);
  if (itemsError || !items) {
    return { error: itemsError ?? "Item details sahi nahi hain.", success: null };
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

  // 2026-08-07: "po,rf,rg no auto matic update ho lekin pahle data base me
  // chaek kare ki vo no use to nahi aara" — a manually-typed ref_no is
  // real user intent to use THAT exact number, so check it isn't already
  // in use before accepting it (the DB's UNIQUE(company_id, ref_no) would
  // eventually reject a true collision on insert anyway, but that's a raw
  // constraint error — this gives a clear Hindi message up front instead).
  if (baseRefNo) {
    const { data: clash } = await supabase
      .from("orders")
      .select("id")
      .eq("company_id", employee.currentCompanyId)
      .eq("ref_no_base", baseRefNo)
      .limit(1)
      .maybeSingle();
    if (clash) {
      return {
        error: `"${baseRefNo}" pehle se use ho raha hai — koi aur number likho, ya khali chhod do (isi buyer ka aaj ka order hai to auto-match ho jayega).`,
        success: null,
      };
    }
  }

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
    // The atomic counter (reserve_next_number) never hands out the same
    // number twice on its own, but a PREVIOUS manually-typed ref_no (step
    // above) could have used a number the counter hasn't reached yet —
    // when the counter later catches up to it, that would collide. Guard
    // against that here too: re-check the DB and reserve again (up to 5
    // tries) if the freshly-reserved number is somehow already in use,
    // rather than trusting the counter blindly.
    if (!baseRefNo) {
      for (let attempt = 0; attempt < 5 && !baseRefNo; attempt++) {
        const { data: num, error: reserveError } = await supabase.rpc("reserve_next_number", {
          p_company_id: employee.currentCompanyId,
          p_scope: "ORDER_REF",
          p_use_fy: false,
          p_as_of_date: orderDate,
        });
        if (reserveError || num == null) {
          return { error: "PO/RF/RG number reserve nahi ho paya — dobara try karo.", success: null };
        }
        const candidate = `${company.ref_prefix}-${String(num).padStart(4, "0")}`;
        const { data: clash } = await supabase
          .from("orders")
          .select("id")
          .eq("company_id", employee.currentCompanyId)
          .eq("ref_no_base", candidate)
          .limit(1)
          .maybeSingle();
        if (!clash) baseRefNo = candidate;
      }
      if (!baseRefNo) {
        return { error: "PO/RF/RG number reserve nahi ho paya (baar baar clash) — Admin ko batao.", success: null };
      }
    }
  }

  // If this base ref_no already has sibling row(s) today (batch reuse from
  // step 2, or a same-day dispatched-duplicate reuse), those siblings' OWN
  // ref_no values are currently still bare (e.g. "PO-0001") until the
  // recompute below runs — inserting a new row with that exact same bare
  // ref_no would collide with the UNIQUE (company_id, ref_no) constraint.
  // Insert each of THIS submission's items with a provisional-but-valid
  // suffix instead (matches the "-pos/total" shape so ref_no_base still
  // resolves to baseRefNo for the recompute query below); the recompute
  // immediately overwrites every row in the whole batch, including these,
  // with the real final suffixes. siblingCount is tracked in JS rather
  // than re-queried per item since this loop is the only writer for this
  // baseRefNo within a single request — any cross-request race is still
  // caught by the final recompute pass regardless.
  const { count: existingSiblingsToday } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("company_id", employee.currentCompanyId)
    .eq("order_date", orderDate)
    .eq("ref_no_base", baseRefNo);
  let siblingCount = existingSiblingsToday ?? 0;

  const poDate = strOrNull(formData, "po_date");
  const deliveryDate = strOrNull(formData, "delivery_date");
  const emailId = strOrNull(formData, "email_id");
  const taxId = strOrNull(formData, "tax_id");
  const addressType = (str(formData, "address_type") || "Residential") as "Residential" | "Commercial";
  const remark = strOrNull(formData, "remark");

  for (const item of items) {
    const conversion = await computeCurrencyConversion(supabase, item.orderCurrency, orderDate, item.orderValueOriginal);
    siblingCount += 1;
    const provisionalRefNo = siblingCount > 1 ? `${baseRefNo}-${siblingCount}/${siblingCount}` : baseRefNo;

    const { error: insertError } = await supabase.from("orders").insert({
      company_id: employee.currentCompanyId,
      store_id: storeId,
      order_date: orderDate,
      ref_no: provisionalRefNo,
      po_date: poDate,
      delivery_date: deliveryDate,
      marketplace_order_no: marketplaceOrderNo,
      photo_url: item.photoUrl,
      sku_label: item.skuLabel,
      size_label: item.sizeLabel ?? "",
      qty: item.qty,
      item_category_id: item.itemCategoryId,
      buyer_name_address: buyerNameAddress,
      contact_no: contactNo,
      email_id: emailId,
      tax_id: taxId,
      address_type: addressType,
      photo_type: item.photoType,
      colour: item.colour,
      remark,
      tassel_fringes: item.tasselFringes,
      entry_by_employee_id: employee.id,
      order_currency: item.orderCurrency,
      order_value_original: item.orderValueOriginal,
      order_value_usd: conversion.usd,
      order_value_inr: conversion.inr,
      exchange_rate_source: conversion.source,
    });

    if (insertError) {
      return { error: `Save nahi ho paya: ${insertError.message}`, success: null };
    }
  }

  // Recompute the buyer-batch suffix across every one of this buyer's
  // orders today, from scratch (matches the documented rule exactly) — the
  // row(s) we just inserted are included since they share baseRefNo.
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
