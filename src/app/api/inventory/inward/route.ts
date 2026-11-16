import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { inventoryApiAuth, badRequest, ok, readJson, bodyStr, bodyNum, bodyNumOrNull } from "@/lib/inventory/api";

import { postStockInward } from "@/lib/inventory/service";
import type { InventoryStage, StockSource } from "@/lib/inventory/stages";

export async function POST(request: Request) {
  const auth = await inventoryApiAuth("inventory_manage");
  if (auth.errorResponse) return auth.errorResponse;
  const body = await readJson(request);
  const result = await postStockInward(createServiceRoleClientUnchecked(), {
    companyId: auth.employee!.currentCompanyId,
    variantId: bodyStr(body, "variantId"),
    warehouseId: bodyStr(body, "warehouseId"),
    stage: (bodyStr(body, "stage") || "READY") as InventoryStage,
    source: (bodyStr(body, "source") || "MANUAL") as StockSource,
    pcs: bodyNum(body, "pcs"),
    sqft: bodyNumOrNull(body, "sqft"),
    reference: bodyStr(body, "reference") || null,
    remarks: bodyStr(body, "remarks") || null,
    idempotencyKey: bodyStr(body, "idempotencyKey") || null,
    actorId: auth.employee!.id,
  });
  if (result.error) return badRequest(result.error);
  return ok(result.data, 201);
}
