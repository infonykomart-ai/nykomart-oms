// Read-side queries for the Inventory module. The inventory tables are small
// (one row per SKU × warehouse × stage), so rows are fetched separately and
// joined in TypeScript instead of relying on deeply nested embedded selects —
// easier to read, and it keeps the queries valid against the unchecked client.
import type { InventoryDb } from "./service";
import type { InventoryStage } from "./stages";

export type ProductRow = {
  id: string;
  name: string;
  product_code: string;
  item_category_id: string;
  stock_unit: string;
  purchase_type: string;
  manufacturing_enabled: boolean;
  processing_required: boolean;
  min_stock_pcs: number;
  active: boolean;
  image_url: string | null;
};

export type VariantRow = {
  id: string;
  product_id: string;
  sku: string;
  size_label: string;
  colour: string;
  length_ft: number | null;
  width_ft: number | null;
  sqft_per_piece: number | null;
  active: boolean;
};

export type WarehouseRow = { id: string; name: string; code: string; active: boolean };
export type BalanceRow = {
  id: string;
  variant_id: string;
  warehouse_id: string;
  stage: InventoryStage;
  pcs: number;
  sqft: number;
  updated_at: string;
};

export type InventoryLookups = {
  products: ProductRow[];
  variants: VariantRow[];
  categories: { id: string; name: string }[];
  warehouses: WarehouseRow[];
  parties: { id: string; name: string }[];
  categorySettings: {
    item_category_id: string;
    is_order_based: boolean;
    requires_printing: boolean;
    requires_washing: boolean;
    manufacturing_enabled: boolean;
    sqft_tracked: boolean;
  }[];
};

export async function getLookups(db: InventoryDb, companyId: string): Promise<InventoryLookups> {
  const [{ data: products }, { data: warehouses }, { data: categories }, { data: parties }, { data: settings }] =
    await Promise.all([
      db
        .from("inventory_products")
        .select(
          "id, name, product_code, item_category_id, stock_unit, purchase_type, manufacturing_enabled, processing_required, min_stock_pcs, active, image_url"
        )
        .eq("company_id", companyId)
        .order("name"),
      db.from("inventory_warehouses").select("id, name, code, active").eq("company_id", companyId).order("name"),
      db.from("item_categories").select("id, name").order("name"),
      db.from("parties").select("id, name").order("name"),
      db
        .from("inventory_category_settings")
        .select("item_category_id, is_order_based, requires_printing, requires_washing, manufacturing_enabled, sqft_tracked")
        .eq("company_id", companyId),
    ]);

  const productRows = (products ?? []) as ProductRow[];
  const productIds = productRows.map((p) => p.id);
  const { data: variants } = productIds.length
    ? await db
        .from("inventory_product_variants")
        .select("id, product_id, sku, size_label, colour, length_ft, width_ft, sqft_per_piece, active")
        .in("product_id", productIds)
        .order("sku")
    : { data: [] };

  return {
    products: productRows,
    variants: (variants ?? []) as VariantRow[],
    categories: categories ?? [],
    warehouses: (warehouses ?? []) as WarehouseRow[],
    parties: parties ?? [],
    categorySettings: settings ?? [],
  };
}

export type VariantMeta = {
  sku: string;
  sizeLabel: string;
  colour: string;
  sqftPerPiece: number | null;
  productName: string;
  productCode: string;
  categoryName: string;
  categoryId: string;
  minStockPcs: number;
  imageUrl: string | null;
};

export function variantMetaMap(lookups: InventoryLookups): Map<string, VariantMeta> {
  const productById = new Map(lookups.products.map((p) => [p.id, p]));
  const categoryById = new Map(lookups.categories.map((c) => [c.id, c.name]));
  const map = new Map<string, VariantMeta>();
  for (const v of lookups.variants) {
    const product = productById.get(v.product_id);
    if (!product) continue;
    map.set(v.id, {
      sku: v.sku,
      sizeLabel: v.size_label,
      colour: v.colour,
      sqftPerPiece: v.sqft_per_piece === null ? null : Number(v.sqft_per_piece),
      productName: product.name,
      productCode: product.product_code,
      categoryName: categoryById.get(product.item_category_id) ?? "—",
      categoryId: product.item_category_id,
      minStockPcs: Number(product.min_stock_pcs ?? 0),
      imageUrl: product.image_url,
    });
  }
  return map;
}

