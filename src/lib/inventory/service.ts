// Server-side operations for the Inventory module. Every stock-changing call
// goes through a PostgreSQL function (db/2026-11-14c-inventory-management-module.sql)
// so the balance update, ledger entry and job/status change all commit or roll
// back together. This file only validates input, resolves names to ids and
// translates database errors into messages a user can act on.
import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { resolveSqFt, roundQty } from "./sqft";
import { friendlyDbError } from "./errors";
import { type InventoryStage, type StockSource, SOURCE_TX_TYPE, INWARD_STAGES } from "./stages";

export type InventoryDb = ReturnType<typeof createServiceRoleClientUnchecked>;
export type InventoryResult<T = null> = { error: string | null; data: T | null };

export type VariantContext = {
  variant: { id: string; sku: string; sqft_per_piece: number | null; product_id: string };
  product: { id: string; name: string; company_id: string; item_category_id: string };
  minStockPcs: number;
  sqftTracked: boolean;
};

// Error translation lives in a pure module so it can be unit-tested without
// Next.js's server-only imports; re-exported here for existing callers.
export { friendlyDbError } from "./errors";

export async function variantContext(
  db: InventoryDb,
  companyId: string,
  variantId: string
): Promise<{ error: string | null; ctx: VariantContext | null }> {
  if (!variantId) return { error: "Choose a SKU.", ctx: null };
  const { data: variant } = await db
    .from("inventory_product_variants")
    .select("id, sku, sqft_per_piece, product_id")
    .eq("id", variantId)
    .maybeSingle();
  if (!variant) return { error: "That SKU no longer exists.", ctx: null };

  const { data: product } = await db
    .from("inventory_products")
    .select("id, name, company_id, item_category_id, min_stock_pcs")
    .eq("id", variant.product_id)
    .maybeSingle();
  if (!product || product.company_id !== companyId) {
    return { error: "That SKU belongs to another company.", ctx: null };
  }

  const { data: settings } = await db
    .from("inventory_category_settings")
    .select("sqft_tracked")
    .eq("company_id", companyId)
    .eq("item_category_id", product.item_category_id)
    .maybeSingle();

  return {
    error: null,
    ctx: {
      variant,
      product,
      minStockPcs: Number(product.min_stock_pcs ?? 0),
      sqftTracked: settings ? Boolean(settings.sqft_tracked) : variant.sqft_per_piece != null,
    },
  };
}

// ---------------------------------------------------------------------------
// Stock in / adjust
// ---------------------------------------------------------------------------

export type InwardInput = {
  companyId: string;
  variantId: string;
  warehouseId: string;
  stage: InventoryStage;
  source: StockSource;
  pcs: number;
  sqft?: number | null;
  reference?: string | null;
  remarks?: string | null;
  idempotencyKey?: string | null;
  actorId: string;
};

export async function postStockInward(
  db: InventoryDb,
  input: InwardInput
): Promise<InventoryResult<{ pcs: number; sqft: number }>> {
  if (!input.warehouseId) return { error: "Choose a warehouse.", data: null };
  if (!INWARD_STAGES.includes(input.stage)) {
    return { error: "Stock can only be brought in as RAW, QC or READY.", data: null };
  }
  if (!Number.isFinite(input.pcs) || input.pcs <= 0) {
    return { error: "Enter a quantity greater than zero.", data: null };
  }

  const { error, ctx } = await variantContext(db, input.companyId, input.variantId);
  if (error || !ctx) return { error, data: null };

  const sqft = resolveSqFt({
    pcs: input.pcs,
    sqftPerPiece: ctx.variant.sqft_per_piece,
    override: input.sqft ?? null,
    sqftTracked: ctx.sqftTracked,
  });

  const { data, error: rpcError } = await db.rpc("inventory_apply_movement", {
    p_company_id: input.companyId,
    p_variant_id: input.variantId,
    p_warehouse_id: input.warehouseId,
    p_stage: input.stage,
    p_pcs_delta: roundQty(input.pcs),
    p_sqft_delta: sqft,
    p_tx_type: SOURCE_TX_TYPE[input.source],
    p_ref_type: "INWARD",
    p_ref_id: null,
    p_ref_no: input.reference || null,
    p_remarks: input.remarks || null,
    p_actor: input.actorId,
    p_idempotency_key: input.idempotencyKey || null,
  });
  if (rpcError) return { error: friendlyDbError(rpcError.message), data: null };

  const row = Array.isArray(data) ? data[0] : data;
  return { error: null, data: { pcs: Number(row?.new_pcs ?? 0), sqft: Number(row?.new_sqft ?? 0) } };
}

