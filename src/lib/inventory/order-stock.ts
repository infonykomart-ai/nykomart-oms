// Phase 4 — links an order row to an inventory variant.
//
// Orders store SKU and size as FREE TEXT (sku_label / size_label) because the
// source sheets did too. inventory_product_variants.sku is globally unique, so
// the SKU text is the join key — the size is only used to break a tie if the
// same SKU ever exists more than once. Nothing here writes stock directly:
// reservations and requirements go through inventory_reserve_order().
import type { InventoryDb } from "./service";
import { releaseOrderReservations, reserveOrderStock } from "./service";
import { roundQty } from "./sqft";
import { summarizeAvailability } from "./order-stock-math";

export type OrderVariant = {
  id: string;
  sku: string;
  size_label: string;
  sqft_per_piece: number | null;
  product_id: string;
};

const norm = (value: string | null | undefined) => (value ?? "").trim().toLowerCase();

/**
 * Resolves the order's SKU text to an inventory variant of the same company
 * and item category. Returns null when nothing matches — an order for a SKU
 * that inventory does not track is legitimate, not an error.
 */
export async function findOrderVariant(
  db: InventoryDb,
  companyId: string,
  itemCategoryId: string,
  skuLabel: string | null | undefined,
  sizeLabel?: string | null
): Promise<OrderVariant | null> {
  const sku = (skuLabel ?? "").trim();
  if (!sku) return null;

  const { data: products } = await db
    .from("inventory_products")
    .select("id")
    .eq("company_id", companyId)
    .eq("item_category_id", itemCategoryId);
  const productIds = ((products ?? []) as { id: string }[]).map((p) => p.id);
  if (productIds.length === 0) return null;

  const { data: variants } = await db
    .from("inventory_product_variants")
    .select("id, sku, size_label, sqft_per_piece, product_id")
    .in("product_id", productIds)
    .ilike("sku", sku);

  const rows = (variants ?? []) as OrderVariant[];
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0];

  const wantedSize = norm(sizeLabel);
  if (wantedSize) {
    const exact = rows.filter((v) => norm(v.size_label) === wantedSize);
    if (exact.length > 0) return exact[0];
  }
  return rows[0];
}

export type OrderAvailability = {
  tracked: boolean;
  readyPcs: number;
  readySqft: number;
  reservedPcs: number;
  reservedSqft: number;
  availablePcs: number;
  availableSqft: number;
};

const EMPTY_AVAILABILITY: OrderAvailability = {
  tracked: false,
  readyPcs: 0,
  readySqft: 0,
  reservedPcs: 0,
  reservedSqft: 0,
  availablePcs: 0,
  availableSqft: 0,
};

/** READY on hand minus everything already promised, summed over warehouses. */
export async function getOrderStockAvailability(
  db: InventoryDb,
  variantId: string
): Promise<OrderAvailability> {
  const [{ data: balances }, { data: reservations }] = await Promise.all([
    db.from("inventory_balances").select("pcs, sqft").eq("variant_id", variantId).eq("stage", "READY"),
    db
      .from("inventory_reservations")
      .select("pcs, sqft, fulfilled_pcs, fulfilled_sqft")
      .eq("variant_id", variantId)
      .eq("status", "ACTIVE"),
  ]);

  const sum = (rows: { pcs: number; sqft: number }[]) => ({
    pcs: rows.reduce((a, r) => a + Number(r.pcs), 0),
    sqft: rows.reduce((a, r) => a + Number(r.sqft), 0),
  });

  const ready = sum((balances ?? []) as { pcs: number; sqft: number }[]);
  const reserved = sum(
    ((reservations ?? []) as { pcs: number; sqft: number; fulfilled_pcs: number; fulfilled_sqft: number }[]).map((r) => ({
      pcs: Number(r.pcs) - Number(r.fulfilled_pcs),
      sqft: Number(r.sqft) - Number(r.fulfilled_sqft),
    }))
  );

  return {
    tracked: true,
    readyPcs: roundQty(ready.pcs),
    readySqft: roundQty(ready.sqft),
    reservedPcs: roundQty(reserved.pcs),
    reservedSqft: roundQty(reserved.sqft),
    availablePcs: roundQty(Math.max(ready.pcs - reserved.pcs, 0)),
    availableSqft: roundQty(Math.max(ready.sqft - reserved.sqft, 0)),
  };
}

/**
 * Availability for the order-entry badge. An order whose SKU inventory does
 * not track returns `tracked: false` so the form can fall back to the legacy
 * finished_stock figure instead of claiming "0 available".
 */
export async function orderSkuAvailability(
  db: InventoryDb,
  companyId: string,
  itemCategoryId: string,
  skuLabel: string | null | undefined,
  sizeLabel?: string | null
): Promise<OrderAvailability> {
  const variant = await findOrderVariant(db, companyId, itemCategoryId, skuLabel, sizeLabel);
  if (!variant) return EMPTY_AVAILABILITY;
  return getOrderStockAvailability(db, variant.id);
}

