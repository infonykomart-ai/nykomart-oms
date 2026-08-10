import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { SellerProfileForm } from "./seller-profile-form";
import { CreateShipmentForm } from "./create-shipment-form";

// Shipglobal shipment creation — 2026-08-10, built from the API docs the
// user provided directly (customers.php / addOrder.php /
// processDestination.php). See db/2026-08-10-shipglobal.sql for the full
// schema-gap reasoning (why this needs its own structured-address capture
// rather than reusing orders/dispatch_invoices' free-text buyer field).
export default async function ShipglobalPage() {
  const employee = await requireCapability("shipglobal_shipment");
  const supabase = await createClient();

  const [{ data: seller }, { data: company }] = await Promise.all([
    supabase.from("shipglobal_seller_profiles").select("*").eq("company_id", employee.currentCompanyId).maybeSingle(),
    supabase.from("companies").select("name").eq("id", employee.currentCompanyId).single(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">🌍 Shipglobal Shipments</h1>
        <p className="mt-1 text-sm text-slate-500">
          Create a real Shipglobal shipment + label for an order (DPD / UniUni / VipParcel / DHL E-Commerce / UBI). This creates an
          actual shipment and customs declaration once real credentials are live — see the seller profile section below before your
          first shipment.
        </p>
      </div>

      <SellerProfileForm existing={seller ?? null} companyName={company?.name ?? "this company"} />

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Create Shipment</h2>
        <CreateShipmentForm />
      </div>
    </div>
  );
}
