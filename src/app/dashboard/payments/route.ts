import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";

export default async function WallatRechargePage() {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();

  const companyId = String(employee.companyIds[0] || "");
  const { data: companies } = await supabase
    .from("companies")
    .select("id, name")
    .eq("id", companyId)
    .limit(1);
  const companiesList = Array.isArray(companies) ? companies : [];

  return "Money to wallet";
}
