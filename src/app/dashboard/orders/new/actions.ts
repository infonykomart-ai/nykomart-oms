"use server";

import { requireCapability, type AuthedEmployee } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { buyerMatchKey } from "@/lib/orders/buyer-match";
import { parseCountryFromAddress } from "@/lib/geo/parse-country";
import { computeCurrencyConversion, type ConversionResult } from "@/lib/orders/currency";
import { notifyCompanion } from "@/lib/companion/notify";
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
    return { items: null, error: "Item data is corrupted — please reload the page and try again." };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return { items: null, error: "At least one item is required." };
  }

  const items: ParsedItem[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const raw = parsed[i] as Record<string, unknown>;
    const label = parsed.length > 1 ? `Item ${i + 1}: ` : "";
    const itemCategoryId = String(raw.itemCategoryId ?? "").trim();
    if (!itemCategoryId) return { items: null, error: `${label}Item Category is required.` };
    const qty = Number(raw.qty);
    if (!Number.isFinite(qty) || qty <= 0) return { items: null, error: `${label}Quantity must be greater than 0.` };
    const orderValueOriginal = Number(raw.orderValueOriginal);
    if (!Number.isFinite(orderValueOriginal) || orderValueOriginal < 0) {
      return { items: null, error: `${label}Order value must be a valid number.` };
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

type CreateOrderInput = {
  storeId: string;
  orderDate: string;
  marketplaceOrderNo: string | null;
  buyerNameAddress: string | null;
  contactNo: string | null;
  manualRefNo: string | null;
  poDate: string | null;
  deliveryDate: string | null;
  emailId: string | null;
  taxId: string | null;
  addressType: "Residential" | "Commercial";
  remark: string | null;
  items: ParsedItem[];
  // 2026-08-11 additions — see db/2026-08-11-order-tax-destination-fields.sql
  vatNumber: string | null;
  eoriNumber: string | null;
  iossNumber: string | null;
  destinationCountry: string | null;
  // 2026-08-20 — Gap 2 of the 5-gaps plan (see
  // claude/five-gaps-implementation-plan-2026-08-20.md): which vendor
  // Party this order's goods are LIKELY being purchased from, filled in at
  // order-entry time IF already known. Almost always unknown at entry (the
  // real vendor is usually only confirmed once their bill arrives — see
  // Purchase Bill's own required order_id link on the Orders hub), so this
  // stays optional and is more commonly set/edited later via the Orders
  // hub's inline edit — see order-edit-form.tsx. Column already existed in
  // schema.sql (orders.vendor_party_id) but was previously unused anywhere
  // in the app.
  vendorPartyId: string | null;
};

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

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
 *
 * 2026-08-08: extracted out of createOrder() so Bulk Order Entry via CSV
 * (task #62, bulkCreateOrders() below) can run the EXACT same logic once
 * per CSV row, instead of reimplementing any of this delicate
 * ref_no-batching behaviour independently. createOrder() is now a thin
 * FormData -> CreateOrderInput adapter around this.
 *
 * 2026-08-08 (later round): takes an explicit `companyId` param rather than
 * always using `employee.currentCompanyId` — needed so bulkCreateOrders()
 * can auto-detect each CSV row's company from its Store name (a single
 * upload can legitimately mix rows across all 3 companies, e.g. a combined
 * historical order-sheet export) instead of requiring the file be
 * pre-split per company. createOrder() (manual single-order entry) still
 * always passes employee.currentCompanyId — no behavior change there.
 * Callers MUST verify companyId is one the employee actually has access to
 * (employee.companyIds) before calling this — it is trusted, not re-checked
 * here, since createOrder() already gets it from the employee's own
 * session and bulkCreateOrders() checks it explicitly per row.
 */
// 2026-08-10: exported (was module-private) so the marketplace sync cron
// job (src/app/api/cron/sync-orders/route.ts) can reuse this EXACT logic
// for connector-created orders too — ref_no reservation, duplicate-buyer
// detection, and currency conversion must behave identically whether a
// human typed the order or the API fetched it. Do not duplicate this
// logic anywhere else.
export async function createOrderCore(
  employee: AuthedEmployee,
  supabase: ServiceClient,
  companyId: string,
  input: CreateOrderInput
): Promise<{ error: string | null; refNo: string | null }> {
  const { storeId, orderDate, marketplaceOrderNo, buyerNameAddress, contactNo, items } = input;

  if (!storeId || !orderDate) {
    return { error: "Store and order date are required.", refNo: null };
  }
  if (!items.length) {
    return { error: "At least one item is required.", refNo: null };
  }

  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id, ref_prefix")
    .eq("id", companyId)
    .single();
  if (companyError || !company) {
    return { error: "Company record not found — please contact Admin.", refNo: null };
  }

  const thisBuyerKey = buyerMatchKey(contactNo, buyerNameAddress);
  let baseRefNo: string | null = input.manualRefNo;

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
      .eq("company_id", companyId)
      .eq("ref_no_base", baseRefNo)
      .limit(1)
      .maybeSingle();
    if (clash) {
      return {
        error: `"${baseRefNo}" is already in use — enter a different number, or leave it blank (it will auto-match if this buyer already has an order today).`,
        refNo: null,
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
        .eq("company_id", companyId)
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
        .eq("company_id", companyId)
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
          p_company_id: companyId,
          p_scope: "ORDER_REF",
          p_use_fy: false,
          p_as_of_date: orderDate,
        });
        if (reserveError || num == null) {
          return { error: "Could not reserve a PO/RF/RG number — please try again.", refNo: null };
        }
        const candidate = `${company.ref_prefix}-${String(num).padStart(4, "0")}`;
        const { data: clash } = await supabase
          .from("orders")
          .select("id")
          .eq("company_id", companyId)
          .eq("ref_no_base", candidate)
          .limit(1)
          .maybeSingle();
        if (!clash) baseRefNo = candidate;
      }
      if (!baseRefNo) {
        return { error: "Could not reserve a PO/RF/RG number (repeated conflicts) — please notify Admin.", refNo: null };
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
    .eq("company_id", companyId)
    .eq("order_date", orderDate)
    .eq("ref_no_base", baseRefNo);
  let siblingCount = existingSiblingsToday ?? 0;

  const { poDate, deliveryDate, emailId, taxId, addressType, remark, vatNumber, eoriNumber, iossNumber, destinationCountry, vendorPartyId } = input;

  // 2026-08-17 performance fix — computeCurrencyConversion() can fall
  // through to an external HTTP call (api.frankfurter.app, 5s timeout) when
  // no Exchange Rate Master entry covers this order's date. Called once per
  // line item below, this could add up to ~5s PER ITEM to a single "Save
  // Order" click on a day with no cached rate — a 5-item order could hang
  // ~25s. The conversion result only depends on (currency, orderDate,
  // originalValue), and orderDate is fixed for this whole order, so cache
  // by (currency, originalValue) for the duration of this one request —
  // multiple line items in the same currency (the common case — most
  // orders are single-currency) now hit the network/RPC at most once each,
  // not once per item. Doesn't touch the sequential ref_no/siblingCount
  // logic below at all — same insert order, same suffixes, just the
  // conversion lookup itself is deduplicated.
  const conversionCache = new Map<string, Promise<ConversionResult>>();
  function cachedConversion(currency: string, originalValue: number): Promise<ConversionResult> {
    const key = `${currency}:${originalValue}`;
    let pending = conversionCache.get(key);
    if (!pending) {
      pending = computeCurrencyConversion(supabase, currency, orderDate, originalValue);
      conversionCache.set(key, pending);
    }
    return pending;
  }

  // 2026-08-22 — "order me address dalte hai vaha se automatic country
  // fatch ho jaye": derived ONCE per order (buyerNameAddress is the same
  // across every item in this loop), from the address text the buyer's
  // name/address field already carries — not a second field to fill in.
  // See src/lib/geo/parse-country.ts. '' (not null) when the parser can't
  // confidently resolve one, so Reports' fallback still reads it as
  // "(unknown)" while the one-time backfill (Admin > Backup Export) can
  // tell "not yet computed" (NULL, old rows) apart from "computed, no
  // match" ('') and never re-attempts the same unresolved row forever.
  const buyerCountry = parseCountryFromAddress(buyerNameAddress) ?? "";

  for (const item of items) {
    const conversion = await cachedConversion(item.orderCurrency, item.orderValueOriginal);
    siblingCount += 1;
    const provisionalRefNo = siblingCount > 1 ? `${baseRefNo}-${siblingCount}/${siblingCount}` : baseRefNo;

    const { error: insertError } = await supabase.from("orders").insert({
      company_id: companyId,
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
      buyer_country: buyerCountry,
      contact_no: contactNo,
      email_id: emailId,
      tax_id: taxId,
      address_type: addressType,
      vat_number: vatNumber,
      eori_number: eoriNumber,
      ioss_number: iossNumber,
      destination_country: destinationCountry,
      vendor_party_id: vendorPartyId,
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
      return { error: `Save failed: ${insertError.message}`, refNo: null };
    }
  }

  // Recompute the buyer-batch suffix across every one of this buyer's
  // orders today, from scratch (matches the documented rule exactly) — the
  // row(s) we just inserted are included since they share baseRefNo.
  const { data: batch } = await supabase
    .from("orders")
    .select("id, entry_timestamp")
    .eq("company_id", companyId)
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

  const finalRefNo = batch && batch.length > 1 ? `${baseRefNo} (batch of ${batch.length})` : baseRefNo!;

  // 2026-09-05 — AI Companion: "kisi ne order dala to vo kabhi left se
  // aakr bolegi congratulation order successfully save in OMS" — notifies
  // the employee who just entered the order (never blocks/slows this
  // return either way — see notify.ts's own try/catch).
  await notifyCompanion(supabase, {
    employeeId: employee.id,
    eventType: "order_placed",
    message: `Congratulations! Order ${finalRefNo} successfully saved in OMS 🎉`,
  });

  return { error: null, refNo: finalRefNo };
}

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
    return { error: "Store and order date are required.", success: null };
  }

  const { items, error: itemsError } = parseItems(formData);
  if (itemsError || !items) {
    return { error: itemsError ?? "Item details are invalid.", success: null };
  }

  const result = await createOrderCore(employee, supabase, employee.currentCompanyId, {
    storeId,
    orderDate,
    marketplaceOrderNo,
    buyerNameAddress,
    contactNo,
    manualRefNo,
    poDate: strOrNull(formData, "po_date"),
    deliveryDate: strOrNull(formData, "delivery_date"),
    emailId: strOrNull(formData, "email_id"),
    taxId: strOrNull(formData, "tax_id"),
    addressType: (str(formData, "address_type") || "Residential") as "Residential" | "Commercial",
    remark: strOrNull(formData, "remark"),
    items,
    vatNumber: strOrNull(formData, "vat_number"),
    eoriNumber: strOrNull(formData, "eori_number"),
    iossNumber: strOrNull(formData, "ioss_number"),
    destinationCountry: strOrNull(formData, "destination_country"),
    vendorPartyId: strOrNull(formData, "vendor_party_id"),
  });

  if (result.error) return { error: result.error, success: null };

  revalidatePath("/dashboard/orders/new");
  revalidatePath("/dashboard/orders");

  return { error: null, success: { refNo: result.refNo! } };
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

// ---------------------------------------------------------------------------
// Bulk Order Entry via CSV/Excel (2026-08-08, pending item 7 — "CSV se ek
// sath bahut sare orders enter kar sake"). Reuses createOrderCore() above
// row-by-row: each spreadsheet row is treated exactly like one manual "New
// Order" submission for a single item, so PO/RF/RG reservation, duplicate-
// dispatched reuse, and buyer-batch suffixing all behave identically to
// entering the same rows one at a time by hand. See bulk-upload/columns.ts
// for the exact column set (also drives the downloadable template).
// ---------------------------------------------------------------------------

export type BulkOrderRowResult = {
  row: number;
  refNo: string | null;
  error: string | null;
};

export type BulkOrderState = {
  error: string | null;
  results: BulkOrderRowResult[] | null;
};

const ADDRESS_TYPES = new Set(["Residential", "Commercial"]);
const PHOTO_TYPES = new Set(["Dispatch", "Website"]);
const MAX_BULK_ROWS = 200;

// 2026-08-08: short-code aliases seen in the real historical "NYKO ALL
// ORDER SHEET" export (Item Category column used old short codes like
// "JUTE"/"TUFTED"/"COTTON" instead of the current item_categories.name
// values) — tried as a fallback ONLY when the typed value doesn't match a
// real category name exactly. "JUTE" is genuinely ambiguous (both HAND
// BRAIDED JUTE RUG and HAND WOVEN JUTE RUG exist, and SKU prefixes don't
// reliably disambiguate which — checked against the real data) — user's
// 2026-08-08 decision: map it to HAND BRAIDED JUTE RUG, correct any
// individual rows that were actually woven by hand afterward.
const CATEGORY_ALIASES: Record<string, string> = {
  cotton: "handmade 100% cotton rug",
  jute: "hand braided jute rug",
  tufted: "hand tufted wool rug",
};

function normalizeHeader(h: string): string {
  return h.replace(/\*/g, "").trim().toLowerCase();
}

function cellStr(row: Record<string, unknown>, byHeader: Map<string, string>, label: string): string {
  const key = byHeader.get(normalizeHeader(label));
  if (!key) return "";
  const v = row[key];
  return v === null || v === undefined ? "" : String(v).trim();
}

export async function bulkCreateOrders(_prev: BulkOrderState, formData: FormData): Promise<BulkOrderState> {
  const employee = await requireCapability("order_entry");
  const supabase = createServiceRoleClient();

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a CSV or Excel file first.", results: null };
  }

  let rows: Record<string, unknown>[];
  let headerKeys: string[];
  try {
    const XLSX = await import("xlsx");
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false }) as Record<string, unknown>[];
    const headerRow = (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as string[][])[0];
    headerKeys = headerRow ?? (rows.length ? Object.keys(rows[0]) : []);
  } catch {
    return {
      error: "Could not read that file — make sure it's the CSV/Excel template, unmodified in structure.",
      results: null,
    };
  }

  if (!rows.length) {
    return { error: "No data rows found in the file.", results: null };
  }
  if (rows.length > MAX_BULK_ROWS) {
    return { error: `${rows.length} rows — please upload ${MAX_BULK_ROWS} or fewer at a time.`, results: null };
  }

  const byHeader = new Map<string, string>();
  for (const k of headerKeys) byHeader.set(normalizeHeader(k), k);

  // 2026-08-08: stores fetched across EVERY company the employee has
  // access to (not just the currently-selected one) — a single upload can
  // legitimately mix rows from all 3 companies (e.g. a combined historical
  // order-sheet export with "Amazon Rugara", "Etsy Casa Arra", "Amazon
  // Arts of Jaipur" rows all in one file). Each row's company is
  // auto-detected from its Store name below; createOrderCore is called
  // with THAT row's company, not employee.currentCompanyId.
  const [{ data: stores }, { data: itemCategories }] = await Promise.all([
    supabase.from("stores").select("id, name, company_id").in("company_id", employee.companyIds),
    supabase.from("item_categories").select("id, name"),
  ]);
  const storeByName = new Map((stores ?? []).map((s) => [s.name.trim().toLowerCase(), { id: s.id, companyId: s.company_id }]));
  const categoryIdByName = new Map((itemCategories ?? []).map((c) => [c.name.trim().toLowerCase(), c.id]));

  const results: BulkOrderRowResult[] = [];

  // Sequential, NOT Promise.all/parallel — createOrderCore reads and writes
  // the buyer-batch ref_no state (siblings today for this base ref_no) as
  // it goes, per its own comments above, so rows for the same buyer/date
  // must be processed one at a time, in submitted order, for the
  // "-1/2, -2/2" suffixing (and duplicate-dispatched reuse) to come out
  // right — exactly as if someone had typed them into the form one by one.
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const rowNum = i + 2; // header is row 1 in the file

    const storeName = cellStr(raw, byHeader, "Store");
    const orderDate = cellStr(raw, byHeader, "Order Date");
    const itemCategoryName = cellStr(raw, byHeader, "Item Category");
    const qtyStr = cellStr(raw, byHeader, "Qty");
    const valueStr = cellStr(raw, byHeader, "Order Value");
    const currency = cellStr(raw, byHeader, "Currency");

    const store = storeByName.get(storeName.toLowerCase());
    if (!storeName || !store) {
      results.push({ row: rowNum, refNo: null, error: `Store "${storeName || "(blank)"}" not found in any of your companies.` });
      continue;
    }
    const storeId = store.id;
    if (!orderDate) {
      results.push({ row: rowNum, refNo: null, error: "Order Date is required (YYYY-MM-DD)." });
      continue;
    }
    const itemCategoryId =
      categoryIdByName.get(itemCategoryName.toLowerCase()) ??
      categoryIdByName.get(CATEGORY_ALIASES[itemCategoryName.toLowerCase()] ?? "");
    if (!itemCategoryName || !itemCategoryId) {
      results.push({ row: rowNum, refNo: null, error: `Item Category "${itemCategoryName || "(blank)"}" not found.` });
      continue;
    }
    const qty = Number(qtyStr);
    if (!Number.isFinite(qty) || qty <= 0) {
      results.push({ row: rowNum, refNo: null, error: "Qty must be a number greater than 0." });
      continue;
    }
    const orderValueOriginal = Number(valueStr);
    if (!Number.isFinite(orderValueOriginal) || orderValueOriginal < 0) {
      results.push({ row: rowNum, refNo: null, error: "Order Value must be a valid number." });
      continue;
    }
    if (!currency) {
      results.push({ row: rowNum, refNo: null, error: "Currency is required (e.g. USD, INR)." });
      continue;
    }

    const photoTypeRaw = cellStr(raw, byHeader, "Photo Type");
    const addressTypeRaw = cellStr(raw, byHeader, "Address Type");
    const tasselRaw = cellStr(raw, byHeader, "Tassel/Fringes").toLowerCase();

    const item: ParsedItem = {
      itemCategoryId,
      skuLabel: cellStr(raw, byHeader, "SKU") || null,
      sizeLabel: cellStr(raw, byHeader, "Size"),
      qty,
      colour: cellStr(raw, byHeader, "Colour") || null,
      photoType: PHOTO_TYPES.has(photoTypeRaw) ? (photoTypeRaw as "Dispatch" | "Website") : null,
      photoUrl: cellStr(raw, byHeader, "Photo URL") || null,
      tasselFringes: tasselRaw === "yes" || tasselRaw === "y" || tasselRaw === "true",
      orderCurrency: currency,
      orderValueOriginal,
    };

    const result = await createOrderCore(employee, supabase, store.companyId, {
      storeId,
      orderDate,
      marketplaceOrderNo: cellStr(raw, byHeader, "Marketplace Order No") || null,
      buyerNameAddress: cellStr(raw, byHeader, "Buyer Name & Address") || null,
      contactNo: cellStr(raw, byHeader, "Contact No") || null,
      manualRefNo: cellStr(raw, byHeader, "Manual Ref No") || null,
      poDate: cellStr(raw, byHeader, "PO Date") || null,
      deliveryDate: cellStr(raw, byHeader, "Delivery Date") || null,
      emailId: cellStr(raw, byHeader, "Email") || null,
      taxId: cellStr(raw, byHeader, "Tax ID") || null,
      addressType: ADDRESS_TYPES.has(addressTypeRaw) ? (addressTypeRaw as "Residential" | "Commercial") : "Residential",
      remark: cellStr(raw, byHeader, "Remark") || null,
      vatNumber: cellStr(raw, byHeader, "VAT Number") || null,
      eoriNumber: cellStr(raw, byHeader, "EORI Number") || null,
      iossNumber: cellStr(raw, byHeader, "IOSS Number") || null,
      destinationCountry: cellStr(raw, byHeader, "Destination Country") || null,
      vendorPartyId: null, // not a CSV column — vendor is set/edited later via the Orders hub, see Gap 2 note above.
      items: [item],
    });

    results.push({ row: rowNum, refNo: result.refNo, error: result.error });
  }

  revalidatePath("/dashboard/orders");
  revalidatePath("/dashboard/orders/new");

  return { error: null, results };
}