export type AdjustmentInput = {
  companyId: string;
  variantId: string;
  warehouseId: string;
  stage: InventoryStage;
  pcsDelta: number;
  sqftDelta: number;
  reason: string;
  remarks: string;
  actorId: string;
};

export async function adjustStock(
  db: InventoryDb,
  input: AdjustmentInput
): Promise<InventoryResult<null>> {
  if (!input.reason.trim() || !input.remarks.trim()) {
    return { error: "A correction needs both a reason and remarks — it is permanently visible in the ledger.", data: null };
  }
  if (input.pcsDelta === 0 && input.sqftDelta === 0) {
    return { error: "Enter a PCS or SQ FT correction.", data: null };
  }
  const { error, ctx } = await variantContext(db, input.companyId, input.variantId);
  if (error || !ctx) return { error, data: null };

  const { data, error: rpcError } = await db.rpc("inventory_apply_movement", {
    p_company_id: input.companyId,
    p_variant_id: input.variantId,
    p_warehouse_id: input.warehouseId,
    p_stage: input.stage,
    p_pcs_delta: roundQty(input.pcsDelta),
    p_sqft_delta: roundQty(input.sqftDelta),
    p_tx_type: "ADJUSTMENT",
    p_ref_type: "ADJUSTMENT",
    p_ref_id: null,
    p_ref_no: null,
    p_remarks: `${input.reason} — ${input.remarks}`,
    p_actor: input.actorId,
    p_idempotency_key: null,
  });
  if (rpcError) return { error: friendlyDbError(rpcError.message), data: null };

  const row = Array.isArray(data) ? data[0] : data;
  await db.from("inventory_adjustments").insert({
    company_id: input.companyId,
    variant_id: input.variantId,
    warehouse_id: input.warehouseId,
    stage: input.stage,
    pcs_delta: roundQty(input.pcsDelta),
    sqft_delta: roundQty(input.sqftDelta),
    reason: input.reason.trim(),
    remarks: input.remarks.trim(),
    ledger_id: row?.ledger_id ?? null,
    created_by: input.actorId,
  });
  return { error: null, data: null };
}

// ---------------------------------------------------------------------------
// Reservations
// ---------------------------------------------------------------------------

export async function resolveOrderByRef(
  db: InventoryDb,
  companyId: string,
  refNo: string
): Promise<{ error: string | null; order: { id: string; ref_no: string } | null }> {
  const ref = refNo.trim();
  if (!ref) return { error: "Enter a PO/RF/RG number.", order: null };
  const { data } = await db
    .from("orders")
    .select("id, ref_no, company_id")
    .eq("company_id", companyId)
    .ilike("ref_no", ref)
    .limit(2);
  if (!data || data.length === 0) return { error: `No order found with reference ${ref}.`, order: null };
  if (data.length > 1) return { error: `More than one order matches ${ref} — open the order and reserve from there.`, order: null };
  return { error: null, order: { id: data[0].id, ref_no: data[0].ref_no } };
}

export type ReserveInput = {
  orderId: string;
  variantId: string;
  warehouseId: string;
  pcs: number;
  sqft?: number | null;
  actorId: string;
};

export async function reserveStock(db: InventoryDb, input: ReserveInput): Promise<InventoryResult<{ availableAfter: number }>> {
  if (!Number.isFinite(input.pcs) || input.pcs <= 0) return { error: "Reserve at least one piece.", data: null };
  const { data: variant } = await db
    .from("inventory_product_variants")
    .select("sqft_per_piece")
    .eq("id", input.variantId)
    .maybeSingle();
  const sqft = input.sqft ?? resolveSqFt({ pcs: input.pcs, sqftPerPiece: variant?.sqft_per_piece ?? null, override: null, sqftTracked: true });
  const { data, error } = await db.rpc("inventory_reserve", {
    p_order_id: input.orderId,
    p_variant_id: input.variantId,
    p_warehouse_id: input.warehouseId,
    p_pcs: roundQty(input.pcs),
    p_sqft: sqft,
    p_actor: input.actorId,
  });
  if (error) return { error: friendlyDbError(error.message), data: null };
  return { error: null, data: { availableAfter: Number(data?.available_after ?? 0) } };
}

