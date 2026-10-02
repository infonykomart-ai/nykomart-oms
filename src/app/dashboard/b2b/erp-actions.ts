"use server";

// 2026-10-02d — B2B Export ERP server actions, part 1: product master (auto
// SKU), BOM, buyer CRM, the quotation costing engine, and the follow-up
// queue. Part 2 (orders / production / QC / shipments) lives in
// ./ops-actions.ts. Every action: requireCapability("b2b_inquiry") first,
// then company-scope guards against the caller's own companyIds (the same
// posture as ./actions.ts), audit log after a successful write, and one
// revalidatePath("/dashboard/b2b", "layout") so every child page refreshes.
//
// "use server" rule: only async function exports (type exports are erased
// and fine) — shared CONSTANTS live in @/lib/b2b/erp instead.
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logAudit } from "@/lib/audit/log-audit";
import { revalidatePath } from "next/cache";
import { todayIST } from "@/lib/attendance/ist-date";
import { computeCosting, formatSku, PRODUCT_TYPES, SKU_PREFIX, type ProductType } from "@/lib/b2b/erp";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type SaveResult = { ok: true; id: string } | { ok: false; error: string };

function num(v: string | number | undefined | null): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = Number(v ?? "");
  return Number.isFinite(n) ? n : 0;
}

function revalidateB2B() {
  revalidatePath("/dashboard/b2b", "layout");
}

// ── numbering (same reserve_next_number RPC + FY label as ./actions.ts) ─────
async function reserveNo(
  supabase: ServiceClient,
  companyId: string,
  scope: string,
  prefix: string,
  asOfDate: string,
  opts?: { skuStyle?: boolean }
): Promise<{ no: string | null; error: string | null }> {
  const fy = await supabase.rpc("fy_label", { p_date: asOfDate });
  if (fy.error) return { no: null, error: `Numbering failed: ${fy.error.message}` };
  const n = await supabase.rpc("reserve_next_number", {
    p_company_id: companyId,
    p_scope: scope,
    p_use_fy: false,
    p_as_of_date: asOfDate,
  });
  if (n.error) return { no: null, error: `Numbering failed: ${n.error.message}` };
  const no = opts?.skuStyle ? formatSku(prefix, n.data) : `${prefix}-${fy.data}-${String(n.data).padStart(4, "0")}`;
  return { no, error: null };
}

// ═══════════════════════════════ Products ══════════════════════════════════

export type ProductInput = {
  productId?: string;
  sku?: string; // blank → auto-generate CD-1001 style
  name: string;
  productType: string;
  category?: string;
  collection?: string;
  material?: string;
  design?: string;
  color?: string;
  sizeLabel?: string;
  lengthCm?: string;
  widthCm?: string;
  gsm?: string;
  pieceWeightKg?: string;
  specs?: Record<string, string>;
  unit?: string;
  moq?: string;
  productionDays?: string;
  packingType?: string;
  piecesPerCarton?: string;
  cartonLengthCm?: string;
  cartonWidthCm?: string;
  cartonHeightCm?: string;
  fobPrice?: string;
  exwPrice?: string;
  wholesalePrice?: string;
  costPrice?: string;
  stockQty?: string;
  minStockQty?: string;
  active?: boolean;
};

