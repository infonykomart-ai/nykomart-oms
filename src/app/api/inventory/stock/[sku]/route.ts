import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { inventoryApiAuth, ok } from "@/lib/inventory/api";

import { getLookups, listStock } from "@/lib/inventory/queries";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ sku: string }> }) {
  const auth = await inventoryApiAuth("inventory_view");
  if (auth.errorResponse) return auth.errorResponse;
  const { sku } = await context.params;
  const db = createServiceRoleClientUnchecked();
  const lookups = await getLookups(db, auth.employee!.currentCompanyId);
  const lines = await listStock(db, auth.employee!.currentCompanyId, lookups, { search: sku });
  const exact = lines.filter((l) => l.meta.sku.toLowerCase() === sku.toLowerCase());
  return ok({ sku, lines: exact.length ? exact : lines });
}
