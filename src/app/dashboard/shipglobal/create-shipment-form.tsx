"use client";

import { useActionState } from "react";
import {
  lookupOrderForShipglobal,
  createShipglobalShipment,
  type ShipglobalLookupState,
  type ShipglobalCreateState,
} from "./actions";
import { SHIPGLOBAL_SERVICES } from "@/lib/couriers/shipglobal";

const lookupInitial: ShipglobalLookupState = { error: null, order: null };
const createInitial: ShipglobalCreateState = { error: null, success: false, trackingNo: null, shipmentId: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

// Two-step flow: (1) find the order by Ref No. and prefill whatever this
// app already knows (dispatch_invoices, if a manual dispatch already
// exists) — (2) fill in the REST of what Shipglobal needs (structured
// shipping address, item HSN/tax/price, package weight) that this app
// doesn't capture anywhere else yet, and submit. See actions.ts for the
// full two-call (addOrder.php + processDestination.php) flow this drives.
export function CreateShipmentForm() {
  const [lookupState, lookupAction, lookupPending] = useActionState(lookupOrderForShipglobal, lookupInitial);
  const [createState, createAction, createPending] = useActionState(createShipglobalShipment, createInitial);

  const order = lookupState.order;

  return (
    <div className="space-y-4">
      <form action={lookupAction} className="flex items-end gap-2">
        <div className="flex-1">
          <label className={labelClass}>Order Ref No.</label>
          <input name="ref_no" required placeholder="e.g. PO-0123" className={inputClass} />
        </div>
        <button
          type="submit"
          disabled={lookupPending}
          className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {lookupPending ? "Looking up..." : "Load Order"}
        </button>
      </form>
      {lookupState.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{lookupState.error}</p>}

      {order && order.alreadyShipped && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          A Shipglobal shipment already exists for this order. Submitting again will overwrite that record (upsert) — only do this if the
          previous attempt failed.
        </p>
      )}

      {order && (
        <form action={createAction} className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <input type="hidden" name="order_id" value={order.id} />
          <input type="hidden" name="ref_no" value={order.refNo} />

          {createState.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{createState.error}</p>}
          {createState.success && (
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              Shipment created — tracking number: <span className="font-semibold">{createState.trackingNo}</span>.{" "}
              {createState.shipmentId && (
                <a href={`/api/shipglobal-label/${createState.shipmentId}`} target="_blank" rel="noreferrer" className="underline">
                  Download label (PDF)
                </a>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <div>
              <label className={labelClass}>Service *</label>
              <select name="service" required defaultValue="" className={inputClass}>
                <option value="" disabled>
                  Select carrier
                </option>
                {SHIPGLOBAL_SERVICES.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.carrier} ({s.code})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Invoice No.</label>
              <input name="invoice_no" defaultValue={order.refNo} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Invoice Date</label>
              <input name="invoice_date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Currency Code</label>
              <input name="currency_code" defaultValue="USD" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>IOSS Number</label>
              <input name="ioss_number" defaultValue={order.iossNumber ?? ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Seller Reference</label>
              <input name="seller_reference" defaultValue={order.refNo} className={inputClass} />
            </div>
            <div>
              {/* 2026-09-01: booking-cost-vs-billed-cost reconciliation fallback —
                  only used if Shipglobal's own response has no price, see actions.ts. */}
              <label className={labelClass}>Zone (Courier Rate Card, optional)</label>
              <input name="zone_label" placeholder="e.g. Zone A" className={inputClass} />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-semibold text-slate-600">Buyer Shipping Address (not on file — enter fresh)</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div>
                <label className={labelClass}>First Name *</label>
                <input name="ship_firstname" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Last Name *</label>
                <input name="ship_lastname" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Mobile *</label>
                <input name="ship_mobile" required defaultValue={order.buyerContact ?? ""} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Email *</label>
                <input name="ship_email" type="email" required defaultValue={order.buyerMail ?? ""} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Company</label>
                <input name="ship_company" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Address Line 1 *</label>
                <input name="ship_address1" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Address Line 2 *</label>
                <input name="ship_address2" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Address Line 3</label>
                <input name="ship_address3" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>City *</label>
                <input name="ship_city" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Postcode *</label>
                <input name="ship_postcode" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Country Code * (2-letter)</label>
                <input name="ship_country_code" required maxLength={2} defaultValue={order.buyerCountry ?? ""} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>State *</label>
                <input name="ship_state" required className={inputClass} />
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-semibold text-slate-600">Item + Customs</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div>
                <label className={labelClass}>Item Name *</label>
                <input name="item_name" required defaultValue={order.skuLabel ?? ""} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>SKU *</label>
                <input name="item_sku" required defaultValue={order.skuLabel ?? ""} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Quantity *</label>
                <input name="item_qty" type="number" min={1} required defaultValue={order.qty} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Unit Price *</label>
                <input name="item_unit_price" type="number" step="0.01" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>HSN Code *</label>
                <input name="item_hsn" required defaultValue={order.hsnNo ?? ""} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Tax Rate (%)</label>
                <input name="item_tax_rate" type="number" step="0.01" defaultValue={0} className={inputClass} />
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-semibold text-slate-600">Package</p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <div>
                <label className={labelClass}>Weight (grams) *</label>
                <input
                  name="package_weight_g"
                  type="number"
                  required
                  defaultValue={order.shippingWeightKg ? Math.round(order.shippingWeightKg * 1000) : ""}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass}>Length (cm) *</label>
                <input name="package_length_cm" type="number" required defaultValue={order.lengthCm ?? ""} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Breadth (cm) *</label>
                <input name="package_breadth_cm" type="number" required defaultValue={order.widthCm ?? ""} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Height (cm) *</label>
                <input name="package_height_cm" type="number" required defaultValue={order.heightCm ?? ""} className={inputClass} />
              </div>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3">
            <p className="mb-2 text-xs font-semibold text-slate-600">
              Only required for VipParcel — leave blank for every other carrier
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <div>
                <label className={labelClass}>Mail Class</label>
                <input name="mail_class" placeholder="e.g. First" className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Delivery Confirmation</label>
                <input name="delivery_confirmation" placeholder="e.g. NO_SIGNATURE" className={inputClass} />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={createPending}
            className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
          >
            {createPending ? "Creating shipment..." : "Create Shipment"}
          </button>
        </form>
      )}
    </div>
  );
}