export async function saveProduct(input: ProductInput): Promise<SaveResult> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const name = (input.name || "").trim();
  const type = PRODUCT_TYPES.find((t) => t === input.productType);
  if (!name) return { ok: false, error: "Product name is required." };
  if (!type) return { ok: false, error: "Pick one of the five product types." };

  // Existing row (update path) — company-guarded.
  let existing: { id: string; company_id: string; sku: string } | null = null;
  if (input.productId) {
    const { data, error } = await supabase
      .from("b2b_products")
      .select("id, company_id, sku")
      .eq("id", input.productId)
      .in("company_id", me.companyIds)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: "Product not found in your companies." };
    existing = data;
  }

  // SKU: explicit (validated unique per company by the DB) or auto-reserved
  // as PREFIX-1001 style (counter + 1000, formatSku).
  let sku = (input.sku || "").trim();
  if (!sku && !existing) {
    const prefix = SKU_PREFIX[type as ProductType];
    const reserved = await reserveNo(supabase, me.currentCompanyId, `B2B_SKU_${prefix}`, prefix, todayIST(), {
      skuStyle: true,
    });
    if (!reserved.no) return { ok: false, error: reserved.error ?? "SKU generation failed." };
    sku = reserved.no;
  }
  if (!sku && existing) sku = existing.sku;

  const row = {
    sku,
    name,
    product_type: type,
    category: input.category?.trim() || null,
    collection: input.collection?.trim() || null,
    material: input.material?.trim() || null,
    design: input.design?.trim() || null,
    color: input.color?.trim() || null,
    size_label: input.sizeLabel?.trim() || null,
    length_cm: num(input.lengthCm) || null,
    width_cm: num(input.widthCm) || null,
    gsm: num(input.gsm) || null,
    piece_weight_kg: num(input.pieceWeightKg) || null,
    specs: (input.specs ?? {}) as Record<string, string>,
    unit: input.unit?.trim() || "pcs",
    moq: Math.round(num(input.moq)),
    production_days: Math.round(num(input.productionDays)),
    packing_type: input.packingType?.trim() || null,
    pieces_per_carton: Math.round(num(input.piecesPerCarton)),
    carton_length_cm: num(input.cartonLengthCm) || null,
    carton_width_cm: num(input.cartonWidthCm) || null,
    carton_height_cm: num(input.cartonHeightCm) || null,
    fob_price: num(input.fobPrice),
    exw_price: num(input.exwPrice),
    wholesale_price: num(input.wholesalePrice),
    cost_price: num(input.costPrice),
    min_stock_qty: Math.round(num(input.minStockQty)),
    active: input.active ?? true,
    updated_at: new Date().toISOString(),
  };

  if (existing) {
    const { error } = await supabase.from("b2b_products").update(row).eq("id", existing.id);
    if (error) return { ok: false, error: productError(error, name) };
    await logAudit(supabase, {
      companyId: me.currentCompanyId,
      employeeId: me.id,
      employeeName: me.name,
      action: "b2b_product.updated",
      entityType: "b2b_product",
      entityId: existing.id,
      entityLabel: sku,
      changes: { name },
    });
    revalidateB2B();
    return { ok: true, id: existing.id };
  }

  const insert = {
    ...row,
    company_id: me.currentCompanyId,
    stock_qty: Math.round(num(input.stockQty)),
    entered_by_employee_id: me.id,
  };
  const { data, error } = await supabase.from("b2b_products").insert(insert).select("id").single();
  if (error) return { ok: false, error: productError(error, name) };
  await logAudit(supabase, {
    companyId: me.currentCompanyId,
    employeeId: me.id,
    employeeName: me.name,
    action: "b2b_product.created",
    entityType: "b2b_product",
    entityId: data.id,
    entityLabel: sku,
  });
  revalidateB2B();
  return { ok: true, id: data.id };
}

function productError(error: { code?: string | null; message: string }, name: string): string {
  if (error.code === "23505" || /duplicate/i.test(error.message)) return `SKU already exists for this company (used by "${name}").`;
  return error.message;
}

export async function adjustProductStock(productId: string, delta: number, remark?: string): Promise<SaveResult> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const { data: product, error } = await supabase
    .from("b2b_products")
    .select("id, company_id, sku, stock_qty")
    .eq("id", productId)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!product) return { ok: false, error: "Product not found in your companies." };
  const next = Math.max(0, Math.round(product.stock_qty + (Number.isFinite(delta) ? delta : 0)));
  const { error: upd } = await supabase
    .from("b2b_products")
    .update({ stock_qty: next, updated_at: new Date().toISOString() })
    .eq("id", productId);
  if (upd) return { ok: false, error: upd.message };
  await logAudit(supabase, {
    companyId: me.currentCompanyId,
    employeeId: me.id,
    employeeName: me.name,
    action: "b2b_product.stock_adjusted",
    entityType: "b2b_product",
    entityId: productId,
    entityLabel: product.sku,
    changes: { from: product.stock_qty, to: next, remark: remark ?? "" },
  });
  revalidateB2B();
  return { ok: true, id: productId };
}

// ═══════════════════════════════ BOM ═══════════════════════════════════════

export type BomItemInput = { material: string; consumption: string; unit: string; wastagePercent: string };