export async function releaseReservation(
  db: InventoryDb,
  input: { reservationId: string; companyId: string; reason: string; actorId: string }
): Promise<InventoryResult<null>> {
  const { data: row } = await db
    .from("inventory_reservations")
    .select("id, company_id, status")
    .eq("id", input.reservationId)
    .maybeSingle();
  if (!row || row.company_id !== input.companyId) return { error: "Reservation not found.", data: null };
  if (row.status !== "ACTIVE") return { error: "That reservation is already closed.", data: null };
  const { error } = await db.rpc("inventory_release_reservation", {
    p_reservation_id: input.reservationId,
    p_actor: input.actorId,
    p_reason: input.reason || "Released by inventory team",
  });
  if (error) return { error: friendlyDbError(error.message), data: null };
  return { error: null, data: null };
}

// Phase 4 — confirmation reserves only what READY can cover and turns the rest
// into a purchase requirement, in one transaction. Unlike reserveStock() above
// this never fails on short stock: a confirmed order is a promise to the buyer
// even when the goods still have to be bought or produced.
export type OrderReserveInput = {
  orderId: string;
  variantId: string;
  warehouseId: string;
  pcs: number;
  sqft: number;
  actorId: string;
};

export async function reserveOrderStock(
  db: InventoryDb,
  input: OrderReserveInput
): Promise<InventoryResult<{ reservedPcs: number; shortfallPcs: number; requirementId: string | null; availableBefore: number }>> {
  const { data, error } = await db.rpc("inventory_reserve_order", {
    p_order_id: input.orderId,
    p_variant_id: input.variantId,
    p_warehouse_id: input.warehouseId,
    p_pcs: roundQty(input.pcs),
    p_sqft: roundQty(input.sqft),
    p_actor: input.actorId,
  });
  if (error) return { error: friendlyDbError(error.message), data: null };
  return {
    error: null,
    data: {
      reservedPcs: Number(data?.reserved_pcs ?? 0),
      shortfallPcs: Number(data?.shortfall_pcs ?? 0),
      requirementId: data?.requirement_id ?? null,
      availableBefore: Number(data?.available_before ?? 0),
    },
  };
}

export async function releaseOrderReservations(
  db: InventoryDb,
  input: { orderId: string; actorId: string; reason: string }
): Promise<InventoryResult<{ released: number; cancelled: number }>> {
  const { data, error } = await db.rpc("inventory_release_order", {
    p_order_id: input.orderId,
    p_actor: input.actorId,
    p_reason: input.reason,
  });
  if (error) return { error: friendlyDbError(error.message), data: null };
  return {
    error: null,
    data: {
      released: Number(data?.released_reservations ?? 0),
      cancelled: Number(data?.cancelled_requirements ?? 0),
    },
  };
}

/** Closes an open purchase requirement once the goods were bought or the need ended. */
export async function closePurchaseRequirement(
  db: InventoryDb,
  input: { companyId: string; requirementId: string; actorId: string }
): Promise<InventoryResult<null>> {
  const { data: row } = await db
    .from("inventory_purchase_requirements")
    .select("id, company_id, status")
    .eq("id", input.requirementId)
    .maybeSingle();
  if (!row || row.company_id !== input.companyId) return { error: "Purchase requirement not found.", data: null };
  if (row.status !== "OPEN") return { error: "That requirement is already closed.", data: null };
  const { error } = await db
    .from("inventory_purchase_requirements")
    .update({ status: "FULFILLED", updated_at: new Date().toISOString() })
    .eq("id", input.requirementId);
  if (error) return { error: friendlyDbError(error.message), data: null };
  return { error: null, data: null };
}

// ---------------------------------------------------------------------------
// Challans
// ---------------------------------------------------------------------------

export type ChallanLineInput = {
  variantId: string;
  warehouseId: string;
  orderId?: string | null;
  pcs: number;
  sqft?: number | null;
  remarks?: string | null;
};

