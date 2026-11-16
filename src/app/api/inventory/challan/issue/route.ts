import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { inventoryApiAuth, badRequest, ok, readJson, bodyStr } from "@/lib/inventory/api";

import { issueChallan } from "@/lib/inventory/service";

export async function POST(request: Request) {
  const auth = await inventoryApiAuth("inventory_dispatch");
  if (auth.errorResponse) return auth.errorResponse;
  const body = await readJson(request);
  const result = await issueChallan(createServiceRoleClientUnchecked(), {
    challanId: bodyStr(body, "challanId"),
    companyId: auth.employee!.currentCompanyId,
    actorId: auth.employee!.id,
  });
  if (result.error) return badRequest(result.error);
  return ok(result.data);
}
