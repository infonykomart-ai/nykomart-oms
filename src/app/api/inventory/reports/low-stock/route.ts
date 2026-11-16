import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { inventoryApiAuth, ok } from "@/lib/inventory/api";

import { getDashboard, getLookups } from "@/lib/inventory/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await inventoryApiAuth("inventory_view");
  if (auth.errorResponse) return auth.errorResponse;
  const db = createServiceRoleClientUnchecked();
  const lookups = await getLookups(db, auth.employee!.currentCompanyId);
  const data = await getDashboard(db, auth.employee!.currentCompanyId, lookups, {});
  return ok({ lowStock: data.lowStock, outOfStock: data.outOfStock });
}
