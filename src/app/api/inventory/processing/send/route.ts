import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { inventoryApiAuth, badRequest, ok, readJson, bodyStr, bodyNum, bodyNumOrNull } from "@/lib/inventory/api";

import { startProcessing } from "@/lib/inventory/service";

export async function POST(request: Request) {
  const auth = await inventoryApiAuth("inventory_manage");
  if (auth.errorResponse) return auth.errorResponse;
  const body = await readJson(request);
  const result = await startProcessing(createServiceRoleClientUnchecked(), {
    companyId: auth.employee!.currentCompanyId,
    variantId: bodyStr(body, "variantId"),
    warehouseId: bodyStr(body, "warehouseId"),
    process: bodyStr(body, "process") === "WASHING" ? "WASHING" : "PRINTING",
    pcs: bodyNum(body, "pcs"),
    sqft: bodyNumOrNull(body, "sqft"),
    orderId: bodyStr(body, "orderId") || null,
    vendorPartyId: bodyStr(body, "vendorPartyId") || null,
    expectedDate: bodyStr(body, "expectedDate") || null,
    remarks: bodyStr(body, "remarks") || null,
    actorId: auth.employee!.id,
  });
  if (result.error) return badRequest(result.error);
  return ok(result.data, 201);
}