export type StockLine = {
  variantId: string;
  warehouseId: string;
  stage: InventoryStage;
  pcs: number;
  sqft: number;
  updatedAt: string;
  meta: VariantMeta;
};

export type StockFilters = {
  categoryId?: string;
  variantId?: string;
  warehouseId?: string;
  stage?: string;
  search?: string;
};

export async function listStock(
  db: InventoryDb,
  companyId: string,
  lookups: InventoryLookups,
  filters: StockFilters = {}
): Promise<StockLine[]> {
  let query = db
    .from("inventory_balances")
    .select("id, variant_id, warehouse_id, stage, pcs, sqft, updated_at")
    .eq("company_id", companyId)
    .order("updated_at", { ascending: false })
    .limit(2000);
  if (filters.warehouseId) query = query.eq("warehouse_id", filters.warehouseId);
  if (filters.stage) query = query.eq("stage", filters.stage);
  if (filters.variantId) query = query.eq("variant_id", filters.variantId);

  const { data } = await query;
  const meta = variantMetaMap(lookups);
  const search = (filters.search ?? "").trim().toLowerCase();

  return ((data ?? []) as BalanceRow[])
    .map((row) => ({ ...row }))
    .filter((row) => {
      const m = meta.get(row.variant_id);
      if (!m) return false;
      if (filters.categoryId && m.categoryId !== filters.categoryId) return false;
      if (search && !`${m.sku} ${m.productName} ${m.sizeLabel} ${m.colour}`.toLowerCase().includes(search)) return false;
      return true;
    })
    .map((row) => ({
      variantId: row.variant_id,
      warehouseId: row.warehouse_id,
      stage: row.stage,
      pcs: Number(row.pcs),
      sqft: Number(row.sqft),
      updatedAt: row.updated_at,
      meta: meta.get(row.variant_id)!,
    }));
}

export type DashboardData = {
  totals: {
    physicalPcs: number;
    physicalSqft: number;
    availablePcs: number;
    availableSqft: number;
    reservedPcs: number;
    printingPcs: number;
    washingPcs: number;
    manufacturingPcs: number;
    readyPcs: number;
    readySqft: number;
    qcRejectedPcs: number;
    dispatchedPcs: number;
    dispatchedSqft: number;
  };
  lowStock: StockLine[];
  outOfStock: StockLine[];
  overdueJobs: number;
  pendingProcessing: number;
  pendingManufacturing: number;
  reconcileMismatches: number;
  recentLedger: LedgerLine[];
  stockLines: StockLine[];
};

