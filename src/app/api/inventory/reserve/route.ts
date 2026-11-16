import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { inventoryApiAuth, badRequest, ok, readJson, bodyStr, bodyNum, bodyNumOrNull } from "@/lib/inventory/api";

import { reserveStock, resolveOrderByRef } from "@/lib/inventory/service";

export async function POST(request: Request) {
  const auth = await inventoryApiAuth("inventory_manage");
  if (auth.errorResponse) return auth.errorResponse;
  const body = await readJson(request);
  const db = createServiceRoleClientUnchecked();

  let orderId = bodyStr(body, "orderId");
  if (!orderId) {
    const lookup = await resolveOrderByRef(db, auth.employee!.currentCompanyId, bodyStr(body, "orderRef"));
    if (lookup.error) return badRequest(lookup.error);
    orderId = lookup.order!.id;
  }

  const result = await reserveStock(db, {
    orderId,
    variantId: bodyStr(body, "variantId"),
    warehouseId: bodyStr(body, "warehouseId"),
    pcs: bodyNum(body, "pcs"),
    sqft: bodyNumOrNull(body, "sqft"),
    actorId: auth.employee!.id,
  });
  if (result.error) return badRequest(result.error);
  return ok(result.data, 201);
}
