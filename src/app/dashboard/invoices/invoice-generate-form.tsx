"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { generateInvoice, type InvoiceFormState } from "./actions";

const initialState: InvoiceFormState = { error: null, success: null };

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export function InvoiceGenerateForm({
  orderIds,
  defaultBuyerNameAddress,
}: {
  orderIds: string[];
  defaultBuyerNameAddress: string;
}) {
  const [state, formAction, pending] = useActionState(generateInvoice, initialState);
  const [csbType, setCsbType] = useState("");
  const isCsbIv = csbType === "CSB-IV";

  if (state.success) {
    return (
      <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
        Invoice created — <strong>{state.success.invoiceNo}</strong>.{" "}
        <Link href={`/dashboard/invoices/${state.success.invoiceId}`} className="underline">View / Print</Link>
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      {orderIds.map((id) => (
        <input key={id} type="hidden" name="order_ids" value={id} />
      ))}
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="invoice_date">Invoice Date</label>
          <input id="invoice_date" name="invoice_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="shipment_term">Shipment Term *</label>
          <input id="shipment_term" name="shipment_term" required placeholder="DDP / DDU / FOB / ..." className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="csb_type">CSB Type *</label>
          <select
            id="csb_type"
            name="csb_type"
            required
            defaultValue=""
            className={inputClass}
            onChange={(e) => setCsbType(e.target.value)}
          >
            <option value="" disabled>Select</option>
            <option value="CSB-V">CSB-V</option>
            <option value="CSB-IV">CSB-IV</option>
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="courier_company">Courier Company *</label>
          <input id="courier_company" name="courier_company" required placeholder="FedEx / DHL / ..." className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="destination_country">Destination Country</label>
          <input id="destination_country" name="destination_country" placeholder="Leave blank to auto-pull from the order" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="ioss_number">IOSS Number (if any)</label>
          <input id="ioss_number" name="ioss_number" placeholder="Leave blank to auto-pull from the order" className={inputClass} />
        </div>
      </div>

      {/* 2026-08-10/11: "agar uk & europe ki shipment hai or agar usme
          IOSS, VAT, EORI no vagera aaya hua hai according to destination
          country guideline" — VAT/EORI alongside the existing IOSS field
          above. 2026-08-11: now auto-pull from the order's own vat_number/
          eori_number/destination_country when left blank here (see
          actions.ts) — these inputs are just an override, same pattern as
          AWB/buyer email/phone below. */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="vat_number">VAT Number (UK/EU, if any)</label>
          <input id="vat_number" name="vat_number" placeholder="Leave blank to auto-pull from the order" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="eori_number">EORI Number (UK/EU, if any)</label>
          <input id="eori_number" name="eori_number" placeholder="Leave blank to auto-pull from the order" className={inputClass} />
        </div>
      </div>

      {/* 2026-08-10: fuller customs-invoice detail fields to match the
          real sample format (NL1712627.pdf) — AWB/buyer email/phone
          auto-pull from Dispatch if left blank. */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="awb_no">AWB / Tracking No.</label>
          <input id="awb_no" name="awb_no" placeholder="Leave blank to auto-pull from Dispatch" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="courier_company_vessel">Vessel/Flight No.</label>
          <input id="courier_company_vessel" name="vessel_flight_no" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="port_of_discharge">Port of Discharge</label>
          <input id="port_of_discharge" name="port_of_discharge" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="marks_and_nos">Marks & Nos./Container No.</label>
          <input id="marks_and_nos" name="marks_and_nos" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="no_of_packages">No. of Packages</label>
          <input id="no_of_packages" name="no_of_packages" type="number" min={0} defaultValue={1} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="buyer_email">Buyer Email</label>
          <input id="buyer_email" name="buyer_email" type="email" placeholder="Leave blank to auto-pull from Dispatch" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="buyer_phone">Buyer Phone</label>
          <input id="buyer_phone" name="buyer_phone" placeholder="Leave blank to auto-pull from Dispatch" className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="other_than_consignee">Other Than Consignee (usually blank)</label>
        <textarea id="other_than_consignee" name="other_than_consignee" rows={2} className={inputClass} />
      </div>

      {/* 2026-08-11: "if there is a designated broker for this shipment,
          please provide contact information" — usually blank. Duty &
          Taxes Payable By is NOT asked here — it auto-fills from
          Shipment Term above (DDP -> Exporter, DDU/DAP -> Consignee) and
          can be corrected afterward on the invoice's own Edit panel. */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelClass} htmlFor="broker_name">Name of Broker (if any)</label>
          <input id="broker_name" name="broker_name" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="broker_tel">Broker Tel No.</label>
          <input id="broker_tel" name="broker_tel" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="broker_contact">Broker Contact No.</label>
          <input id="broker_contact" name="broker_contact" className={inputClass} />
        </div>
      </div>

      {/* 2026-08-10: "csv-4 me manual rakho value kitni rakhnai hai" — for
          CSB-IV only, the value breakdown is typed in by hand instead of
          the automatic 60% marketplace calculation. These 4 fields
          are ignored entirely for CSB-V (which always auto-computes them
          server-side from order_value_usd — see actions.ts). */}
      {isCsbIv && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-xs font-semibold text-amber-800">
            CSB-IV — value breakdown is manual (not auto-calculated from order value)
          </p>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className={labelClass} htmlFor="manual_invoice_value_usd">Total Value (USD)</label>
              <input id="manual_invoice_value_usd" name="manual_invoice_value_usd" type="number" step="0.01" className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="manual_item_cost_total">Item Cost (USD)</label>
              <input id="manual_item_cost_total" name="manual_item_cost_total" type="number" step="0.01" className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="manual_insurance_total">Insurance (USD)</label>
              <input id="manual_insurance_total" name="manual_insurance_total" type="number" step="0.01" defaultValue={0.75} className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="manual_freight_total">Freight (USD)</label>
              <input id="manual_freight_total" name="manual_freight_total" type="number" step="0.01" className={inputClass} />
            </div>
          </div>
        </div>
      )}

      {/* 2026-08-08: "WEIGHT OR DIMENSION KYU NAHI MANG RAHA" — customs
          declaration fields. Optional here (can also be filled in later
          from the invoice's own Edit-before-printing panel). */}
      <div className="grid grid-cols-4 gap-3">
        <div>
          <label className={labelClass} htmlFor="weight_kg">Weight (kg)</label>
          <input id="weight_kg" name="weight_kg" type="number" step="0.001" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="length_cm">Length (cm)</label>
          <input id="length_cm" name="length_cm" type="number" step="0.01" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="width_cm">Width (cm)</label>
          <input id="width_cm" name="width_cm" type="number" step="0.01" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="height_cm">Height (cm)</label>
          <input id="height_cm" name="height_cm" type="number" step="0.01" className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="buyer_name_address">Buyer Name & Address</label>
        <textarea id="buyer_name_address" name="buyer_name_address" rows={2} defaultValue={defaultBuyerNameAddress} className={inputClass} />
      </div>

      <div>
        <label className={labelClass} htmlFor="remark">Remark</label>
        <input id="remark" name="remark" className={inputClass} />
      </div>

      {/* 2026-08-08: "JESE HI INVOICE SUBMIT KARE TO USKA AUTOMATIC DISPATCH
          MARK HO JAYE SABHI JAGH" — generateInvoice() sets these orders'
          status to Dispatched on submit; no separate status-edit step. */}
      <p className="text-xs text-slate-400">
        Generating this will automatically mark the selected order(s) as <strong>Dispatched</strong> (already
        Delivered orders are left as-is).
      </p>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Generating..." : "Generate Invoice"}
      </button>
    </form>
  );
}