// ============================================================================
// Inventory / Stock — pending item 4 (2026-08-08). Scope confirmed with the
// user: auto-restock (see saveOrderRefund in ../actions.ts, which writes to
// finished_stock when a refunded order already had a Purchase entry) PLUS
// this informational stock-check popup at order entry — no manual Stock
// In/Out for finished goods, that's out of scope for now. See
// db/2026-08-08-inventory-finished-stock.sql for the finished_stock table
// (a separate code space from the existing raw-material stock_items/
// stock_in/stock_out module, per that module's own schema comment).
// ============================================================================

export type StockCheckResult = { qty: number };

/**
 * Informational only — "agar stock me hai to popup dikhe, blocker nahi".
 * Keyed the same way finished_stock is: item_category_id + sku_label +
 * size_label (case-insensitive on the text fields, matching how orders
 * themselves store these as free text — see EditableOrder's sku_label/
 * size_label fallback pattern).
 */
export async function checkFinishedStockAction(
  itemCategoryId: string,
  skuLabel: string,
  sizeLabel: string
): Promise<StockCheckResult> {
  await requireCapability("order_entry");
  if (!itemCategoryId) return { qty: 0 };
  const supabase = createServiceRoleClient();

  const { data } = await supabase
    .from("finished_stock")
    .select("qty")
    .eq("item_category_id", itemCategoryId)
    .ilike("sku_label", skuLabel.trim())
    .ilike("size_label", sizeLabel.trim())
    .maybeSingle();

  return { qty: data ? Number(data.qty) : 0 };
}
