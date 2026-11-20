"use server";

// Server actions for the Inventory module. Every action re-checks the
// employee's capability before touching data (never trust a hidden button),
// then delegates to a PostgreSQL function through src/lib/inventory/service.ts.
// Success/error messages travel back as query parameters so the pages stay
// server-rendered — no client component is needed to show a result.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import {
  adjustStock,
  cancelChallan,
  closePurchaseRequirement,
  completeManufacturing,
  completeProcessing,
  createChallan,
  deleteCategorySettings,
  deleteProduct,
  deleteVariant,
  deleteWarehouse,
  issueChallan,
  markChallanDispatched,
  moveQcStock,
  postStockInward,
  releaseReservation,
  reserveStock,
  resolveOrderByRef,
  saveCategorySettings,
  saveProduct,
  saveVariant,
  saveWarehouse,
  startManufacturing,
  startProcessing,
} from "@/lib/inventory/service";
import type { ChallanLineInput } from "@/lib/inventory/service";
import type { InventoryStage, StockSource } from "@/lib/inventory/stages";

const BASE = "/dashboard/inventory";

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}
function num(formData: FormData, key: string, fallback = 0): number {
  const raw = str(formData, key);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}
function numOrNull(formData: FormData, key: string): number | null {
  const raw = str(formData, key);
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
function checked(formData: FormData, key: string): boolean {
  return formData.get(key) !== null && formData.get(key) !== "false";
}

function safeTarget(formData: FormData, fallback: string): string {
  const target = str(formData, "return_to");
  return target.startsWith(BASE) ? target : fallback;
}

function done(target: string, message: string): never {
  const params = new URLSearchParams({ ok: message });
  redirect(`${target}?${params.toString()}`);
}

function failed(target: string, message: string): never {
  const params = new URLSearchParams({ error: message });
  redirect(`${target}?${params.toString()}`);
}

// ---------------------------------------------------------------------------
// Stock
// ---------------------------------------------------------------------------

export async function inwardAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_manage");
  const target = safeTarget(formData, `${BASE}/stock`);
  const db = createServiceRoleClientUnchecked();

  const result = await postStockInward(db, {
    companyId: employee.currentCompanyId,
    variantId: str(formData, "variant_id"),
    warehouseId: str(formData, "warehouse_id"),
    stage: (str(formData, "stage") || "READY") as InventoryStage,
    source: (str(formData, "source") || "MANUAL") as StockSource,
    pcs: num(formData, "pcs"),
    sqft: numOrNull(formData, "sqft"),
    reference: str(formData, "reference") || null,
    remarks: str(formData, "remarks") || null,
    idempotencyKey: str(formData, "idempotency_key") || null,
    actorId: employee.id,
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, `Stock received — ${result.data!.pcs} PCS / ${result.data!.sqft} SQ FT now on hand.`);
}

export async function adjustmentAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_manage");
  const target = safeTarget(formData, `${BASE}/stock`);
  const db = createServiceRoleClientUnchecked();

  const result = await adjustStock(db, {
    companyId: employee.currentCompanyId,
    variantId: str(formData, "variant_id"),
    warehouseId: str(formData, "warehouse_id"),
    stage: (str(formData, "stage") || "READY") as InventoryStage,
    pcsDelta: num(formData, "pcs_delta"),
    sqftDelta: num(formData, "sqft_delta"),
    reason: str(formData, "reason"),
    remarks: str(formData, "remarks"),
    actorId: employee.id,
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, "Correction posted to the ledger.");
}

export async function qcAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_manage");
  const target = safeTarget(formData, `${BASE}/stock`);
  const db = createServiceRoleClientUnchecked();

  const result = await moveQcStock(db, {
    companyId: employee.currentCompanyId,
    variantId: str(formData, "variant_id"),
    warehouseId: str(formData, "warehouse_id"),
    pcs: num(formData, "pcs"),
    sqft: numOrNull(formData, "sqft"),
    accept: str(formData, "decision") === "ACCEPT",
    remarks: str(formData, "remarks") || null,
    actorId: employee.id,
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, str(formData, "decision") === "ACCEPT" ? "QC accepted — stock moved to READY." : "QC rejected — stock tracked separately.");
}

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

export async function reserveAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_manage");
  const target = safeTarget(formData, `${BASE}/reservations`);
  const db = createServiceRoleClientUnchecked();

  const orderRef = str(formData, "order_ref");
  const lookup = await resolveOrderByRef(db, employee.currentCompanyId, orderRef);
  if (lookup.error || !lookup.order) failed(target, lookup.error ?? "Order not found.");

  const result = await reserveStock(db, {
    orderId: lookup.order!.id,
    variantId: str(formData, "variant_id"),
    warehouseId: str(formData, "warehouse_id"),
    pcs: num(formData, "pcs"),
    sqft: numOrNull(formData, "sqft"),
    actorId: employee.id,
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, `Reserved for ${lookup.order!.ref_no} — ${result.data!.availableAfter} PCS still free.`);
}

export async function releaseAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_manage");
  const target = safeTarget(formData, `${BASE}/reservations`);
  const db = createServiceRoleClientUnchecked();

  const result = await releaseReservation(db, {
    reservationId: str(formData, "reservation_id"),
    companyId: employee.currentCompanyId,
    reason: str(formData, "reason"),
    actorId: employee.id,
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, "Reservation released — stock is available again.");
}

// ---------------------------------------------------------------------------
// Challans
// ---------------------------------------------------------------------------

export async function challanCreateAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_dispatch");
  const target = safeTarget(formData, `${BASE}/challans`);
  const db = createServiceRoleClientUnchecked();

  const variants = formData.getAll("line_variant_id").map((v) => String(v));
  const warehouses = formData.getAll("line_warehouse_id").map((v) => String(v));
  const orderRefs = formData.getAll("line_order_ref").map((v) => String(v).trim());
  const pcsValues = formData.getAll("line_pcs").map((v) => Number(v));
  const sqftValues = formData.getAll("line_sqft").map((v) => Number(v));

  const lines: ChallanLineInput[] = [];
  for (let i = 0; i < variants.length; i++) {
    if (!variants[i] || !Number.isFinite(pcsValues[i]) || pcsValues[i] <= 0) continue;
    let orderId: string | null = null;
    if (orderRefs[i]) {
      const lookup = await resolveOrderByRef(db, employee.currentCompanyId, orderRefs[i]);
      if (lookup.error || !lookup.order) failed(target, lookup.error ?? `Order ${orderRefs[i]} not found.`);
      orderId = lookup.order!.id;
    }
    lines.push({
      variantId: variants[i],
      warehouseId: warehouses[i],
      orderId,
      pcs: pcsValues[i],
      sqft: Number.isFinite(sqftValues[i]) && sqftValues[i] > 0 ? sqftValues[i] : null,
    });
  }

  if (lines.length === 0) failed(target, "Add at least one line with a SKU and quantity.");

  const result = await createChallan(db, {
    companyId: employee.currentCompanyId,
    chalanDate: str(formData, "chalan_date") || new Date().toISOString().slice(0, 10),
    partyId: str(formData, "party_id") || null,
    remarks: str(formData, "remarks") || null,
    lines,
    actorId: employee.id,
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, `Draft challan ${result.data!.chalanNo} created. Review it, then click Issue to deduct stock.`);
}

export async function challanIssueAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_dispatch");
  const target = safeTarget(formData, `${BASE}/challans`);
  const db = createServiceRoleClientUnchecked();

  const result = await issueChallan(db, {
    challanId: str(formData, "challan_id"),
    companyId: employee.currentCompanyId,
    actorId: employee.id,
  });
  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(
    target,
    result.data!.alreadyIssued
      ? `${result.data!.chalanNo} was already issued — stock was not deducted twice.`
      : `${result.data!.chalanNo} issued and READY stock deducted.`
  );
}

