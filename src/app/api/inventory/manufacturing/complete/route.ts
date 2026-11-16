import { createServiceRoleClientUnchecked } from "@/lib/supabase/server";
import { inventoryApiAuth, badRequest, ok, readJson, bodyStr, bodyNum, bodyNumOrNull } from "@/lib/inventory/api";

import { completeManufacturing } from "@/lib/inventory/service";

export async function POST(request: Request) {
  const auth = await inventoryApiAuth("inventory_manage");
  if (auth.errorResponse) return auth.errorResponse;
  const body = await readJson(request);
  const result = await completeManufacturing(createServiceRoleClientUnchecked(), {
    companyId: auth.employee!.currentCompanyId,
    jobId: bodyStr(body, "jobId"),
    acceptedPcs: bodyNum(body, "acceptedPcs"),
    acceptedSqft: bodyNumOrNull(body, "acceptedSqft"),
    rejectedPcs: bodyNum(body, "rejectedPcs"),
    rejectedSqft: bodyNumOrNull(body, "rejectedSqft"),
    wastageNote: bodyStr(body, "wastageNote") || null,
    actorId: auth.employee!.id,
  });
  if (result.error) return badRequest(result.error);
  return ok(result.data);
}
