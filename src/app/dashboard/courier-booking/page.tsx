import { requireCapability } from "@/lib/auth/require-capability";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { ShipperProfileForm } from "./shipper-profile-form";
import { CreateShipmentForm, type CourierBookingPrefill, type BookPrefill } from "./create-shipment-form";
import { AccountSetupForm } from "./account-setup-form";
import { ShipmentsTracking } from "./shipments-tracking";
import { CourierBookingTabs, type CourierBookingTab } from "./courier-booking-tabs";
import { COURIERS, getCourierCredentialStatus, getNonSecretCredentialValues, type CourierKey } from "@/lib/couriers/credentials";
import { getTrackedShipments, type TrackingFilters } from "./tracking-data";
import { getPendingOrders, groupIntoBatches, type PendingOrdersFilters } from "./pending-orders-data";
import { PendingOrders } from "./pending-orders";
import { getPickupCandidateAwbs, listPickupRequests, type PickupCandidateAwb } from "./pickup-request-data";
import { PickupRequest } from "./pickup-request";
import { getDailyShipmentReport, type DailyReportFilters } from "./daily-report-data";
import { DailyShipmentReport } from "./daily-shipment-report";

// Courier Ops Dashboard — Account Setup / Pending Orders / Book Shipment /
// Pickup Request / Track Shipments / Daily Report, all in one page.
//
// 2026-09-04 (EGS-integration round): 3 new tabs (Pending Orders, Pickup
// Request, Daily Report) added to the original 3 (Setup/Book/Track), per
// the user's ask that booking/tracking/invoice/label/rate-compare work
// like the eBay Global Shipping (EGS) module — see
// claude/egs-integration-2026-09-04.md for the full round writeup,
// including which parts are honest approximations of EGS (this app's
// schema doesn't capture everything EGS's own platform does) and which
// are internal-only (Pickup Request, Cancel Shipment — no courier's real
// API for either has been researched/verified).
//
// Original header (2026-09-03): built per the user's own framing —
// "booking, tracking, label generation ka baki, or usme hi pahle account
// setup karne ka option ho jese apn naya account setup karte hai" — an
// in-app per-courier account setup step, instead of the previous
// Vercel-env-var-only credential story (still the fallback — see
// credentials.ts's resolveCourierCredentials for the DB-first/env-fallback
// logic that keeps existing global env-var setups working unchanged).
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
  const str = (key: string) => (typeof sp[key] === "string" ? (sp[key] as string) : "");

  const trackingFilters: TrackingFilters = {
    courier: str("courier") as TrackingFilters["courier"],
    status: str("status") as TrackingFilters["status"],
    q: str("q"),
  };
  const pendingFilters: PendingOrdersFilters = {
    dateFrom: str("date_from"),
    dateTo: str("date_to"),
    q: str("q"),
    destinationCountry: str("destination_country"),
    due: str("due") as PendingOrdersFilters["due"],
  };
  const reportFilters: DailyReportFilters = {
    dateFrom: str("report_date_from"),
    dateTo: str("report_date_to"),
    courier: str("report_courier") as DailyReportFilters["courier"],
    status: str("report_status") as DailyReportFilters["status"],
    destinationCountry: str("report_destination_country"),
  };
  const bookPrefill: BookPrefill = str("book_ref_no") ? { refNo: str("book_ref_no"), combinedOrderIds: str("book_combined_ids") } : null;

  const validTabs: CourierBookingTab[] = ["setup", "pending", "book", "pickup", "track", "report"];
  const initialTab: CourierBookingTab = validTabs.includes(sp.tab as CourierBookingTab) ? (sp.tab as CourierBookingTab) : "book";

  const [
    { data: shipper },
    { data: company },
    credentialStatus,
    trackedShipments,
    pendingOrderRows,
    pickupRequests,
    dailyReportRows,
    ...prefillByCourier
  ] = await Promise.all([
    supabase.from("courier_shipper_profiles").select("*").eq("company_id", employee.currentCompanyId).maybeSingle(),
    supabase.from("companies").select("name").eq("id", employee.currentCompanyId).single(),
    getCourierCredentialStatus(serviceSupabase, employee.currentCompanyId),
    getTrackedShipments(serviceSupabase, employee.companyIds, trackingFilters),
    getPendingOrders(serviceSupabase, employee.companyIds, employee.currentCompanyId, pendingFilters),
    listPickupRequests(serviceSupabase, employee.currentCompanyId),
    getDailyShipmentReport(serviceSupabase, employee.currentCompanyId, reportFilters, false),
    ...COURIERS.map((c) => getNonSecretCredentialValues(serviceSupabase, employee.currentCompanyId, c.key)),
  ]);

  const prefill: CourierBookingPrefill = {};
  COURIERS.forEach((c, i) => {
    prefill[c.key] = prefillByCourier[i];
  });

  const pendingBatches = groupIntoBatches(pendingOrderRows);

  const defaultPickupAddress = shipper
    ? `${shipper.contact_name}, ${shipper.company_name}, ${shipper.address1}${shipper.address2 ? `, ${shipper.address2}` : ""}, ${shipper.city}, ${shipper.state} ${shipper.postcode}, ${shipper.country_code}`
    : "";
  const candidatesByCourier = Object.fromEntries(
    await Promise.all(COURIERS.map(async (c) => [c.key, await getPickupCandidateAwbs(serviceSupabase, employee.companyIds, c.key)] as const))
  ) as Record<CourierKey, PickupCandidateAwb[]>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">🚚 Courier Ops Dashboard</h1>
        <p className="mt-1 text-sm text-slate-500">
          FedEx / UPS / Aramex / Delhivery / Shiprocket / DHL — set up each courier&apos;s own account, stage orders, book a real
          shipment + AWB, request pickups, track everything, and pull a combined report, all in one place. Start with Account Setup if
          this is {company?.name ? ` ${company.name}'s` : " your company's"} first time booking with a courier.
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
        pending={<PendingOrders rows={pendingOrderRows} batches={pendingBatches} filters={pendingFilters} />}
        book={
          <div className="space-y-6">
            <ShipperProfileForm existing={shipper ?? null} companyName={company?.name ?? "this company"} />
            <div className="rounded-lg border border-slate-200 bg-white p-4">
              <h2 className="mb-3 text-sm font-semibold text-slate-800">Create Shipment</h2>
              <CreateShipmentForm prefill={prefill} bookPrefill={bookPrefill} />
            </div>
          </div>
        }
        pickup={<PickupRequest candidatesByCourier={candidatesByCourier} defaultPickupAddress={defaultPickupAddress} existingRequests={pickupRequests} />}
        track={
          <div className="rounded-lg border border-slate-200 bg-white p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-800">Track Shipments</h2>
            <ShipmentsTracking shipments={trackedShipments} filters={trackingFilters} />
          </div>
        }
        report={<DailyShipmentReport rows={dailyReportRows} filters={reportFilters} rowCapHit={dailyReportRows.length >= 500} />}
      />
    </div>
  );
}