export async function getDashboard(
  db: InventoryDb,
  companyId: string,
  lookups: InventoryLookups,
  filters: StockFilters = {}
): Promise<DashboardData> {
  const stockLines = await listStock(db, companyId, lookups, filters);
  const allLines = await listStock(db, companyId, lookups, {});

  const [{ data: reservations }, { data: processingJobs }, { data: manufacturingJobs }, { data: reconcile }] =
    await Promise.all([
      db
        .from("inventory_reservations")
        .select("variant_id, pcs, sqft, fulfilled_pcs, fulfilled_sqft")
        .eq("company_id", companyId)
        .eq("status", "ACTIVE"),
      db
        .from("inventory_processing_jobs")
        .select("id, status, expected_date, pcs_sent, pcs_accepted, pcs_rejected")
        .eq("company_id", companyId)
        .in("status", ["OPEN", "PARTIAL"]),
      db
        .from("inventory_manufacturing_jobs")
        .select("id, status")
        .eq("company_id", companyId)
        .in("status", ["OPEN", "PARTIAL"]),
      db.rpc("inventory_reconcile"),
    ]);

  const sum = (rows: { pcs: number; sqft: number }[]) => ({
    pcs: rows.reduce((a, r) => a + Number(r.pcs), 0),
    sqft: rows.reduce((a, r) => a + Number(r.sqft), 0),
  });

  const byStage = (stage: InventoryStage) => sum(allLines.filter((l) => l.stage === stage));
  const ready = byStage("READY");
  const reservedRows = (reservations ?? []).map(
    (r: { variant_id: string; pcs: number; sqft: number; fulfilled_pcs: number; fulfilled_sqft: number }) => ({
      variantId: r.variant_id,
      pcs: Number(r.pcs) - Number(r.fulfilled_pcs),
      sqft: Number(r.sqft) - Number(r.fulfilled_sqft),
    })
  );
  const reserved = sum(reservedRows);
  const printing = byStage("PRINTING");
  const washing = byStage("WASHING");
  const manufacturing = byStage("MANUFACTURING");
  const rejected = byStage("REJECTED");
  const inStockStages: InventoryStage[] = ["RAW", "PRINTING", "WASHING", "MANUFACTURING", "QC", "READY"];
  const physical = sum(allLines.filter((l) => inStockStages.includes(l.stage)));

  const readyByVariant = new Map<string, { pcs: number; sqft: number; line: StockLine }>();
  for (const line of stockLines) {
    if (line.stage !== "READY") continue;
    const current = readyByVariant.get(line.variantId);
    readyByVariant.set(line.variantId, {
      pcs: (current?.pcs ?? 0) + line.pcs,
      sqft: (current?.sqft ?? 0) + line.sqft,
      line,
    });
  }
  const openReserved = new Map<string, number>();
  for (const r of reservedRows) {
    openReserved.set(r.variantId, (openReserved.get(r.variantId) ?? 0) + r.pcs);
  }

  const outOfStock = Array.from(readyByVariant.values())
    .filter((row) => row.pcs <= 0)
    .map((row) => row.line);
  const lowStock = Array.from(readyByVariant.values())
    .filter((row) => row.line.meta.minStockPcs > 0 && row.pcs - (openReserved.get(row.line.variantId) ?? 0) < row.line.meta.minStockPcs)
    .map((row) => row.line);

  const today = new Date().toISOString().slice(0, 10);
  const overdueJobs = (processingJobs ?? []).filter(
    (j: { expected_date: string | null; status: string }) => j.expected_date && j.expected_date < today && j.status !== "COMPLETED"
  ).length;

  const recentLedger = await listLedger(db, companyId, lookups, { limit: 15 });

  // Dispatched total is the sum of issued challan lines — the actual goods that
  // left, not the ledger's DISPATCHED stage (challan issue deducts READY).
  const { data: issuedChallans } = await db
    .from("inventory_challans")
    .select("id")
    .eq("company_id", companyId)
    .eq("status", "ISSUED");
  const issuedIds = (issuedChallans ?? []).map((c: { id: string }) => c.id);
  const { data: issuedLines } = issuedIds.length
    ? await db.from("inventory_challan_lines").select("pcs, sqft").in("chalan_id", issuedIds)
    : { data: [] };
  const dispatched = sum((issuedLines ?? []) as { pcs: number; sqft: number }[]);

  return {
    totals: {
      physicalPcs: physical.pcs,
      physicalSqft: physical.sqft,
      availablePcs: Math.max(ready.pcs - reserved.pcs, 0),
      availableSqft: Math.max(ready.sqft - reserved.sqft, 0),
      reservedPcs: reserved.pcs,
      printingPcs: printing.pcs,
      washingPcs: washing.pcs,
      manufacturingPcs: manufacturing.pcs,
      readyPcs: ready.pcs,
      readySqft: ready.sqft,
      qcRejectedPcs: rejected.pcs,
      dispatchedPcs: dispatched.pcs,
      dispatchedSqft: dispatched.sqft,
    },
    lowStock,
    outOfStock,
    overdueJobs,
    pendingProcessing: (processingJobs ?? []).length,
    pendingManufacturing: (manufacturingJobs ?? []).length,
    reconcileMismatches: Array.isArray(reconcile) ? reconcile.length : 0,
    recentLedger,
    stockLines,
  };
}

export type RequirementLine = {
  id: string;
  orderId: string | null;
  orderRef: string | null;
  variantId: string;
  meta: VariantMeta;
  requiredPcs: number;
  status: string;
  neededBy: string | null;
  remarks: string | null;
  createdAt: string;
};

/**
 * Phase 4 — open purchase requirements raised when a confirmed order could not
 * be covered by READY stock. Newest first; closed rows stay out of the way.
 */