export async function saveBomItems(productId: string, items: BomItemInput[]): Promise<SaveResult> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const { data: product, error } = await supabase
    .from("b2b_products")
    .select("id, company_id, sku")
    .eq("id", productId)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!product) return { ok: false, error: "Product not found in your companies." };

  const rows = items
    .filter((i) => i.material.trim())
    .map((i, idx) => ({
      company_id: me.currentCompanyId,
      product_id: productId,
      material: i.material.trim(),
      consumption: Math.max(0.001, num(i.consumption)),
      unit: i.unit.trim() || "pcs",
      wastage_percent: Math.max(0, num(i.wastagePercent)),
      display_order: idx,
    }));

  const { error: del } = await supabase.from("b2b_bom_items").delete().eq("product_id", productId);
  if (del) return { ok: false, error: del.message };
  if (rows.length > 0) {
    const { error: ins } = await supabase.from("b2b_bom_items").insert(rows);
    if (ins) return { ok: false, error: ins.message };
  }
  await logAudit(supabase, {
    companyId: me.currentCompanyId,
    employeeId: me.id,
    employeeName: me.name,
    action: "b2b_bom.saved",
    entityType: "b2b_product",
    entityId: productId,
    entityLabel: product.sku,
    changes: { lines: rows.length },
  });
  revalidateB2B();
  return { ok: true, id: productId };
}

// ═══════════════════════════════ Buyers ════════════════════════════════════

export type BuyerInput = {
  buyerId?: string;
  name: string;
  contactPerson?: string;
  email?: string;
  phone?: string;
  country?: string;
  city?: string;
  website?: string;
  buyerType?: string;
  currency?: string;
  paymentTerms?: string;
  shippingTerms?: string;
  salesperson?: string;
  notes?: string;
  active?: boolean;
};

const BUYER_TYPES_SET = ["Retailer", "Wholesaler", "Importer", "Distributor"] as const;
type BuyerType = (typeof BUYER_TYPES_SET)[number];
function asBuyerType(v: string | undefined): BuyerType {
  return (BUYER_TYPES_SET as readonly string[]).includes(v ?? "") ? (v as BuyerType) : "Wholesaler";
}
function asFollowupEntity(v: string): "Buyer" | "Inquiry" | "Quotation" | "Order" | "Shipment" {
  return v as "Buyer" | "Inquiry" | "Quotation" | "Order" | "Shipment";
}

export async function saveBuyer(input: BuyerInput): Promise<SaveResult> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const name = (input.name || "").trim();
  if (!name) return { ok: false, error: "Buyer / company name is required." };

  const row = {
    name,
    contact_person: input.contactPerson?.trim() || null,
    email: input.email?.trim() || null,
    phone: input.phone?.trim() || null,
    country: input.country?.trim() || null,
    city: input.city?.trim() || null,
    website: input.website?.trim() || null,
    buyer_type: asBuyerType(input.buyerType),
    currency: (input.currency || "USD").toUpperCase().slice(0, 3),
    payment_terms: input.paymentTerms?.trim() || null,
    shipping_terms: input.shippingTerms?.trim() || null,
    salesperson: input.salesperson?.trim() || null,
    notes: input.notes?.trim() || null,
    active: input.active ?? true,
    updated_at: new Date().toISOString(),
  };

  if (input.buyerId) {
    const { data } = await supabase
      .from("b2b_buyers")
      .select("id")
      .eq("id", input.buyerId)
      .in("company_id", me.companyIds)
      .maybeSingle();
    if (!data) return { ok: false, error: "Buyer not found in your companies." };
    const { error } = await supabase.from("b2b_buyers").update(row).eq("id", input.buyerId);
    if (error) return { ok: false, error: buyerError(error) };
    await logAudit(supabase, {
      companyId: me.currentCompanyId,
      employeeId: me.id,
      employeeName: me.name,
      action: "b2b_buyer.updated",
      entityType: "b2b_buyer",
      entityId: input.buyerId,
      entityLabel: name,
    });
    revalidateB2B();
    return { ok: true, id: input.buyerId };
  }

  const { data, error } = await supabase
    .from("b2b_buyers")
    .insert({ ...row, company_id: me.currentCompanyId, entered_by_employee_id: me.id })
    .select("id")
    .single();
  if (error) return { ok: false, error: buyerError(error) };
  await logAudit(supabase, {
    companyId: me.currentCompanyId,
    employeeId: me.id,
    employeeName: me.name,
    action: "b2b_buyer.created",
    entityType: "b2b_buyer",
    entityId: data.id,
    entityLabel: name,
  });
  revalidateB2B();
  return { ok: true, id: data.id };
}