export async function challanCancelAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_dispatch");
  const target = safeTarget(formData, `${BASE}/challans`);
  const db = createServiceRoleClientUnchecked();

  const result = await cancelChallan(db, {
    challanId: str(formData, "challan_id"),
    companyId: employee.currentCompanyId,
    reason: str(formData, "reason"),
    actorId: employee.id,
  });
  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, result.data!.reversedStock ? "Challan cancelled — stock and reservation restored." : "Draft challan cancelled.");
}

export async function challanDispatchAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_dispatch");
  const target = safeTarget(formData, `${BASE}/challans`);
  const db = createServiceRoleClientUnchecked();

  const result = await markChallanDispatched(db, {
    challanId: str(formData, "challan_id"),
    companyId: employee.currentCompanyId,
  });
  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, "Marked dispatched — this challan can no longer be cancelled.");
}

// ---------------------------------------------------------------------------
// Processing & manufacturing
// ---------------------------------------------------------------------------

export async function processingSendAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_manage");
  const target = safeTarget(formData, `${BASE}/processing`);
  const db = createServiceRoleClientUnchecked();

  let orderId: string | null = null;
  const orderRef = str(formData, "order_ref");
  if (orderRef) {
    const lookup = await resolveOrderByRef(db, employee.currentCompanyId, orderRef);
    if (lookup.error || !lookup.order) failed(target, lookup.error ?? "Order not found.");
    orderId = lookup.order!.id;
  }

  const result = await startProcessing(db, {
    companyId: employee.currentCompanyId,
    variantId: str(formData, "variant_id"),
    warehouseId: str(formData, "warehouse_id"),
    process: str(formData, "process") === "WASHING" ? "WASHING" : "PRINTING",
    pcs: num(formData, "pcs"),
    sqft: numOrNull(formData, "sqft"),
    orderId,
    vendorPartyId: str(formData, "vendor_party_id") || null,
    expectedDate: str(formData, "expected_date") || null,
    remarks: str(formData, "remarks") || null,
    actorId: employee.id,
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, "Job created — stock moved to the processing stage in one transaction.");
}

