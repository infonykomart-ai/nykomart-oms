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

export function ShippingDetailsForm({
  orderId,
  orderStatus,
  defaults,
}: {
  orderId: string;
  orderStatus: string;
  defaults: {
    awb_no: string | null;
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
    // Order status changes after a dispatch (and the page's own status
    // grid comes from server data) — a full refresh keeps every section
    // consistent, same pattern as the ledger's delete button.
    if (state.success && state.dispatched) window.location.reload();
  }, [state.success, state.dispatched]);

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-white p-3 text-xs print:hidden">
      <p className="mb-1 font-semibold text-slate-700">Shipping &amp; Invoice Details (manual entry)</p>
      <p className="mb-2 text-slate-400">
        For shipments booked outside the app. Filling <strong>both</strong> AWB No. and Invoice No. marks the order{" "}
        <strong>Dispatched</strong> automatically{orderStatus === "Dispatched" || orderStatus === "Delivered" ? " (already " + orderStatus + ")" : ""}.
      </p>
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="order_id" value={orderId} />
        {state.error && <p className="rounded bg-red-50 px-2 py-1 text-[11px] text-red-700">{state.error}</p>}
        {state.success && (
          <p className="rounded bg-green-50 px-2 py-1 text-[11px] text-green-700">
            ✓ Saved{state.dispatched ? " — order marked Dispatched." : "."}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <div>
            <label className={labelClass} htmlFor="sd_awb">AWB / Tracking No.</label>
            <input id="sd_awb" name="awb_no" defaultValue={defaults.awb_no ?? ""} className={inputClass} />
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