/**
 * The warehouse that can cover the most of this variant. READY stock usually
 * lives in one place; picking the fullest warehouse means one reservation
 * rather than several, and still falls back to the company's first warehouse
 * when nothing is on hand (the reservation then simply raises a requirement).
 */
export async function pickWarehouseForVariant(
  db: InventoryDb,
  companyId: string,
  variantId: string
): Promise<string | null> {
  const [{ data: warehouses }, { data: balances }, { data: reservations }] = await Promise.all([
    db.from("inventory_warehouses").select("id, active").eq("company_id", companyId).order("name"),
    db.from("inventory_balances").select("warehouse_id, pcs").eq("variant_id", variantId).eq("stage", "READY"),
    db
      .from("inventory_reservations")
      .select("warehouse_id, pcs, fulfilled_pcs")
      .eq("variant_id", variantId)
      .eq("status", "ACTIVE"),
  ]);

  const activeIds = ((warehouses ?? []) as { id: string; active: boolean }[])
    .filter((w) => w.active)
    .map((w) => w.id);
  if (activeIds.length === 0) return null;

  const free = new Map<string, number>(activeIds.map((id) => [id, 0]));
  for (const row of (balances ?? []) as { warehouse_id: string; pcs: number }[]) {
    if (free.has(row.warehouse_id)) free.set(row.warehouse_id, free.get(row.warehouse_id)! + Number(row.pcs));
  }
  for (const row of (reservations ?? []) as { warehouse_id: string; pcs: number; fulfilled_pcs: number }[]) {
    if (free.has(row.warehouse_id)) {
      free.set(row.warehouse_id, free.get(row.warehouse_id)! - (Number(row.pcs) - Number(row.fulfilled_pcs)));
    }
  }

  let best: string | null = null;
  let bestQty = 0;
  for (const id of activeIds) {
    const qty = free.get(id) ?? 0;
    if (qty > bestQty) {
      best = id;
      bestQty = qty;
    }
  }
  return best ?? activeIds[0];
}

export type ConfirmStockResult = {
  error: string | null;
  reservedPcs: number;
  shortfallPcs: number;
  requirementId: string | null;
  orderRef: string;
};

/**
 * Called when an order becomes Confirmed. Best effort by design: the order
 * status change must never fail because inventory is not configured yet, so
 * every "cannot link" case comes back as a message for the caller to ignore.
 */
export async function reserveOrderStockOnConfirm(
  db: InventoryDb,
  input: {
    companyId: string;
    orderId: string;
    orderRef: string;
    itemCategoryId: string;
    skuLabel: string | null;
    sizeLabel: string | null;
    qty: number;
    actorId: string;
  }
): Promise<ConfirmStockResult> {
  const base: ConfirmStockResult = {
    error: null,
    reservedPcs: 0,
    shortfallPcs: 0,
    requirementId: null,
    orderRef: input.orderRef,
  };

  if (!(input.qty > 0)) return { ...base, error: "Order quantity is zero." };
  const variant = await findOrderVariant(db, input.companyId, input.itemCategoryId, input.skuLabel, input.sizeLabel);
  if (!variant) return { ...base, error: `No inventory SKU matches “${input.skuLabel ?? ""}”.` };

  const warehouseId = await pickWarehouseForVariant(db, input.companyId, variant.id);
  if (!warehouseId) return { ...base, error: "No active warehouse is configured for this company." };

  const sqft = variant.sqft_per_piece == null ? 0 : roundQty(variant.sqft_per_piece * input.qty);
  const result = await reserveOrderStock(db, {
    orderId: input.orderId,
    variantId: variant.id,
    warehouseId,
    pcs: input.qty,
    sqft,
    actorId: input.actorId,
  });
  if (result.error || !result.data) return { ...base, error: result.error ?? "Could not reserve stock." };

  return {
    error: null,
    reservedPcs: result.data.reservedPcs,
    shortfallPcs: result.data.shortfallPcs,
    requirementId: result.data.requirementId,
    orderRef: input.orderRef,
  };
}

/** Releases the order's live reservations and cancels its open requirements. */
export async function releaseOrderStock(
  db: InventoryDb,
  input: { orderId: string; actorId: string; reason: string }
): Promise<{ error: string | null; released: number; cancelledRequirements: number }> {
  const result = await releaseOrderReservations(db, input);
  if (result.error || !result.data) {
    return { error: result.error ?? "Could not release this order's stock.", released: 0, cancelledRequirements: 0 };
  }
  return { error: null, released: result.data.released, cancelledRequirements: result.data.cancelled };
}

// Re-exported so callers only need one import for the badge maths.
export { summarizeAvailability };
