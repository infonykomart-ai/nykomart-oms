import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { inventoryApiAuth, ok, searchParam } from "@/lib/inventory/api";

import { getLookups, getDashboard } from "@/lib/inventory/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await inventoryApiAuth("inventory_view");
  if (auth.errorResponse) return auth.errorResponse;
  const url = new URL(request.url);
  const db = createServiceRoleClientUnchecked();
  const lookups = await getLookups(db, auth.employee!.currentCompanyId);
  const data = await getDashboard(db, auth.employee!.currentCompanyId, lookups, {
    categoryId: searchParam(url, "category"),
    warehouseId: searchParam(url, "warehouse"),
    stage: searchParam(url, "stage"),
    search: searchParam(url, "q"),
  });
  return ok({ totals: data.totals, lowStock: data.lowStock, outOfStock: data.outOfStock, alerts: {
    overdueJobs: data.overdueJobs,
    pendingProcessing: data.pendingProcessing,
    pendingManufacturing: data.pendingManufacturing,
    reconcileMismatches: data.reconcileMismatches,
  } });
}