function buyerError(error: { code?: string | null; message: string }): string {
  if (error.code === "23505" || /duplicate/i.test(error.message)) return "A buyer with this name already exists for this company.";
  return error.message;
}

// ═════════════════════════ Quotation costing engine ════════════════════════
// Saves the ENGINE's numbers onto the inquiry's 1:1 quotation (creating it
// when missing): line items (product + qty + prices), the cost-side columns
// (packing/freight/other/discount/cost_amount), FX snapshot, incoterm and
// buyer link. Gross profit / margin are NOT stored — every reader recomputes
// from these inputs via computeCosting(), so a later price edit can never
// leave a stale profit behind.

export type EngineLineInput = {
  productId?: string | null;
  description: string;
  qty: string;
  unit?: string;
  unitPrice: string;
  unitCost: string;
};

export type EngineQuotationInput = {
  inquiryId: string;
  buyerId?: string;
  currency: string;
  exchangeRate?: string;
  incoterm?: string;
  taxPercent?: string;
  shippingAmount?: string; // freight charged TO the buyer (register's own column)
  discount?: string;
  packingCost?: string;
  freightCost?: string; // our freight cost — entered, never guessed
  otherCosts?: string;
  validFrom?: string;
  validUntil?: string;
  lines: EngineLineInput[];
};

