import { requireCapability } from "@/lib/auth/require-capability";
import { createClient } from "@/lib/supabase/server";
import { ShipperProfileForm } from "./shipper-profile-form";
import { CreateShipmentForm } from "./create-shipment-form";

// Multi-courier real booking — FedEx / UPS / Aramex / Delhivery /
// Shiprocket / DHL, 2026-09-01 (DHL added same day, folded into the same
// round — see db/2026-09-01-dhl-courier-booking.sql). Same shape as
// Shipglobal's own page (src/app/dashboard/shipglobal/page.tsx), the
// proven template — see db/2026-09-01-multi-courier-booking-and-freight-recon.sql
// and ./actions.ts for the full flow this drives.
export default async function CourierBookingPage() {
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = await createClient();

  const [{ data: shipper }, { data: company }] = await Promise.all([
    supabase.from("courier_shipper_profiles").select("*").eq("company_id", employee.currentCompanyId).maybeSingle(),
    supabase.from("companies").select("name").eq("id", employee.currentCompanyId).single(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">🚚 Courier Booking (FedEx / UPS / Aramex / Delhivery / Shiprocket / DHL)</h1>
        <p className="mt-1 text-sm text-slate-500">
          Create a real shipment + AWB for an order via each courier&apos;s own API — the same real-booking pattern Shipglobal already
          uses (see the 🌍 Shipglobal Shipments tile for that one). This creates an actual shipment once real credentials are live
          for the courier you pick — see the shipper profile section below before your first shipment, and the project delivery
          notes for exactly which env vars each courier needs before it will work.
        </p>
      </div>

      <ShipperProfileForm existing={shipper ?? null} companyName={company?.name ?? "this company"} />

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-800">Create Shipment</h2>
        <CreateShipmentForm />
      </div>
    </div>
  );
}
