"use client";

import { useActionState, useEffect } from "react";
import { saveManualShippingDetails, type ShippingDetailsState } from "./shipping-actions";

// 2026-09-13 (#5 + #6) — the manual shipping-details form rendered on the
// order detail page (print:hidden — operational data, not part of the
// printed order sheet, same treatment as the status grid). Saves AWB /
// courier / weight / dimensions through order_shipments + order_packages,
// and invoice no/date through dispatch_invoices — see shipping-actions.ts
// for the full routing. Auto-marks the order Dispatched only when BOTH
// AWB and Invoice No. are present, per the user's own rule; the success
// message names whether that happened so it's never a mystery.
const initialState: ShippingDetailsState = { error: null, success: false, dispatched: false };

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type ShippingFormShipment = {
  id: string;
  shipmentNo: number;
  awbNo: string | null;
  forwardingNo: string | null;
  courierName: string | null;
};

export function ShippingDetailsForm({
  orderId,
  orderStatus,
  shipmentStatus,
  shipments = [],
  defaults,
}: {
  orderId: string;
  orderStatus: string;
  /** Current orders.shipment_status — pre-selects the Tracking Status box. */
  shipmentStatus?: string | null;
  /**
   * 2026-11-23 — every AWB on the order. A multi-shipment order shows a
   * "Shipment" picker, because a tracking status chosen here must move only
   * the parcel it is meant for — it used to mark every AWB Delivered.
   */
  shipments?: ShippingFormShipment[];
  defaults: {
    awb_no: string | null;
    forwarding_no: string | null;
    courier_name: string | null;
    invoice_no: string | null;
    invoice_date: string | null;
    weight_kg: number | null;
    length_cm: number | null;
    width_cm: number | null;
    height_cm: number | null;
  };
}) {
  const [state, formAction, pending] = useActionState(saveManualShippingDetails, initialState);

  useEffect(() => {
    // 2026-10-26 — reload after EVERY successful save, not only a dispatch:
    // the form's defaults now come from the real shipment/package rows, and
    // without the refresh the inputs kept showing what was typed instead of
    // what actually got stored (blank weight after an AWB-only save, dims
    // wiped from the input, etc.). A full refresh keeps every section
    // consistent, same pattern as the ledger's delete button.
    if (state.success) window.location.reload();
  }, [state.success]);

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-xs print:hidden">
      <p className="mb-1 font-semibold text-slate-700">Shipping &amp; Invoice Details (manual entry)</p>
      <p className="mb-2 text-slate-400">
        For shipments booked outside the app. Saving an <strong>AWB No.</strong> marks the order{" "}
        <strong>Dispatched</strong> automatically{orderStatus === "Dispatched" || orderStatus === "Delivered" ? " (already " + orderStatus + ")" : ""}, adds it
        to Track Shipments, and lets the courier tracking API update its status. Every field is pre-filled from what is
        already saved, so you only change what differs. Blank fields never overwrite a saved value.
      </p>
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="order_id" value={orderId} />
        {state.error && <p className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{state.error}</p>}
        {state.success && (
          <p className="rounded bg-green-50 px-2 py-1 text-[11px] text-green-700">
            ✓ Saved{state.dispatched ? " — order marked Dispatched." : "."}
            {state.trackingSync ? ` Tracking status: ${state.trackingSync}.` : ""}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <div>
            <label className={labelClass} htmlFor="sd_awb">AWB / Tracking No.</label>
            <input id="sd_awb" name="awb_no" defaultValue={defaults.awb_no ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="sd_forwarding">
              Forwarding No. <span className="font-normal text-slate-400">(aggregator&apos;s own ref)</span>
            </label>
            <input
              id="sd_forwarding"
              name="forwarding_no"
              defaultValue={defaults.forwarding_no ?? ""}
              placeholder="Shiprocket / Shipglobal / OnPoint ref"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="sd_courier">Courier Company</label>
            <input id="sd_courier" name="courier_name" defaultValue={defaults.courier_name ?? ""} placeholder="FedEx / DHL / ..." className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="sd_invoice_no">Invoice No.</label>
            <input id="sd_invoice_no" name="invoice_no" defaultValue={defaults.invoice_no ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="sd_invoice_date">Invoice Date</label>
            <input id="sd_invoice_date" name="invoice_date" type="date" defaultValue={defaults.invoice_date ?? ""} className={inputClass} />
          </div>
          {/* 2026-11-23 — "MANUAL TRACKING UPDATE YAHA UPDATE KYU NAHI HO
              RAHI": one place to record where the parcel actually is, for
              couriers this app cannot poll (Shipglobal / OnPoint) and for
              parcels entered by hand. Saving it moves the order's own status,
              shipment status, dispatch date and the dispatch summary together
              — see shipping-actions.ts step 5.
              When the order has more than one AWB the form also asks WHICH
              parcel this status belongs to; the order itself only turns
              Delivered once every AWB is delivered. */}
          {shipments.length > 1 && (
            <div>
              <label className={labelClass} htmlFor="sd_shipment">
                Shipment <span className="font-normal text-slate-400">(which AWB)</span>
              </label>
              <select id="sd_shipment" name="shipment_id" defaultValue="" className={inputClass}>
                <option value="">Select AWB</option>
                {shipments.map((s) => (
                  <option key={s.id} value={s.id}>
                    #{s.shipmentNo} · {s.awbNo ?? s.forwardingNo ?? "no AWB"}
                    {s.courierName ? ` · ${s.courierName}` : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[10px] text-slate-400">
                Required for a Tracking Status — only this AWB moves. The order turns Delivered when every AWB is.
              </p>
            </div>
          )}
          <div>
            <label className={labelClass} htmlFor="sd_tracking_status">Tracking Status</label>
            <select
              id="sd_tracking_status"
              name="tracking_status"
              defaultValue={
                shipmentStatus && ["Shipped", "In Transit", "Delivered", "Returned"].includes(shipmentStatus)
                  ? shipmentStatus
                  : ""
              }
              className={inputClass}
            >
              <option value="">No change</option>
              <option value="Shipped">Shipped</option>
              <option value="In Transit">In Transit</option>
              <option value="Delivered">Delivered</option>
              <option value="Returned">Returned</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="sd_delivered_date">
              Delivered Date <span className="font-normal text-slate-400">(when Delivered)</span>
            </label>
            <input id="sd_delivered_date" name="delivered_date" type="date" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="sd_weight">Weight (kg)</label>
            <input id="sd_weight" name="weight_kg" type="number" step="0.001" min={0} defaultValue={defaults.weight_kg ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="sd_len">Length (cm)</label>
            <input id="sd_len" name="length_cm" type="number" step="0.01" min={0} defaultValue={defaults.length_cm ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="sd_wid">Width (cm)</label>
            <input id="sd_wid" name="width_cm" type="number" step="0.01" min={0} defaultValue={defaults.width_cm ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="sd_hei">Height (cm)</label>
            <input id="sd_hei" name="height_cm" type="number" step="0.01" min={0} defaultValue={defaults.height_cm ?? ""} className={inputClass} />
          </div>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
        >
          {pending ? "Saving..." : "Save Shipping Details"}
        </button>
      </form>
    </div>
  );
}
