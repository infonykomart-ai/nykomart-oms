import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { inventoryApiAuth, badRequest, ok, readJson, bodyStr } from "@/lib/inventory/api";

import { cancelChallan } from "@/lib/inventory/service";

export async function POST(request: Request) {
  const auth = await inventoryApiAuth("inventory_dispatch");
  if (auth.errorResponse) return auth.errorResponse;
  const body = await readJson(request);
  const result = await cancelChallan(createServiceRoleClientUnchecked(), {
    challanId: bodyStr(body, "challanId"),
    companyId: auth.employee!.currentCompanyId,
    reason: bodyStr(body, "reason"),
    actorId: auth.employee!.id,
  });
  if (result.error) return badRequest(result.error);
  return ok(result.data);
}
