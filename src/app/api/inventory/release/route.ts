import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { inventoryApiAuth, badRequest, ok, readJson, bodyStr } from "@/lib/inventory/api";

import { releaseReservation } from "@/lib/inventory/service";

export async function POST(request: Request) {
  const auth = await inventoryApiAuth("inventory_manage");
  if (auth.errorResponse) return auth.errorResponse;
  const body = await readJson(request);
  const result = await releaseReservation(createServiceRoleClientUnchecked(), {
    reservationId: bodyStr(body, "reservationId"),
    companyId: auth.employee!.currentCompanyId,
    reason: bodyStr(body, "reason"),
    actorId: auth.employee!.id,
  });
  if (result.error) return badRequest(result.error);
  return ok(result.data);
}