export async function processingCompleteAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_manage");
  const target = safeTarget(formData, `${BASE}/processing`);
  const db = createServiceRoleClientUnchecked();

  const result = await completeProcessing(db, {
    companyId: employee.currentCompanyId,
    jobId: str(formData, "job_id"),
    acceptedPcs: num(formData, "accepted_pcs"),
    acceptedSqft: numOrNull(formData, "accepted_sqft"),
    rejectedPcs: num(formData, "rejected_pcs"),
    rejectedSqft: numOrNull(formData, "rejected_sqft"),
    actorId: employee.id,
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, `Recorded — ${result.data!.pendingPcs} PCS still pending on this job.`);
}

export async function manufacturingStartAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_manage");
  const target = safeTarget(formData, `${BASE}/processing`);
  const db = createServiceRoleClientUnchecked();

  const result = await startManufacturing(db, {
    companyId: employee.currentCompanyId,
    variantId: str(formData, "variant_id"),
    warehouseId: str(formData, "warehouse_id"),
    plannedPcs: num(formData, "planned_pcs"),
    plannedSqft: numOrNull(formData, "planned_sqft"),
    responsibleEmployeeId: str(formData, "responsible_employee_id") || null,
    startDate: str(formData, "start_date") || null,
    remarks: str(formData, "remarks") || null,
    actorId: employee.id,
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, "Production order created.");
}

export async function manufacturingCompleteAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_manage");
  const target = safeTarget(formData, `${BASE}/processing`);
  const db = createServiceRoleClientUnchecked();

  const result = await completeManufacturing(db, {
    companyId: employee.currentCompanyId,
    jobId: str(formData, "job_id"),
    acceptedPcs: num(formData, "accepted_pcs"),
    acceptedSqft: numOrNull(formData, "accepted_sqft"),
    rejectedPcs: num(formData, "rejected_pcs"),
    rejectedSqft: numOrNull(formData, "rejected_sqft"),
    consumption: str(formData, "material_consumption")
      ? { note: str(formData, "material_consumption") }
      : {},
    wastageNote: str(formData, "wastage_note") || null,
    actorId: employee.id,
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, "Production recorded — accepted pieces moved to READY.");
}

// ---------------------------------------------------------------------------
// Purchase requirements (Phase 4)
// ---------------------------------------------------------------------------

