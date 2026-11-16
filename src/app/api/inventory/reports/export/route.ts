import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { inventoryApiAuth, searchParam } from "@/lib/inventory/api";

import { getLookups, listChallans, listLedger, listReservations, listStock, toCsv } from "@/lib/inventory/queries";
import { stageLabel, txTypeLabel } from "@/lib/inventory/stages";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await inventoryApiAuth("inventory_view");
  if (auth.errorResponse) return auth.errorResponse;
  const url = new URL(request.url);
  const type = searchParam(url, "type") || "current-stock";
  const db = createServiceRoleClientUnchecked();
  const companyId = auth.employee!.currentCompanyId;
  const lookups = await getLookups(db, companyId);
  const warehouseName = new Map(lookups.warehouses.map((w) => [w.id, w.name]));

  let headers: string[] = [];
  let rows: (string | number | null)[][] = [];

  if (type === "ledger" || type === "stock-movement" || type === "adjustments") {
    const entries = await listLedger(db, companyId, lookups, {
      variantId: searchParam(url, "sku"),
      stage: searchParam(url, "stage"),
      txType: type === "adjustments" ? "ADJUSTMENT" : searchParam(url, "tx"),
      from: searchParam(url, "from"),
      to: searchParam(url, "to"),
      limit: 5000,
    });
    headers = ["Date", "SKU", "Product", "Warehouse", "Stage", "Transaction", "PCS delta", "PCS after", "SQ FT delta", "SQ FT after", "Reference", "Remarks"];
    rows = entries.map((l) => [
      new Date(l.createdAt).toISOString(), l.meta.sku, l.meta.productName, l.warehouseName,
      stageLabel(l.stage), txTypeLabel(l.txType), l.pcsDelta, l.newPcs, l.sqftDelta, l.newSqft,
      l.refNo ?? "", l.remarks ?? "",
    ]);
  } else if (type === "reserved") {
    const reservations = await listReservations(db, companyId, lookups, "ACTIVE");
    headers = ["Order", "SKU", "Product", "Warehouse", "PCS", "Fulfilled", "Open", "SQ FT", "Created"];
    rows = reservations.map((r) => [r.orderRef, r.meta.sku, r.meta.productName, r.warehouseName, r.pcs, r.fulfilledPcs, r.pcs - r.fulfilledPcs, r.sqft, new Date(r.createdAt).toISOString()]);
  } else if (type === "challans") {
    const challans = await listChallans(db, companyId, lookups, 2000);
    headers = ["Challan", "Date", "Status", "Issued", "Party", "SKU", "Order", "PCS", "SQ FT"];
    rows = challans.flatMap((c) =>
      c.lines.map((l) => [c.chalanNo, c.chalanDate, c.status, c.issueDate ?? "", c.partyName ?? "", l.sku, l.orderRef ?? "", l.pcs, l.sqft])
    );
  } else {
    const lines = await listStock(db, companyId, lookups, {
      categoryId: searchParam(url, "category"),
      warehouseId: searchParam(url, "warehouse"),
      stage: searchParam(url, "stage"),
      search: searchParam(url, "q"),
    });
    const filtered = type === "low-stock"
      ? lines.filter((l) => l.stage === "READY" && l.meta.minStockPcs > 0 && l.pcs < l.meta.minStockPcs)
      : type === "rejected"
        ? lines.filter((l) => l.stage === "REJECTED")
        : lines;
    headers = ["SKU", "Product", "Category", "Size", "Colour", "Warehouse", "Stage", "PCS", "SQ FT", "Minimum", "Updated"];
    rows = filtered.map((l) => [
      l.meta.sku, l.meta.productName, l.meta.categoryName, l.meta.sizeLabel, l.meta.colour,
      warehouseName.get(l.warehouseId) ?? "", stageLabel(l.stage), l.pcs, l.sqft, l.meta.minStockPcs,
      new Date(l.updatedAt).toISOString(),
    ]);
  }

  const csv = toCsv(headers, rows);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="inventory-${type}-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