export async function createChallan(
  db: InventoryDb,
  input: {
    companyId: string;
    chalanDate: string;
    partyId?: string | null;
    remarks?: string | null;
    lines: ChallanLineInput[];
    actorId: string;
  }
): Promise<InventoryResult<{ id: string; chalanNo: string }>> {
  const lines = input.lines.filter((l) => l.variantId && l.pcs > 0);
  if (lines.length === 0) return { error: "Add at least one SKU line with a quantity.", data: null };

  const resolved: (ChallanLineInput & { sqft: number })[] = [];
  for (const line of lines) {
    const { error, ctx } = await variantContext(db, input.companyId, line.variantId);
    if (error || !ctx) return { error: error ?? "Invalid SKU.", data: null };
    resolved.push({
      ...line,
      sqft: resolveSqFt({
        pcs: line.pcs,
        sqftPerPiece: ctx.variant.sqft_per_piece,
        override: line.sqft ?? null,
        sqftTracked: ctx.sqftTracked,
      }),
    });
  }

  const { data: header, error } = await db
    .from("inventory_challans")
    .insert({
      company_id: input.companyId,
      chalan_date: input.chalanDate || new Date().toISOString().slice(0, 10),
      party_id: input.partyId || null,
      remarks: input.remarks || null,
      created_by: input.actorId,
    })
    .select("id, chalan_no")
    .single();
  if (error || !header) return { error: friendlyDbError(error?.message ?? "Could not create the challan."), data: null };

  const { error: lineError } = await db.from("inventory_challan_lines").insert(
    resolved.map((l) => ({
      chalan_id: header.id,
      order_id: l.orderId || null,
      variant_id: l.variantId,
      warehouse_id: l.warehouseId,
      pcs: roundQty(l.pcs),
      sqft: l.sqft,
      remarks: l.remarks || null,
    }))
  );
  if (lineError) {
    await db.from("inventory_challans").delete().eq("id", header.id);
    return { error: friendlyDbError(lineError.message), data: null };
  }

  return { error: null, data: { id: header.id, chalanNo: header.chalan_no } };
}

async function ownChallan(db: InventoryDb, challanId: string, companyId: string) {
  const { data } = await db
    .from("inventory_challans")
    .select("id, company_id, status, chalan_no")
    .eq("id", challanId)
    .maybeSingle();
  if (!data || data.company_id !== companyId) return null;
  return data;
}

export async function issueChallan(
  db: InventoryDb,
  input: { challanId: string; companyId: string; actorId: string }
): Promise<InventoryResult<{ alreadyIssued: boolean; chalanNo: string }>> {
  const chalan = await ownChallan(db, input.challanId, input.companyId);
  if (!chalan) return { error: "Challan not found.", data: null };
  const { data, error } = await db.rpc("inventory_issue_challan", {
    p_challan_id: input.challanId,
    p_actor: input.actorId,
  });
  if (error) return { error: friendlyDbError(error.message), data: null };
  return {
    error: null,
    data: { alreadyIssued: Boolean(data?.already_issued), chalanNo: data?.chalan_no ?? chalan.chalan_no },
  };
}

export async function cancelChallan(
  db: InventoryDb,
  input: { challanId: string; companyId: string; reason: string; actorId: string }
): Promise<InventoryResult<{ reversedStock: boolean }>> {
  const chalan = await ownChallan(db, input.challanId, input.companyId);
  if (!chalan) return { error: "Challan not found.", data: null };
  const { data, error } = await db.rpc("inventory_cancel_challan", {
    p_challan_id: input.challanId,
    p_actor: input.actorId,
    p_reason: input.reason || "Cancelled by dispatch team",
  });
  if (error) return { error: friendlyDbError(error.message), data: null };
  return { error: null, data: { reversedStock: Boolean(data?.reversed_stock) } };
}

export async function markChallanDispatched(
  db: InventoryDb,
  input: { challanId: string; companyId: string }
): Promise<InventoryResult<null>> {
  const chalan = await ownChallan(db, input.challanId, input.companyId);
  if (!chalan) return { error: "Challan not found.", data: null };
  const { error } = await db.rpc("inventory_mark_dispatched", { p_challan_id: input.challanId });
  if (error) return { error: friendlyDbError(error.message), data: null };
  return { error: null, data: null };
}

// ---------------------------------------------------------------------------
// Processing / manufacturing / QC
// ---------------------------------------------------------------------------

export async function startProcessing(
  db: InventoryDb,
  input: {
    companyId: string;
    variantId: string;
    warehouseId: string;
    process: "PRINTING" | "WASHING";
    pcs: number;
    sqft?: number | null;
    orderId?: string | null;
    vendorPartyId?: string | null;
    expectedDate?: string | null;
    remarks?: string | null;
    actorId: string;
  }
): Promise<InventoryResult<null>> {
  if (input.pcs <= 0) return { error: "Enter how many pieces are being sent.", data: null };
  const { error, ctx } = await variantContext(db, input.companyId, input.variantId);
  if (error || !ctx) return { error, data: null };
  const sqft = resolveSqFt({ pcs: input.pcs, sqftPerPiece: ctx.variant.sqft_per_piece, override: input.sqft ?? null, sqftTracked: ctx.sqftTracked });
  const { error: rpcError } = await db.rpc("inventory_start_processing", {
    p_company_id: input.companyId,
    p_variant_id: input.variantId,
    p_warehouse_id: input.warehouseId,
    p_process: input.process,
    p_pcs: roundQty(input.pcs),
    p_sqft: sqft,
    p_order_id: input.orderId || null,
    p_vendor_party_id: input.vendorPartyId || null,
    p_expected_date: input.expectedDate || null,
    p_remarks: input.remarks || null,
    p_actor: input.actorId,
  });
  if (rpcError) return { error: friendlyDbError(rpcError.message), data: null };
  return { error: null, data: null };
}

