import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { WallatRechargeForm } from "./wallat.block";

// 2026-10-09: this used to live in route.ts exporting a default page
// component — but a route.ts is a Route Handler and must export
// GET/POST/... , so Next's build-time validator (`.next/types/validator.ts`)
// rejected it and both Vercel and the CI build job failed. The Courriour
// wallat recharge is a PAGE: /dashboard/payments renders the delivered
// recharge block (amount first → auto bill adjust → courier confirmation,
// funded from bank 5919 — see wallat.actions.ts's header comment).
export default async function WallatRechargePage() {
  const employee = await requireCapability("bill_payment");
  const supabase = createServiceRoleClient();

  const [{ data: companies }, { data: parties }] = await Promise.all([
    supabase.from("companies").select("id, name").in("id", employee.companyIds).order("name"),
    supabase.from("parties").select("id, name, party_type").order("name"),
  ]);

  return (
    <WallatRechargeForm
      employee={employee}
      companies={(companies ?? []).map((c) => ({ id: c.id, name: c.name }))}
      parties={(parties ?? []).map((p) => ({ id: p.id, name: p.name, party_type: p.party_type ?? "" }))}
    />
  );
}
