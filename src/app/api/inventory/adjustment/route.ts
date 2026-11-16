import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { inventoryApiAuth, badRequest, ok, readJson, bodyStr, bodyNum } from "@/lib/inventory/api";

import { adjustStock } from "@/lib/inventory/service";
import type { InventoryStage } from "@/lib/inventory/stages";

export async function POST(request: Request) {
  const auth = await inventoryApiAuth("inventory_manage");
  if (auth.errorResponse) return auth.errorResponse;
  const body = await readJson(request);
  const result = await adjustStock(createServiceRoleClientUnchecked(), {
    companyId: auth.employee!.currentCompanyId,
    variantId: bodyStr(body, "variantId"),
    warehouseId: bodyStr(body, "warehouseId"),
    stage: (bodyStr(body, "stage") || "READY") as InventoryStage,
    pcsDelta: bodyNum(body, "pcsDelta"),
    sqftDelta: bodyNum(body, "sqftDelta"),
    reason: bodyStr(body, "reason"),
    remarks: bodyStr(body, "remarks"),
    actorId: auth.employee!.id,
  });
  if (result.error) return badRequest(result.error);
  return ok(result.data, 201);
}
