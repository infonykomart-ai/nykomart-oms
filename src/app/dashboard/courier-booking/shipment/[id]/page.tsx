import Link from "next/link";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { requireCapability } from "@/lib/auth/require-capability";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getShipmentDetail, type TimelineStage } from "../shipment-detail-data";
import { CancelShipmentModal } from "../cancel-shipment-modal";
import { AllDocumentsButton } from "../all-documents-button";

// Rich Shipment Detail page (EGS-integration round, 2026-09-04) — mirrors
// EGS's own Shipment History Detail page (/shipment-history-detail/{id}).
// Linked from Track Shipments rows (see ../shipments-tracking.tsx) and
// from Pending Orders after a shipment is booked. Route param `id` is the
// courier_shipments.id (the attempt-log row's own id — stable regardless
// of AWB text changes).
export default async function ShipmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const employee = await requireCapability("courier_booking_shipment");
  const supabase = createServiceRoleClient();

  const detail = await getShipmentDetail(supabase, employee.companyIds, id);
  if (!detail) notFound();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/dashboard/courier-booking?tab=track" className="text-xs text-slate-400 hover:text-slate-600">
            ← Back to Track Shipments
          </Link>
          <h1 className="mt-1 text-xl font-semibold text-slate-900">
            {detail.courierLabel} — {detail.awbNo ?? "No AWB"}
          </h1>
          <p className="text-sm text-slate-500">
            Order <Link href={`/dashboard/orders/${detail.order.id}`} className="font-medium text-amber-700 hover:underline">{detail.order.refNo}</Link>
            {" · "}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                detail.status === "created" ? "bg-green-100 text-green-700" : detail.status === "cancelled" ? "bg-red-100 text-red-700" : detail.status === "failed" ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-600"
              }`}
            >
              {detail.status}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {detail.labelUrl && (
            <a href={detail.labelUrl} target="_blank" rel="noopener noreferrer" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
              🖨 Print Label
            </a>
          )}
          {detail.order.invoiceId ? (
            <a
              href={`/dashboard/invoices/${detail.order.invoiceId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              🧾 Print Invoice
            </a>
          ) : (
            <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-400">No invoice generated yet</span>
          )}
          {detail.labelUrl && detail.order.invoiceId && <AllDocumentsButton labelUrl={detail.labelUrl} invoiceId={detail.order.invoiceId} />}
          {detail.status === "created" && <CancelShipmentModal courierShipmentId={detail.id} />}
        </div>
      </div>

      {detail.status === "cancelled" && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">
          Cancelled {detail.cancelledAt ? new Date(detail.cancelledAt).toLocaleString() : ""} — reason: {detail.cancelReason ?? "—"}
          {detail.cancelRemark ? ` (${detail.cancelRemark})` : ""}. This was recorded in our system only — see note above about the courier&apos;s own side.
        </div>
      )}
      {detail.status === "failed" && detail.errorMessage && (
        <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">Booking failed: {detail.errorMessage}</div>
      )}

      <Timeline stages={detail.timeline} />

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Delivery Details">
          <Field label="Buyer" value={detail.order.buyerNameAddress} />
          <Field label="Contact No." value={detail.order.contactNo} />
          <Field label="Email" value={detail.order.emailId} />
          <Field label="Destination Country" value={detail.order.destinationCountry} />
          <Field label="Delivered" value={detail.order.deliveredStatus ? `${detail.order.deliveredStatus}${detail.order.deliveredDate ? ` (${detail.order.deliveredDate})` : ""}` : "Not yet"} />
        </Section>

        <Section title="Shipping Details">
          <Field label="Service" value={detail.serviceCode} />
          <Field label="Duty Payer (DDP/DDU)" value={detail.ddpDdu} />
          <Field label="Declared Weight" value={detail.package?.weightKg != null ? `${detail.package.weightKg} kg` : null} />
          <Field label="Volumetric Weight" value={detail.package?.volumetricWeight != null ? `${detail.package.volumetricWeight} kg` : null} />
          <Field
            label="Dimensions (L×W×H cm)"
            value={detail.package && detail.package.lengthCm != null ? `${detail.package.lengthCm} × ${detail.package.widthCm} × ${detail.package.heightCm}` : null}
          />
          <Field label="VAT No." value={detail.order.vatNumber} />
          <Field label="EORI No." value={detail.order.eoriNumber} />
          <Field label="IOSS No." value={detail.order.iossNumber} />
        </Section>
      </div>

      <Section title="Shipping Charges">
        <p className="mb-2 text-xs text-slate-400">
          This app captures the booking-time price and, once billed, the courier&apos;s reconciled invoice amount — not a per-surcharge breakdown
          (FSC/ODA/emergency surcharge/duty/clearance/etc.), which this schema has no data source for. See the round writeup for why.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">At booking</p>
            <Field label="Booked Amount" value={detail.charges.bookedAmt != null ? `${detail.charges.bookedCurrency ?? ""} ${detail.charges.bookedAmt.toFixed(2)}` : null} />
            <Field
              label="Source"
              value={
                detail.charges.bookedAmountSource === "api"
                  ? "Courier's own API response"
                  : detail.charges.bookedAmountSource === "rate_card_estimate"
                    ? "Courier Rate Card estimate"
                    : detail.charges.bookedAmountSource === "manual"
                      ? "Manual entry — booked outside the app"
                      : null
              }
            />
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold text-slate-600">Billed (Freight Bill reconciliation)</p>
            {detail.charges.billedFreightAmt != null ? (
              <>
                <Field label="Billed Freight Amount" value={detail.charges.billedFreightAmt.toFixed(2)} />
                <Field label="Freight Bill Invoice No." value={detail.charges.freightBillInvoiceNo} />
                <Field label="Bill Weight" value={detail.charges.billWeightKg != null ? `${detail.charges.billWeightKg} kg` : null} />
                <Field label="Dimensional Weight" value={detail.charges.dimensionalWeightKg != null ? `${detail.charges.dimensionalWeightKg} kg` : null} />
                <Field label="Difference vs. Booked" value={detail.charges.differenceAmt != null ? detail.charges.differenceAmt.toFixed(2) : null} />
              </>
            ) : (
              <p className="text-xs text-slate-400">Not billed/reconciled yet.</p>
            )}
          </div>
        </div>
      </Section>

      <Section title="Shipment Items">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">SKU</th>
                <th className="px-3 py-2 font-medium">Qty</th>
                <th className="px-3 py-2 font-medium">Order Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="px-3 py-2">{detail.order.skuLabel ?? "—"}</td>
                <td className="px-3 py-2">{detail.order.qty}</td>
                <td className="px-3 py-2">
                  {detail.order.orderValueOriginal != null ? `${detail.order.orderCurrency ?? ""} ${detail.order.orderValueOriginal.toFixed(2)}` : "—"}
                  {detail.order.orderValueInr != null && ` (₹${detail.order.orderValueInr.toFixed(2)})`}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">{title}</h2>
      {children}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex justify-between gap-3 py-1 text-xs">
      <span className="text-slate-400">{label}</span>
      <span className="text-right text-slate-800">{value || "—"}</span>
    </div>
  );
}