/** Closes an open requirement raised when a confirmed order was short of stock. */
export async function closeRequirementAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_manage");
  const target = safeTarget(formData, BASE);
  const db = createServiceRoleClientUnchecked();

  const result = await closePurchaseRequirement(db, {
    companyId: employee.currentCompanyId,
    requirementId: str(formData, "requirement_id"),
    actorId: employee.id,
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, "Purchase requirement closed.");
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function productAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_settings");
  const target = safeTarget(formData, `${BASE}/settings`);
  const db = createServiceRoleClientUnchecked();

  const result = await saveProduct(db, {
    companyId: employee.currentCompanyId,
    productId: str(formData, "product_id") || null,
    itemCategoryId: str(formData, "item_category_id"),
    name: str(formData, "name"),
    productCode: str(formData, "product_code"),
    stockUnit: str(formData, "stock_unit") === "SQFT" ? "SQFT" : "PCS",
    purchaseType: str(formData, "purchase_type") === "ORDER_BASED" ? "ORDER_BASED" : "DIRECT",
    manufacturingEnabled: checked(formData, "manufacturing_enabled"),
    processingRequired: checked(formData, "processing_required"),
    minStockPcs: num(formData, "min_stock_pcs"),
    active: checked(formData, "active"),
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, "Product saved.");
}

export async function variantAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_settings");
  const target = safeTarget(formData, `${BASE}/settings`);
  const db = createServiceRoleClientUnchecked();

  const result = await saveVariant(db, {
    companyId: employee.currentCompanyId,
    variantId: str(formData, "variant_id") || null,
    productId: str(formData, "product_id"),
    sku: str(formData, "sku"),
    sizeLabel: str(formData, "size_label"),
    colour: str(formData, "colour"),
    lengthFt: numOrNull(formData, "length_ft"),
    widthFt: numOrNull(formData, "width_ft"),
    active: checked(formData, "active"),
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, "Variant SKU saved.");
}

export async function warehouseAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_settings");
  const target = safeTarget(formData, `${BASE}/settings`);
  const db = createServiceRoleClientUnchecked();

  const result = await saveWarehouse(db, {
    companyId: employee.currentCompanyId,
    warehouseId: str(formData, "warehouse_id") || null,
    name: str(formData, "name"),
    code: str(formData, "code"),
    address: str(formData, "address") || null,
    active: checked(formData, "active"),
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, "Warehouse saved.");
}

export async function categorySettingsAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_settings");
  const target = safeTarget(formData, `${BASE}/settings`);
  const db = createServiceRoleClientUnchecked();

  const result = await saveCategorySettings(db, {
    companyId: employee.currentCompanyId,
    itemCategoryId: str(formData, "item_category_id"),
    isOrderBased: checked(formData, "is_order_based"),
    requiresPrinting: checked(formData, "requires_printing"),
    requiresWashing: checked(formData, "requires_washing"),
    manufacturingEnabled: checked(formData, "manufacturing_enabled"),
    sqftTracked: checked(formData, "sqft_tracked"),
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, "Category workflow saved.");
}

export async function productDeleteAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_settings");
  const target = safeTarget(formData, `${BASE}/settings`);
  const db = createServiceRoleClientUnchecked();

  const result = await deleteProduct(db, {
    companyId: employee.currentCompanyId,
    productId: str(formData, "product_id"),
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, result.message!);
}

export async function variantDeleteAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_settings");
  const target = safeTarget(formData, `${BASE}/settings`);
  const db = createServiceRoleClientUnchecked();

  const result = await deleteVariant(db, {
    companyId: employee.currentCompanyId,
    variantId: str(formData, "variant_id"),
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, result.message!);
}

export async function warehouseDeleteAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_settings");
  const target = safeTarget(formData, `${BASE}/settings`);
  const db = createServiceRoleClientUnchecked();

  const result = await deleteWarehouse(db, {
    companyId: employee.currentCompanyId,
    warehouseId: str(formData, "warehouse_id"),
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, result.message!);
}

export async function categoryWorkflowDeleteAction(formData: FormData): Promise<void> {
  const employee = await requireCapability("inventory_settings");
  const target = safeTarget(formData, `${BASE}/settings`);
  const db = createServiceRoleClientUnchecked();

  const result = await deleteCategorySettings(db, {
    companyId: employee.currentCompanyId,
    itemCategoryId: str(formData, "item_category_id"),
  });

  if (result.error) failed(target, result.error);
  revalidatePath(BASE, "layout");
  done(target, result.message!);
}