export async function saveEngineQuotation(input: EngineQuotationInput): Promise<SaveResult & { quoteNo?: string }> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();

  const { data: inquiry, error: inqErr } = await supabase
    .from("b2b_inquiries")
    .select("id, company_id, inquiry_no, inquiry_date, buyer_name, buyer_contact_no, buyer_email, buyer_country, buyer_id")
    .eq("id", input.inquiryId)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (inqErr) return { ok: false, error: inqErr.message };
  if (!inquiry) return { ok: false, error: "Inquiry not found in your companies." };

  const lines = input.lines.filter((l) => l.description.trim() && num(l.qty) > 0);
  if (lines.length === 0) return { ok: false, error: "Add at least one line with a description and qty." };

  const subtotal = Math.round(lines.reduce((s, l) => s + num(l.qty) * num(l.unitPrice), 0) * 100) / 100;
  const costing = computeCosting({
    lines: lines.map((l) => ({ qty: num(l.qty), unitCost: num(l.unitCost), unitPrice: num(l.unitPrice) })),
    packingCost: num(input.packingCost),
    freight: num(input.freightCost),
    otherCosts: num(input.otherCosts),
    discount: num(input.discount),
  });

  const engineCols = {
    buyer_id: input.buyerId || inquiry.buyer_id || null,
    incoterm: input.incoterm?.trim() || null,
    exchange_rate: Math.max(0.000001, num(input.exchangeRate) || 1),
    discount_amount: costing.discount,
    packing_costs: costing.packingCost,
    freight_amount: costing.freightCost,
    other_costs: costing.otherCosts,
    cost_amount: costing.totalCost,
    valid_from: input.validFrom || null,
    valid_until: input.validUntil || null,
    currency: (input.currency || "INR").toUpperCase().slice(0, 3),
    tax_percent: Math.max(0, num(input.taxPercent)),
    shipping_amount: Math.max(0, num(input.shippingAmount)),
    subtotal,
    updated_at: new Date().toISOString(),
  };

  // Existing quotation for this inquiry? (inquiry_id is UNIQUE)
  const { data: existing, error: qErr } = await supabase
    .from("b2b_quotations")
    .select("id, quote_no, company_id")
    .eq("inquiry_id", inquiry.id)
    .maybeSingle();
  if (qErr) return { ok: false, error: qErr.message };

  let quotationId: string;
  let quoteNo: string;

  if (existing) {
    if (existing.company_id !== me.currentCompanyId && !me.companyIds.includes(existing.company_id)) {
      return { ok: false, error: "Quotation not found in your companies." };
    }
    const { error } = await supabase.from("b2b_quotations").update(engineCols).eq("id", existing.id);
    if (error) return { ok: false, error: error.message };
    quotationId = existing.id;
    quoteNo = existing.quote_no;
  } else {
    const reserved = await reserveNo(supabase, me.currentCompanyId, "B2B_QUOTE", "Q", inquiry.inquiry_date);
    if (!reserved.no) return { ok: false, error: reserved.error ?? "Quotation numbering failed." };
    quoteNo = reserved.no;
    const { data: created, error } = await supabase
      .from("b2b_quotations")
      .insert({
        inquiry_id: inquiry.id,
        company_id: me.currentCompanyId,
        quote_no: quoteNo,
        quote_date: todayIST(),
        buyer_name: inquiry.buyer_name,
        buyer_contact_no: inquiry.buyer_contact_no,
        buyer_email: inquiry.buyer_email,
        buyer_country: inquiry.buyer_country,
        terms: null,
        notes: null,
        entered_by_employee_id: me.id,
        ...engineCols,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    quotationId = created.id;
  }

  // Replace line items (engine owns the item rows).
  const { error: del } = await supabase.from("b2b_quotation_items").delete().eq("quotation_id", quotationId);
  if (del) return { ok: false, error: del.message };
  const itemRows = lines.map((l, idx) => ({
    quotation_id: quotationId,
    description: l.description.trim(),
    qty: num(l.qty),
    unit: l.unit?.trim() || "pcs",
    unit_price: Math.max(0, num(l.unitPrice)),
    display_order: idx,
  }));
  const { error: ins } = await supabase.from("b2b_quotation_items").insert(itemRows);
  if (ins) return { ok: false, error: ins.message };

  // Remember the structured buyer + product links on the inquiry side.
  if (input.buyerId) {
    await supabase.from("b2b_inquiries").update({ buyer_id: input.buyerId }).eq("id", inquiry.id);
  }

  await logAudit(supabase, {
    companyId: me.currentCompanyId,
    employeeId: me.id,
    employeeName: me.name,
    action: "b2b_quotation.engine_saved",
    entityType: "b2b_quotation",
    entityId: quotationId,
    entityLabel: quoteNo,
    changes: { subtotal, cost: costing.totalCost, margin: costing.marginPct },
  });
  revalidateB2B();
  return { ok: true, id: quotationId, quoteNo };
}

// ═══════════════════════════ Follow-ups ════════════════════════════════════

export type FollowupInput = {
  entityType: string;
  entityId: string;
  entityLabel?: string;
  dueDate: string;
  note?: string;
};

const FOLLOWUP_ENTITIES = ["Buyer", "Inquiry", "Quotation", "Order", "Shipment"];

export async function createFollowup(input: FollowupInput): Promise<SaveResult> {
  const me = await requireCapability("b2b_inquiry");
  if (!FOLLOWUP_ENTITIES.includes(input.entityType)) return { ok: false, error: "Unknown follow-up target." };
  if (!input.entityId || !input.dueDate) return { ok: false, error: "Follow-up needs a target and a due date." };
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("b2b_followups")
    .insert({
      company_id: me.currentCompanyId,
      entity_type: asFollowupEntity(input.entityType),
      entity_id: input.entityId,
      entity_label: input.entityLabel?.trim() || null,
      due_date: input.dueDate,
      note: input.note?.trim() || null,
      entered_by_employee_id: me.id,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidateB2B();
  return { ok: true, id: data.id };
}

export async function completeFollowup(id: string): Promise<SaveResult> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("b2b_followups")
    .select("id")
    .eq("id", id)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (!data) return { ok: false, error: "Follow-up not found in your companies." };
  const { error } = await supabase.from("b2b_followups").update({ done: true, done_at: new Date().toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateB2B();
  return { ok: true, id };
}

export async function deleteFollowup(id: string): Promise<SaveResult> {
  const me = await requireCapability("b2b_inquiry");
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("b2b_followups")
    .select("id")
    .eq("id", id)
    .in("company_id", me.companyIds)
    .maybeSingle();
  if (!data) return { ok: false, error: "Follow-up not found in your companies." };
  const { error } = await supabase.from("b2b_followups").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidateB2B();
  return { ok: true, id };
}