export async function listPurchaseRequirements(
  db: InventoryDb,
  companyId: string,
  lookups: InventoryLookups,
  limit = 50
): Promise<RequirementLine[]> {
  const { data } = await db
    .from("inventory_purchase_requirements")
    .select("id, order_id, variant_id, required_pcs, status, needed_by, remarks, created_at")
    .eq("company_id", companyId)
    .eq("status", "OPEN")
    .order("created_at", { ascending: false })
    .limit(limit);

  const rows = (data ?? []) as {
    id: string;
    order_id: string | null;
    variant_id: string;
    required_pcs: number;
    status: string;
    needed_by: string | null;
    remarks: string | null;
    created_at: string;
  }[];
  if (rows.length === 0) return [];

  const meta = variantMetaMap(lookups);
  const orderIds = [...new Set(rows.map((r) => r.order_id).filter((id): id is string => !!id))];
  const { data: orders } = orderIds.length
    ? await db.from("orders").select("id, ref_no").in("id", orderIds)
    : { data: [] };
  const refByOrder = new Map(((orders ?? []) as { id: string; ref_no: string }[]).map((o) => [o.id, o.ref_no]));

  return rows
    .filter((r) => meta.has(r.variant_id))
    .map((r) => ({
      id: r.id,
      orderId: r.order_id,
      orderRef: r.order_id ? refByOrder.get(r.order_id) ?? null : null,
      variantId: r.variant_id,
      meta: meta.get(r.variant_id)!,
      requiredPcs: Number(r.required_pcs),
      status: r.status,
      neededBy: r.needed_by,
      remarks: r.remarks,
      createdAt: r.created_at,
    }));
}

export type LedgerLine = {
  id: string;
  createdAt: string;
  txType: string;
  stage: string;
  pcsDelta: number;
  sqftDelta: number;
  newPcs: number;
  newSqft: number;
  refNo: string | null;
  refType: string | null;
  remarks: string | null;
  meta: VariantMeta;
  warehouseName: string;
};

export async function listLedger(
  db: InventoryDb,
  companyId: string,
  lookups: InventoryLookups,
  filters: { variantId?: string; stage?: string; txType?: string; from?: string; to?: string; limit?: number } = {}
): Promise<LedgerLine[]> {
  let query = db
    .from("inventory_ledger")
    .select("id, variant_id, warehouse_id, stage, tx_type, pcs_delta, sqft_delta, new_pcs, new_sqft, ref_no, ref_type, remarks, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(filters.limit ?? 300);
  if (filters.variantId) query = query.eq("variant_id", filters.variantId);
  if (filters.stage) query = query.eq("stage", filters.stage);
  if (filters.txType) query = query.eq("tx_type", filters.txType);
  if (filters.from) query = query.gte("created_at", `${filters.from}T00:00:00`);
  if (filters.to) query = query.lte("created_at", `${filters.to}T23:59:59`);

  const { data } = await query;
  const meta = variantMetaMap(lookups);
  const warehouseName = new Map(lookups.warehouses.map((w) => [w.id, w.name]));
  return ((data ?? []) as {
    id: string;
    variant_id: string;
    warehouse_id: string;
    stage: string;
    tx_type: string;
    pcs_delta: number;
    sqft_delta: number;
    new_pcs: number;
    new_sqft: number;
    ref_no: string | null;
    ref_type: string | null;
    remarks: string | null;
    created_at: string;
  }[])
    .filter((r) => meta.has(r.variant_id))
    .map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      txType: r.tx_type,
      stage: r.stage,
      pcsDelta: Number(r.pcs_delta),
      sqftDelta: Number(r.sqft_delta),
      newPcs: Number(r.new_pcs),
      newSqft: Number(r.new_sqft),
      refNo: r.ref_no,
      refType: r.ref_type,
      remarks: r.remarks,
      meta: meta.get(r.variant_id)!,
      warehouseName: warehouseName.get(r.warehouse_id) ?? "—",
    }));
}

export type ReservationLine = {
  id: string;
  orderRef: string;
  pcs: number;
  sqft: number;
  fulfilledPcs: number;
  status: string;
  createdAt: string;
  meta: VariantMeta;
  warehouseName: string;
};