export async function completeProcessing(
  db: InventoryDb,
  input: {
    companyId: string;
    jobId: string;
    acceptedPcs: number;
    acceptedSqft?: number | null;
    rejectedPcs: number;
    rejectedSqft?: number | null;
    actorId: string;
  }
): Promise<InventoryResult<{ pendingPcs: number }>> {
  const { data: job } = await db
    .from("inventory_processing_jobs")
    .select("id, company_id, pcs_sent, pcs_accepted, pcs_rejected, sqft_sent")
    .eq("id", input.jobId)
    .maybeSingle();
  if (!job || job.company_id !== input.companyId) return { error: "Processing job not found.", data: null };

  const accepted = Math.max(input.acceptedPcs, 0);
  const rejected = Math.max(input.rejectedPcs, 0);
  const ratio = Number(job.pcs_sent) > 0 ? Number(job.sqft_sent) / Number(job.pcs_sent) : 0;
  const acceptedSqft = input.acceptedSqft ?? roundQty(accepted * ratio);
  const rejectedSqft = input.rejectedSqft ?? roundQty(rejected * ratio);

  const { data, error } = await db.rpc("inventory_complete_processing", {
    p_job_id: input.jobId,
    p_accepted_pcs: roundQty(accepted),
    p_accepted_sqft: acceptedSqft,
    p_rejected_pcs: roundQty(rejected),
    p_rejected_sqft: rejectedSqft,
    p_actor: input.actorId,
  });
  if (error) return { error: friendlyDbError(error.message), data: null };
  return { error: null, data: { pendingPcs: Number(data?.pending_pcs ?? 0) } };
}

export async function startManufacturing(
  db: InventoryDb,
  input: {
    companyId: string;
    variantId: string;
    warehouseId: string;
    plannedPcs: number;
    plannedSqft?: number | null;
    responsibleEmployeeId?: string | null;
    startDate?: string | null;
    remarks?: string | null;
    actorId: string;
  }
): Promise<InventoryResult<null>> {
  if (input.plannedPcs <= 0) return { error: "Enter the planned quantity.", data: null };
  const { error, ctx } = await variantContext(db, input.companyId, input.variantId);
  if (error || !ctx) return { error, data: null };
  const plannedSqft = input.plannedSqft ?? resolveSqFt({ pcs: input.plannedPcs, sqftPerPiece: ctx.variant.sqft_per_piece, override: null, sqftTracked: ctx.sqftTracked });
  const { error: rpcError } = await db.rpc("inventory_start_manufacturing", {
    p_company_id: input.companyId,
    p_variant_id: input.variantId,
    p_warehouse_id: input.warehouseId,
    p_planned_pcs: roundQty(input.plannedPcs),
    p_planned_sqft: plannedSqft,
    p_responsible: input.responsibleEmployeeId || null,
    p_start_date: input.startDate || null,
    p_remarks: input.remarks || null,
    p_actor: input.actorId,
  });
  if (rpcError) return { error: friendlyDbError(rpcError.message), data: null };
  return { error: null, data: null };
}

