import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { inventoryApiAuth, ok, searchParam } from "@/lib/inventory/api";

import { getLookups, listStock } from "@/lib/inventory/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await inventoryApiAuth("inventory_view");
  if (auth.errorResponse) return auth.errorResponse;
  const url = new URL(request.url);
  const db = createServiceRoleClientUnchecked();
  const lookups = await getLookups(db, auth.employee!.currentCompanyId);
  const lines = await listStock(db, auth.employee!.currentCompanyId, lookups, {
    categoryId: searchParam(url, "category"),
    warehouseId: searchParam(url, "warehouse"),
    stage: searchParam(url, "stage"),
    search: searchParam(url, "q"),
  });
  return ok(lines);
}
