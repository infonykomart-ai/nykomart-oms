import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { ShipperProfileForm } from "./shipper-profile-form";
import { CreateShipmentForm, type CourierBookingPrefill } from "./create-shipment-form";
import { RateComparison } from "./rate-comparison";
import { AccountSetupForm } from "./account-setup-form";
import { ShipmentsTracking } from "./shipments-tracking";
import { CourierBookingTabs, type CourierBookingTab } from "./courier-booking-tabs";
import { COURIERS, getCourierCredentialStatus, getNonSecretCredentialValues } from "@/lib/couriers/credentials";
import { getTrackedShipments, type TrackingFilters } from "./tracking-data";

// Courier Ops Dashboard (2026-09-03) — Account Setup / Book Shipment /
// Track Shipments in one page, replacing the old single-section layout
// (Shipper Profile + Create Shipment only). Built per the user's own
// framing: "booking, tracking, label generation ka baki, or usme hi pahle
// account setup karne ka option ho jese apn naya account setup karte hai"
// — an in-app per-courier account setup step, instead of the previous
// Vercel-env-var-only credential story (still the fallback — see
// credentials.ts's resolveCourierCredentials for the DB-first/env-fallback
// logic that keeps existing global env-var setups working unchanged).
//
// Same shape as Shipglobal's own page (src/app/dashboard/shipglobal/page.tsx)
// for the booking piece — see db/2026-09-01-multi-courier-booking-and-freight-recon.sql
// and ./actions.ts for the full booking flow. See
// db/2026-09-03-courier-account-setup.sql for the credential-storage table
// + the new courier_credentials_admin capability this round adds.
export default async function CourierBookingPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = await createClient();
  const serviceSupabase = createServiceRoleClient();
  const sp = await searchParams;

  const canEditCredentials = employee.capabilities.includes("courier_credentials_admin");

  const trackingFilters: TrackingFilters = {
    courier: (typeof sp.courier === "string" ? sp.courier : "") as TrackingFilters["courier"],
    status: (typeof sp.status === "string" ? sp.status : "") as TrackingFilters["status"],
    q: typeof sp.q === "string" ? sp.q : "",
  };
  const initialTab: CourierBookingTab = sp.tab === "track" ? "track" : sp.tab === "setup" ? "setup" : "book";

  const [{ data: shipper }, { data: company }, credentialStatus, trackedShipments, ...prefillByCourier] = await Promise.all([
    supabase.from("courier_shipper_profiles").select("*").eq("company_id", employee.currentCompanyId).maybeSingle(),
    supabase.from("companies").select("name").eq("id", employee.currentCompanyId).single(),
    getCourierCredentialStatus(serviceSupabase, employee.currentCompanyId),
    getTrackedShipments(serviceSupabase, employee.companyIds, trackingFilters),
    ...COURIERS.map((c) => getNonSecretCredentialValues(serviceSupabase, employee.currentCompanyId, c.key)),
  ]);

  const prefill: CourierBookingPrefill = {};
  COURIERS.forEach((c, i) => {
    prefill[c.key] = prefillByCourier[i];
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">🚚 Courier Ops Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          FedEx / UPS / Aramex / Delhivery / Shiprocket / DHL — set up each courier&apos;s own account, book a real shipment + AWB
          against an order, and track everything that&apos;s been booked, all in one place. Start with Account Setup if this is
          {company?.name ? ` ${company.name}'s` : " your company's"} first time booking with a courier.
        </p>
      </div>

      <CourierBookingTabs
        initialTab={initialTab}
        setup={
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Account Setup</h2>
            <AccountSetupForm status={credentialStatus} canEdit={canEditCredentials} companyName={company?.name ?? "this company"} />
          </div>
        }
        book={
          <div className="space-y-6">
            <ShipperProfileForm existing={shipper ?? null} companyName={company?.name ?? "this company"} />
            <RateComparison />
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Create Shipment</h2>
              <CreateShipmentForm prefill={prefill} />
            </div>
          </div>
        }
        track={
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Track Shipments</h2>
            <ShipmentsTracking shipments={trackedShipments} filters={trackingFilters} />
          </div>
        }
      />
    </div>
  );
}