export async function completeManufacturing(
  db: InventoryDb,
  input: {
    companyId: string;
    jobId: string;
    acceptedPcs: number;
    acceptedSqft?: number | null;
    rejectedPcs: number;
    rejectedSqft?: number | null;
    consumption?: Record<string, unknown>;
    wastageNote?: string | null;
    actorId: string;
  }
): Promise<InventoryResult<{ pendingPcs: number }>> {
  const { data: job } = await db
    .from("inventory_manufacturing_jobs")
    .select("id, company_id, planned_pcs")
    .eq("id", input.jobId)
    .maybeSingle();
  if (!job || job.company_id !== input.companyId) return { error: "Manufacturing job not found.", data: null };

  const accepted = Math.max(input.acceptedPcs, 0);
  const rejected = Math.max(input.rejectedPcs, 0);
  const { data, error } = await db.rpc("inventory_complete_manufacturing", {
    p_job_id: input.jobId,
    p_accepted_pcs: roundQty(accepted),
    p_accepted_sqft: roundQty(input.acceptedSqft ?? 0),
    p_rejected_pcs: roundQty(rejected),
    p_rejected_sqft: roundQty(input.rejectedSqft ?? 0),
    p_consumption: input.consumption ?? {},
    p_wastage_note: input.wastageNote || null,
    p_actor: input.actorId,
  });
  if (error) return { error: friendlyDbError(error.message), data: null };
  return { error: null, data: { pendingPcs: Number(data?.pending_pcs ?? 0) } };
}

export async function moveQcStock(
  db: InventoryDb,
  input: {
    companyId: string;
    variantId: string;
    warehouseId: string;
    pcs: number;
    sqft?: number | null;
    accept: boolean;
    remarks?: string | null;
    actorId: string;
  }
): Promise<InventoryResult<null>> {
  if (input.pcs <= 0) return { error: "Enter a quantity greater than zero.", data: null };
  const { error, ctx } = await variantContext(db, input.companyId, input.variantId);
  if (error || !ctx) return { error, data: null };
  const sqft = resolveSqFt({ pcs: input.pcs, sqftPerPiece: ctx.variant.sqft_per_piece, override: input.sqft ?? null, sqftTracked: ctx.sqftTracked });
  const { error: rpcError } = await db.rpc("inventory_move_qc", {
    p_company_id: input.companyId,
    p_variant_id: input.variantId,
    p_warehouse_id: input.warehouseId,
    p_pcs: roundQty(input.pcs),
    p_sqft: sqft,
    p_accept: input.accept,
    p_ref_no: null,
    p_remarks: input.remarks || null,
    p_actor: input.actorId,
  });
  if (rpcError) return { error: friendlyDbError(rpcError.message), data: null };
  return { error: null, data: null };
}

// ---------------------------------------------------------------------------
// Settings: products, variants, warehouses
// ---------------------------------------------------------------------------

export async function saveProduct(
  db: InventoryDb,
  input: {
    companyId: string;
    productId?: string | null;
    itemCategoryId: string;
    name: string;
    productCode: string;
    stockUnit: "PCS" | "SQFT";
    purchaseType: "DIRECT" | "ORDER_BASED";
    manufacturingEnabled: boolean;
    processingRequired: boolean;
    minStockPcs: number;
    active?: boolean;
  }
): Promise<InventoryResult<null>> {
  if (!input.name.trim() || !input.productCode.trim()) return { error: "Product name and code are required.", data: null };
  const payload = {
    company_id: input.companyId,
    item_category_id: input.itemCategoryId,
    name: input.name.trim(),
    product_code: input.productCode.trim().toUpperCase(),
    stock_unit: input.stockUnit,
    purchase_type: input.purchaseType,
    manufacturing_enabled: input.manufacturingEnabled,
    processing_required: input.processingRequired,
    min_stock_pcs: input.minStockPcs,
    active: input.active ?? true,
    updated_at: new Date().toISOString(),
  };
  const query = input.productId
    ? db.from("inventory_products").update(payload).eq("id", input.productId)
    : db.from("inventory_products").insert(payload);
  const { error } = await query;
  if (error) return { error: friendlyDbError(error.message), data: null };
  return { error: null, data: null };
}

export async function saveVariant(
  db: InventoryDb,
  input: {
    companyId: string;
    variantId?: string | null;
    productId: string;
    sku: string;
    sizeLabel: string;
    colour: string;
    lengthFt: number | null;
    widthFt: number | null;
    active?: boolean;
  }
): Promise<InventoryResult<null>> {
  if (!input.sku.trim()) return { error: "A variant SKU is required.", data: null };
  if ((input.lengthFt === null) !== (input.widthFt === null)) {
    return { error: "Enter both length and width, or leave both blank.", data: null };
  }
  const { data: product } = await db
    .from("inventory_products")
    .select("id, company_id")
    .eq("id", input.productId)
    .maybeSingle();
  if (!product || product.company_id !== input.companyId) return { error: "Product not found for this company.", data: null };

  const payload = {
    product_id: input.productId,
    sku: input.sku.trim().toUpperCase(),
    size_label: input.sizeLabel.trim(),
    colour: input.colour.trim(),
    length_ft: input.lengthFt,
    width_ft: input.widthFt,
    active: input.active ?? true,
  };
  const query = input.variantId
    ? db.from("inventory_product_variants").update(payload).eq("id", input.variantId)
    : db.from("inventory_product_variants").insert(payload);
  const { error } = await query;
  if (error) return { error: friendlyDbError(error.message), data: null };
  return { error: null, data: null };
}

