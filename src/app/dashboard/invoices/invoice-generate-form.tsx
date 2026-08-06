"use client";

import { useActionState } from "react";
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

  if (state.success) {
    return (
      <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
        Invoice ban gaya — <strong>{state.success.invoiceNo}</strong>.{" "}
        <Link href={`/dashboard/invoices/${state.success.invoiceId}`} className="underline">Dekho / Print karo</Link>
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
          <select id="csb_type" name="csb_type" required defaultValue="" className={inputClass}>
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
          <input id="destination_country" name="destination_country" placeholder="Origin declaration is se auto-fill hoga" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="ioss_number">IOSS Number (agar ho)</label>
          <input id="ioss_number" name="ioss_number" className={inputClass} />
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

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Generate ho raha hai..." : "Invoice Generate Karo"}
      </button>
    </form>
  );
}
