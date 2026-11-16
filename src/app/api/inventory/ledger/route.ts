import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { inventoryApiAuth, ok, searchParam } from "@/lib/inventory/api";

import { getLookups, listLedger } from "@/lib/inventory/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await inventoryApiAuth("inventory_view");
  if (auth.errorResponse) return auth.errorResponse;
  const url = new URL(request.url);
  const db = createServiceRoleClientUnchecked();
  const lookups = await getLookups(db, auth.employee!.currentCompanyId);
  const rows = await listLedger(db, auth.employee!.currentCompanyId, lookups, {
    variantId: searchParam(url, "sku"),
    stage: searchParam(url, "stage"),
    txType: searchParam(url, "tx"),
    from: searchParam(url, "from"),
    to: searchParam(url, "to"),
    limit: 500,
  });
  return ok(rows);
}