export async function saveWarehouse(
  db: InventoryDb,
  input: {
    companyId: string;
    warehouseId?: string | null;
    name: string;
    code: string;
    address?: string | null;
    active?: boolean;
  }
): Promise<InventoryResult<null>> {
  if (!input.name.trim() || !input.code.trim()) return { error: "Warehouse name and code are required.", data: null };
  const payload = {
    company_id: input.companyId,
    name: input.name.trim(),
    code: input.code.trim().toUpperCase(),
    address: input.address?.trim() || null,
    active: input.active ?? true,
  };
  const query = input.warehouseId
    ? db.from("inventory_warehouses").update(payload).eq("id", input.warehouseId)
    : db.from("inventory_warehouses").insert(payload);
  const { error } = await query;
  if (error) return { error: friendlyDbError(error.message), data: null };
  return { error: null, data: null };
}

export async function saveCategorySettings(
  db: InventoryDb,
  input: {
    companyId: string;
    itemCategoryId: string;
    isOrderBased: boolean;
    requiresPrinting: boolean;
    requiresWashing: boolean;
    manufacturingEnabled: boolean;
    sqftTracked: boolean;
  }
): Promise<InventoryResult<null>> {
  if (!input.itemCategoryId) return { error: "Choose an item category.", data: null };
  const { error } = await db.from("inventory_category_settings").upsert(
    {
      company_id: input.companyId,
      item_category_id: input.itemCategoryId,
      is_order_based: input.isOrderBased,
      requires_printing: input.requiresPrinting,
      requires_washing: input.requiresWashing,
      manufacturing_enabled: input.manufacturingEnabled,
      sqft_tracked: input.sqftTracked,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id,item_category_id" }
  );
  if (error) return { error: friendlyDbError(error.message), data: null };
  return { error: null, data: null };
}

// ---------------------------------------------------------------------------
// Settings: edit / remove
// ---------------------------------------------------------------------------
// A master data row that stock, ledger or order history already points at is
// never hard-deleted: it is deactivated (reversible) and the screen is told
// why. Only a row nothing references is physically removed.

export type RemovalResult = { error: string | null; message: string | null; deleted: boolean };

async function referenceCount(db: InventoryDb, table: string, column: string, id: string): Promise<number> {
  const { count, error } = await db.from(table).select("id", { count: "exact", head: true }).eq(column, id);
  // A table from a newer migration may not exist yet — that is zero references.
  if (error) return 0;
  return count ?? 0;
}

const VARIANT_REFERENCE_TABLES = [
  "inventory_balances",
  "inventory_ledger",
  "inventory_reservations",
  "inventory_adjustments",
  "inventory_challan_lines",
  "inventory_processing_jobs",
  "inventory_manufacturing_jobs",
  "inventory_purchase_requirements",
  "inventory_stock_entries",
];

const WAREHOUSE_REFERENCE_TABLES = [
  "inventory_balances",
  "inventory_ledger",
  "inventory_adjustments",
  "inventory_challan_lines",
  "inventory_processing_jobs",
  "inventory_manufacturing_jobs",
  "inventory_stock_entries",
];

async function variantIsReferenced(db: InventoryDb, variantId: string): Promise<boolean> {
  for (const table of VARIANT_REFERENCE_TABLES) {
    if ((await referenceCount(db, table, "variant_id", variantId)) > 0) return true;
  }
  return false;
}

async function warehouseIsReferenced(db: InventoryDb, warehouseId: string): Promise<boolean> {
  for (const table of WAREHOUSE_REFERENCE_TABLES) {
    if ((await referenceCount(db, table, "warehouse_id", warehouseId)) > 0) return true;
  }
  return false;
}

export async function deleteProduct(
  db: InventoryDb,
  input: { companyId: string; productId: string }
): Promise<RemovalResult> {
  const { data: product } = await db
    .from("inventory_products")
    .select("id, company_id, name, product_code")
    .eq("id", input.productId)
    .maybeSingle();
  if (!product || product.company_id !== input.companyId) {
    return { error: "Product not found for this company.", message: null, deleted: false };
  }

  const { data: variants } = await db
    .from("inventory_product_variants")
    .select("id, sku")
    .eq("product_id", input.productId);

  let kept = 0;
  for (const variant of (variants ?? []) as { id: string; sku: string }[]) {
    if (await variantIsReferenced(db, variant.id)) {
      const { error } = await db
        .from("inventory_product_variants")
        .update({ active: false })
        .eq("id", variant.id);
      if (error) return { error: friendlyDbError(error.message), message: null, deleted: false };
      kept += 1;
      continue;
    }
    const { error } = await db.from("inventory_product_variants").delete().eq("id", variant.id);
    if (error) {
      await db.from("inventory_product_variants").update({ active: false }).eq("id", variant.id);
      kept += 1;
    }
  }

  if (kept > 0) {
    const { error } = await db
      .from("inventory_products")
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq("id", input.productId);
    if (error) return { error: friendlyDbError(error.message), message: null, deleted: false };
    return {
      error: null,
      message: `${product.product_code} deactivated: ${kept} variant(s) have stock or history and were kept (deactivated), not deleted.`,
      deleted: false,
    };
  }

  const { error } = await db.from("inventory_products").delete().eq("id", input.productId);
  if (error) return { error: friendlyDbError(error.message), message: null, deleted: false };
  return { error: null, message: `${product.product_code} and its unused variants were deleted.`, deleted: true };
}

export async function deleteVariant(
  db: InventoryDb,
  input: { companyId: string; variantId: string }
): Promise<RemovalResult> {
  const { data: variant } = await db
    .from("inventory_product_variants")
    .select("id, sku, product_id")
    .eq("id", input.variantId)
    .maybeSingle();
  if (!variant) return { error: "Variant not found.", message: null, deleted: false };

  const { data: product } = await db
    .from("inventory_products")
    .select("id, company_id")
    .eq("id", variant.product_id)
    .maybeSingle();
  if (!product || product.company_id !== input.companyId) {
    return { error: "Variant not found for this company.", message: null, deleted: false };
  }

  if (await variantIsReferenced(db, input.variantId)) {
    const { error } = await db
      .from("inventory_product_variants")
      .update({ active: false })
      .eq("id", input.variantId);
    if (error) return { error: friendlyDbError(error.message), message: null, deleted: false };
    return {
      error: null,
      message: `${variant.sku} deactivated: it has stock or history, so it is kept for the ledger instead of deleted.`,
      deleted: false,
    };
  }

  const { error } = await db.from("inventory_product_variants").delete().eq("id", input.variantId);
  if (error) return { error: friendlyDbError(error.message), message: null, deleted: false };
  return { error: null, message: `${variant.sku} deleted.`, deleted: true };
}

export async function deleteWarehouse(
  db: InventoryDb,
  input: { companyId: string; warehouseId: string }
): Promise<RemovalResult> {
  const { data: warehouse } = await db
    .from("inventory_warehouses")
    .select("id, company_id, code, name")
    .eq("id", input.warehouseId)
    .maybeSingle();
  if (!warehouse || warehouse.company_id !== input.companyId) {
    return { error: "Warehouse not found for this company.", message: null, deleted: false };
  }

  if (await warehouseIsReferenced(db, input.warehouseId)) {
    const { error } = await db
      .from("inventory_warehouses")
      .update({ active: false })
      .eq("id", input.warehouseId);
    if (error) return { error: friendlyDbError(error.message), message: null, deleted: false };
    return {
      error: null,
      message: `${warehouse.code} deactivated: stock or history already points at it, so the row is kept.`,
      deleted: false,
    };
  }

  const { error } = await db.from("inventory_warehouses").delete().eq("id", input.warehouseId);
  if (error) return { error: friendlyDbError(error.message), message: null, deleted: false };
  return { error: null, message: `Warehouse ${warehouse.code} deleted.`, deleted: true };
}

export async function deleteCategorySettings(
  db: InventoryDb,
  input: { companyId: string; itemCategoryId: string }
): Promise<RemovalResult> {
  if (!input.itemCategoryId) return { error: "Choose an item category.", message: null, deleted: false };
  const { error } = await db
    .from("inventory_category_settings")
    .delete()
    .eq("company_id", input.companyId)
    .eq("item_category_id", input.itemCategoryId);
  if (error) return { error: friendlyDbError(error.message), message: null, deleted: false };
  return { error: null, message: "Category workflow removed — the category itself and its products are untouched.", deleted: true };
}