export async function listReservations(
  db: InventoryDb,
  companyId: string,
  lookups: InventoryLookups,
  status = "ACTIVE"
): Promise<ReservationLine[]> {
  let query = db
    .from("inventory_reservations")
    .select("id, order_id, variant_id, warehouse_id, pcs, sqft, fulfilled_pcs, status, created_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(300);
  if (status !== "ALL") query = query.eq("status", status);
  const { data } = await query;
  const rows = (data ?? []) as {
    id: string;
    order_id: string;
    variant_id: string;
    warehouse_id: string;
    pcs: number;
    sqft: number;
    fulfilled_pcs: number;
    status: string;
    created_at: string;
  }[];
  const orderIds = [...new Set(rows.map((r) => r.order_id))];
  const { data: orders } = orderIds.length
    ? await db.from("orders").select("id, ref_no").in("id", orderIds)
    : { data: [] };
  const orderRef = new Map((orders ?? []).map((o: { id: string; ref_no: string }) => [o.id, o.ref_no]));
  const meta = variantMetaMap(lookups);
  const warehouseName = new Map(lookups.warehouses.map((w) => [w.id, w.name]));
  return rows
    .filter((r) => meta.has(r.variant_id))
    .map((r) => ({
      id: r.id,
      orderRef: orderRef.get(r.order_id) ?? "—",
      pcs: Number(r.pcs),
      sqft: Number(r.sqft),
      fulfilledPcs: Number(r.fulfilled_pcs),
      status: r.status,
      createdAt: r.created_at,
      meta: meta.get(r.variant_id)!,
      warehouseName: warehouseName.get(r.warehouse_id) ?? "—",
    }));
}

export type ChallanLine = {
  id: string;
  chalanNo: string;
  chalanDate: string;
  status: string;
  partyName: string | null;
  issueDate: string | null;
  dispatchedAt: string | null;
  remarks: string | null;
  lines: {
    id: string;
    sku: string;
    productName: string;
    orderRef: string | null;
    pcs: number;
    sqft: number;
  }[];
};

export async function listChallans(db: InventoryDb, companyId: string, lookups: InventoryLookups, limit = 100): Promise<ChallanLine[]> {
  const { data: challans } = await db
    .from("inventory_challans")
    .select("id, chalan_no, chalan_date, status, party_id, issue_date, dispatched_at, remarks")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const rows = (challans ?? []) as {
    id: string;
    chalan_no: string;
    chalan_date: string;
    status: string;
    party_id: string | null;
    issue_date: string | null;
    dispatched_at: string | null;
    remarks: string | null;
  }[];
  const ids = rows.map((r) => r.id);
  const { data: lines } = ids.length
    ? await db
        .from("inventory_challan_lines")
        .select("id, chalan_id, order_id, variant_id, pcs, sqft")
        .in("chalan_id", ids)
    : { data: [] };
  const orderIds = [...new Set(((lines ?? []) as { order_id: string | null }[]).map((l) => l.order_id).filter((id): id is string => !!id))];
  const { data: orders } = orderIds.length
    ? await db.from("orders").select("id, ref_no").in("id", orderIds)
    : { data: [] };
  const orderRef = new Map((orders ?? []).map((o: { id: string; ref_no: string }) => [o.id, o.ref_no]));
  const partyName = new Map(lookups.parties.map((p) => [p.id, p.name]));
  const meta = variantMetaMap(lookups);

  return rows.map((r) => ({
    id: r.id,
    chalanNo: r.chalan_no,
    chalanDate: r.chalan_date,
    status: r.status,
    partyName: r.party_id ? partyName.get(r.party_id) ?? null : null,
    issueDate: r.issue_date,
    dispatchedAt: r.dispatched_at,
    remarks: r.remarks,
    lines: ((lines ?? []) as {
      id: string;
      chalan_id: string;
      order_id: string | null;
      variant_id: string;
      pcs: number;
      sqft: number;
    }[])
      .filter((l) => l.chalan_id === r.id)
      .map((l) => ({
        id: l.id,
        sku: meta.get(l.variant_id)?.sku ?? "—",
        productName: meta.get(l.variant_id)?.productName ?? "—",
        orderRef: l.order_id ? orderRef.get(l.order_id) ?? null : null,
        pcs: Number(l.pcs),
        sqft: Number(l.sqft),
      })),
  }));
}

export type ProcessingJob = {
  id: string;
  jobNo: string;
  process: string;
  status: string;
  sku: string;
  productName: string;
  pcsSent: number;
  sqftSent: number;
  pcsAccepted: number;
  pcsRejected: number;
  pendingPcs: number;
  sentDate: string;
  expectedDate: string | null;
  vendorName: string | null;
  remarks: string | null;
};

export async function listProcessingJobs(db: InventoryDb, companyId: string, lookups: InventoryLookups): Promise<ProcessingJob[]> {
  const { data } = await db
    .from("inventory_processing_jobs")
    .select(
      "id, job_no, process, status, variant_id, vendor_party_id, pcs_sent, sqft_sent, pcs_accepted, pcs_rejected, sent_date, expected_date, remarks"
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(300);
  const meta = variantMetaMap(lookups);
  const parties = new Map(lookups.parties.map((p) => [p.id, p.name]));
  return ((data ?? []) as {
    id: string;
    job_no: string;
    process: string;
    status: string;
    variant_id: string;
    vendor_party_id: string | null;
    pcs_sent: number;
    sqft_sent: number;
    pcs_accepted: number;
    pcs_rejected: number;
    sent_date: string;
    expected_date: string | null;
    remarks: string | null;
  }[])
    .filter((j) => meta.has(j.variant_id))
    .map((j) => ({
      id: j.id,
      jobNo: j.job_no,
      process: j.process,
      status: j.status,
      sku: meta.get(j.variant_id)!.sku,
      productName: meta.get(j.variant_id)!.productName,
      pcsSent: Number(j.pcs_sent),
      sqftSent: Number(j.sqft_sent),
      pcsAccepted: Number(j.pcs_accepted),
      pcsRejected: Number(j.pcs_rejected),
      pendingPcs: Number(j.pcs_sent) - Number(j.pcs_accepted) - Number(j.pcs_rejected),
      sentDate: j.sent_date,
      expectedDate: j.expected_date,
      vendorName: j.vendor_party_id ? parties.get(j.vendor_party_id) ?? null : null,
      remarks: j.remarks,
    }));
}

export type ManufacturingJob = {
  id: string;
  jobNo: string;
  status: string;
  sku: string;
  productName: string;
  plannedPcs: number;
  producedPcs: number;
  acceptedPcs: number;
  rejectedPcs: number;
  pendingPcs: number;
  startDate: string | null;
  completedAt: string | null;
  remarks: string | null;
};

export async function listManufacturingJobs(
  db: InventoryDb,
  companyId: string,
  lookups: InventoryLookups
): Promise<ManufacturingJob[]> {
  const { data } = await db
    .from("inventory_manufacturing_jobs")
    .select(
      "id, job_no, status, variant_id, planned_pcs, produced_pcs, accepted_pcs, rejected_pcs, start_date, completed_at, remarks"
    )
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(200);
  const meta = variantMetaMap(lookups);
  return ((data ?? []) as {
    id: string;
    job_no: string;
    status: string;
    variant_id: string;
    planned_pcs: number;
    produced_pcs: number;
    accepted_pcs: number;
    rejected_pcs: number;
    start_date: string | null;
    completed_at: string | null;
    remarks: string | null;
  }[])
    .filter((j) => meta.has(j.variant_id))
    .map((j) => ({
      id: j.id,
      jobNo: j.job_no,
      status: j.status,
      sku: meta.get(j.variant_id)!.sku,
      productName: meta.get(j.variant_id)!.productName,
      plannedPcs: Number(j.planned_pcs),
      producedPcs: Number(j.produced_pcs),
      acceptedPcs: Number(j.accepted_pcs),
      rejectedPcs: Number(j.rejected_pcs),
      pendingPcs: Number(j.planned_pcs) - Number(j.accepted_pcs) - Number(j.rejected_pcs),
      startDate: j.start_date,
      completedAt: j.completed_at,
      remarks: j.remarks,
    }));
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const escape = (value: string | number | null | undefined) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers.map(escape).join(","), ...rows.map((r) => r.map(escape).join(","))].join("\n");
}