const STAGE_ORDER: TimelineStage["stage"][] = ["Booked", "Picked Up", "In Transit", "Delivered"];

function Timeline({ stages }: { stages: TimelineStage[] }) {
  const isRto = stages.some((s) => s.stage === "RTO");
  const reached = new Set(stages.map((s) => s.stage));

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="mb-3 text-sm font-semibold text-slate-800">Progress</h2>
      <p className="mb-3 text-xs text-slate-400">
        Built from this AWB&apos;s tracking events on file — an AWB booked before tracking coverage existed, or whose courier&apos;s webhook/polling
        never matched, may show fewer stages than actually happened.
      </p>
      <div className="flex flex-wrap items-start gap-0">
        {(isRto ? [...STAGE_ORDER.slice(0, 2), "RTO" as const] : STAGE_ORDER).map((stageName, i, arr) => {
          const stageEvent = stages.find((s) => s.stage === stageName);
          const hit = reached.has(stageName);
          return (
            <div key={stageName} className="flex items-center">
              <div className="flex flex-col items-center px-2">
                <div className={`h-3 w-3 rounded-full ${hit ? "bg-amber-500" : "bg-slate-200"}`} />
                <p className={`mt-1 text-[11px] font-medium ${hit ? "text-slate-800" : "text-slate-400"}`}>{stageName}</p>
                <p className="text-[10px] text-slate-400">{stageEvent ? new Date(stageEvent.at).toLocaleDateString() : ""}</p>
                {stageEvent?.detail && <p className="max-w-[110px] truncate text-[10px] text-slate-400" title={stageEvent.detail}>{stageEvent.detail}</p>}
              </div>
              {i < arr.length - 1 && <div className={`h-px w-8 ${hit ? "bg-amber-300" : "bg-slate-200"}`} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
