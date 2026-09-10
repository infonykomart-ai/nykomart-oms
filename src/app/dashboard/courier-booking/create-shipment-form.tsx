"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import {
  lookupOrderForCourierBooking,
  createFedexBooking,
  createUpsBooking,
  createAramexBooking,
  createDelhiveryBooking,
  createShiprocketBooking,
  createDhlBooking,
  type CourierBookingLookupState,
  type CourierBookingCreateState,
  type CourierBookingLookupOrder,
} from "./actions";
import { createManualBooking, type ManualBookingState } from "./manual-booking-actions";
import { MANUAL_BOOKING_COURIERS, type ManualBookingCourierChoice } from "./manual-booking-config";
import { lookupPostalCode, countryCodeFor } from "@/lib/postal-lookup";
import { openLabelUrl } from "@/lib/couriers/open-label-url";

const lookupInitial: CourierBookingLookupState = { error: null, order: null };
const createInitial: CourierBookingCreateState = {
  error: null,
  success: false,
  trackingNo: null,
  bookedAmt: null,
  bookedCurrency: null,
  bookedAmountSource: null,
  labelUrl: null,
};
const manualBookingInitial: ManualBookingState = { error: null, success: false, shipmentId: null, awbNo: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

type CourierKey = "fedex" | "ups" | "aramex" | "delhivery" | "shiprocket" | "dhl";

// `international` is informational metadata only (not currently used to
// filter/hide anything in this file) — Delhivery is the one courier here
// that's genuinely domestic-India-only (no public API for international
// order creation exists at all, see the Manual Entry hint below for how to
// record a Delhivery International booking instead). Shiprocket is NOT
// domestic-only: it has a single unified order-create endpoint that
// already accepts any billing country (see shiprocket-ship.ts's header
// comment for the 2026-09-08 correction) — flagged international here
// accordingly, though actually reaching a working international AWB still
// depends on the connected Shiprocket account having international
// couriers enabled on Shiprocket's own dashboard.
const COURIERS: { key: CourierKey; label: string; international: boolean }[] = [
  { key: "fedex", label: "FedEx", international: true },
  { key: "ups", label: "UPS", international: true },
  { key: "aramex", label: "Aramex", international: true },
  { key: "delhivery", label: "Delhivery (India domestic only)", international: false },
  { key: "shiprocket", label: "Shiprocket", international: true },
  { key: "dhl", label: "DHL", international: true },
];

function ResultBanner({ state }: { state: CourierBookingCreateState }) {
  return (
    <>
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      {state.success && (
        <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
          Shipment created — tracking number: <span className="font-semibold">{state.trackingNo}</span>.
          {state.bookedAmt != null && (
            <>
              {" "}
              Booked freight amount: <span className="font-semibold">{state.bookedCurrency} {state.bookedAmt.toFixed(2)}</span> (
              {state.bookedAmountSource === "api" ? "from the courier's own response" : "Courier Rate Card estimate — the courier's API returned no price"}
              ).
            </>
          )}
          {state.bookedAmt == null && (
            <> No booked amount captured — the courier&apos;s API returned no price and no Courier Rate Card slab matched (enter a Zone below to get an estimate).</>
          )}
          {state.labelUrl && (
            <>
              {" "}
              {/* 2026-09-10: was a plain <a href target="_blank"> — see
                  open-label-url.ts's header comment for why that silently
                  showed raw PDF bytes as text instead of opening the PDF
                  once FedEx's label became a data: URI. */}
              <button type="button" onClick={() => openLabelUrl(state.labelUrl!)} className="font-semibold underline">
                🖨 Download label
              </button>
              .
            </>
          )}
          {!state.labelUrl && state.trackingNo && (
            <> No label captured from this booking yet — see the Track Shipments tab (Delhivery/Shiprocket can generate one on demand there; for other couriers, check the courier&apos;s own dashboard).</>
          )}
        </div>
      )}
    </>
  );
}

// Shared fields every courier's form needs (recipient address, package,
// customs/value) — identical name attributes across all 5 <form>s so the
// same JSX block can be reused verbatim without prop-drilling every field.
// 2026-09-08: Address Line 1/2, City, State, Postcode and Country Code now
// default from orders.buyer_address1/2, buyer_city, buyer_state,
// buyer_postal_code and destination_country (order.buyerAddress1 etc — see
// lookupOrderForCourierBooking) when the order has them, while staying
// plain defaultValue inputs the employee can still edit before submitting.
// A structured field that's null (order predates these columns) leaves its
// input blank exactly as before — the read-only "As entered at order time"
// textarea below stays the fallback reference in that case.
// No Address Line 3 input here on purpose: none of these 6 couriers'
// APIs (fedex-ship.ts / ups-ship.ts / aramex-shipping.ts / dhl-ship.ts /
// delhivery-ship.ts / shiprocket-ship.ts) accept more than address1+address2
// — order.buyerAddress3 is exposed on the lookup type for completeness but
// has nothing to bind to here. Shipglobal (separate flow, separate form —
// see shipglobal/create-shipment-form.tsx) DOES take a 3rd line and is
// defaulted from it there.
// 2026-09-08 (follow-up): plain DOM read/write (matching this file's
// existing uncontrolled-input style — these are plain `defaultValue`
// inputs, not React state) rather than lifting Postcode/City/State/Country
// into component state just for this. Only one SharedShipmentFields is ever
// mounted at a time (the parent conditionally renders exactly one courier's
// block based on the `courier` <select>), so the static ids below never
// collide.
async function handleRecipientPostalBlur() {
  const postalCode = (document.getElementById("recipient_postcode") as HTMLInputElement | null)?.value ?? "";
  const country = (document.getElementById("recipient_country_code") as HTMLInputElement | null)?.value ?? "";
  if (!postalCode.trim()) return;

  const result = await lookupPostalCode(postalCode, country);
  if (!result) return;

  const cityInput = document.getElementById("recipient_city") as HTMLInputElement | null;
  const stateInput = document.getElementById("recipient_state") as HTMLInputElement | null;
  if (cityInput && !cityInput.value.trim()) cityInput.value = result.city;
  if (stateInput && !stateInput.value.trim()) stateInput.value = result.state;
}

function SharedShipmentFields({ order }: { order: CourierBookingLookupOrder }) {
  return (
    <>
      <div className="border-t border-slate-100 pt-3">
        <p className="mb-2 text-xs font-semibold text-slate-600">Recipient</p>
        {/* 2026-09-08 (follow-up): only shown when there's no structured
            address on the order — that's the legacy case this reference
            block exists for (buyer_name_address still holding the old
            combined name+address blob to manually split below). Once an
            order has structured fields, they already prefill the real
            inputs below directly, so showing this too would just be
            redundant (and, for a new order, buyer_name_address is now only
            a name — nothing useful left to "split"). */}
        {order.buyerNameAddress && !order.buyerAddress1 && (
          <div className="mb-3">
            <label className={labelClass}>As entered at order time (reference only — split this into the fields below)</label>
            <textarea
              readOnly
              rows={3}
              value={order.buyerNameAddress}
              className={`${inputClass} whitespace-pre-wrap bg-slate-50 text-slate-600`}
            />
          </div>
        )}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div>
            <label className={labelClass}>Name *</label>
            <input name="recipient_name" required defaultValue={order.buyerName ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Company</label>
            <input name="recipient_company" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Phone *</label>
            <input name="recipient_phone" required defaultValue={order.buyerContact ?? ""} className={inputClass} />
          </div>
          <div>
            {/* 2026-09-10: "US buyer ke contact no ke sath ext ka option
                bhi hota hai" — FedEx's own real booking page has a separate
                Ext. field alongside the phone number for US numbers.
                Optional; wired through to FedEx's contact.phoneExtension
                (see fedex-ship.ts) — other couriers don't read this field
                today, harmless to leave it filled in for them. */}
            <label className={labelClass}>Phone Ext (optional)</label>
            <input name="recipient_phone_ext" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Email</label>
            <input name="recipient_email" type="email" defaultValue={order.buyerMail ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Address Line 1 *</label>
            <input name="recipient_address1" required defaultValue={order.buyerAddress1 ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Address Line 2</label>
            <input name="recipient_address2" defaultValue={order.buyerAddress2 ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>City *</label>
            <input id="recipient_city" name="recipient_city" required defaultValue={order.buyerCity ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>State</label>
            <input id="recipient_state" name="recipient_state" defaultValue={order.buyerState ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Postcode *</label>
            {/* 2026-09-08 (follow-up): auto-fetch City/State from the
                postcode on blur, same as the order-entry forms — "har us
                entry ke liye jaha jaha jarurat padegi" (auto-fetch wherever
                it's needed), and re-typing/re-checking the address at
                booking time is exactly one of those places. Only fills
                City/State when they're still empty, so a value already
                pre-filled from the order (or typed by the employee) is
                never overwritten; both stay ordinary editable inputs. */}
            <input
              id="recipient_postcode"
              name="recipient_postcode"
              required
              defaultValue={order.buyerPostalCode ?? ""}
              onBlur={handleRecipientPostalBlur}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Country Code * (2-letter)</label>
            {/* 2026-09-08 (follow-up): orders.destination_country is free
                text ("USA" / "United Kingdom" / ... — see the Order form's
                placeholder), NOT a 2-letter code, even though this field's
                `maxLength` only stops interactive typing — it does nothing
                to a `defaultValue` set programmatically, so the raw free
                text used to slip straight through into this "2-letter"
                field looking valid while actually being e.g. "United
                States". Run it through the same alias table the postal
                auto-fill already uses so the box shows a real, resolved
                code from the start; when nothing resolves, leave it blank
                so the employee has to type a real one rather than see a
                wrong value silently pass as if it were fine. The action
                that submits this (createFedexBooking/Ups/Aramex/Dhl) also
                re-validates it server-side — this default is a UX
                convenience, not the actual safety net. */}
            <input
              id="recipient_country_code"
              name="recipient_country_code"
              required
              maxLength={2}
              defaultValue={countryCodeFor(order.buyerDestinationCountry ?? order.buyerCountry ?? "") ?? ""}
              className={inputClass}
            />
          </div>
        </div>
      </div>

      <div className="border-t border-slate-100 pt-3">
        <p className="mb-2 text-xs font-semibold text-slate-600">Package + Customs</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div>
            <label className={labelClass}>Weight (kg) *</label>
            <input
              name="package_weight_kg"
              type="number"
              step="0.001"
              required
              defaultValue={order.shippingWeightKg ?? ""}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Length (cm) *</label>
            <input name="package_length_cm" type="number" required defaultValue={order.lengthCm ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Width (cm) *</label>
            <input name="package_width_cm" type="number" required defaultValue={order.widthCm ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Height (cm) *</label>
            <input name="package_height_cm" type="number" required defaultValue={order.heightCm ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Currency Code</label>
            <input name="currency_code" defaultValue="USD" className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>Declared/Customs Value *</label>
            <input name="customs_value" type="number" step="0.01" required defaultValue={order.orderValueInr ?? ""} className={inputClass} />
          </div>
          <div className="md:col-span-2">
            <label className={labelClass}>Goods Description</label>
            {/* 2026-09-10: was defaulting from order.skuLabel (a raw SKU
                CODE, e.g. "TS-RED-M" — often blank, never a real
                description). Now defaults from order.goodsDescription
                (Item Category name + Size, e.g. "Cotton T-Shirt, Size M")
                — see CourierBookingLookupOrder's comment on that field. */}
            <input name="goods_description" defaultValue={order.goodsDescription ?? order.skuLabel ?? ""} className={inputClass} />
          </div>
          <div className="md:col-span-2">
            {/* 2026-09-10: "buyer ki tax id agr aati hai to vo kaha add
                hoyegi jo uske order ke related hoti hai" — defaults from
                the order's own VAT/EORI/IOSS number (see buyerTaxId's
                comment on CourierBookingLookupOrder). Only relevant for
                specific destinations (mostly UK/EU) — leave blank
                otherwise. Wired through to FedEx's recipient.tins (see
                fedex-ship.ts) — UNCONFIRMED against a real FedEx account,
                same as the rest of this FedEx client; other couriers don't
                read this field today. */}
            <label className={labelClass}>Buyer Tax ID (VAT/EORI/IOSS, optional)</label>
            <input name="recipient_tax_id" defaultValue={order.buyerTaxId ?? ""} className={inputClass} />
          </div>
        </div>
      </div>

      <div className="border-t border-slate-100 pt-3">
        <p className="mb-2 text-xs font-semibold text-slate-600">
          Rate-Card Fallback (used ONLY if the courier&apos;s own response has no price — see Courier Rate Card)
        </p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <div>
            <label className={labelClass}>Zone (Courier Rate Card)</label>
            <input name="zone_label" placeholder="e.g. Zone A" className={inputClass} />
          </div>
        </div>
      </div>
    </>
  );
}

// Non-secret values (account numbers, pickup location names) saved via the
// Account Setup tab — see credentials.ts's getNonSecretCredentialValues.
// Keyed exactly like COURIER_CREDENTIAL_FIELDS's field `key`s (e.g.
// prefill.fedex.account_number), NOT like this form's own input `name`
// attributes, which differ per courier (fedex_account_number vs
// ups_shipper_number etc) for historical reasons — mapped one field at a
// time below rather than renamed, to avoid touching the 6 create* actions'
// formData.get() calls in actions.ts.
export type CourierBookingPrefill = Partial<Record<CourierKey, Record<string, string>>>;

// From Pending Orders' "Book" / "Combine & Book" (see pending-orders.tsx)
// — navigates here with ?tab=book&book_ref_no=...&book_combined_ids=...
// so the employee lands with the order already loaded instead of having
// to retype the Ref No.
export type BookPrefill = { refNo: string; combinedOrderIds: string } | null;

export function CreateShipmentForm({ prefill, bookPrefill }: { prefill?: CourierBookingPrefill; bookPrefill?: BookPrefill }) {
  const [lookupState, lookupAction, lookupPending] = useActionState(lookupOrderForCourierBooking, lookupInitial);
  const [fedexState, fedexAction, fedexPending] = useActionState(createFedexBooking, createInitial);
  const [upsState, upsAction, upsPending] = useActionState(createUpsBooking, createInitial);
  const [aramexState, aramexAction, aramexPending] = useActionState(createAramexBooking, createInitial);
  const [delhiveryState, delhiveryAction, delhiveryPending] = useActionState(createDelhiveryBooking, createInitial);
  const [shiprocketState, shiprocketAction, shiprocketPending] = useActionState(createShiprocketBooking, createInitial);
  const [dhlState, dhlAction, dhlPending] = useActionState(createDhlBooking, createInitial);
  const [manualState, manualAction, manualPending] = useActionState(createManualBooking, manualBookingInitial);
  const [courier, setCourier] = useState<CourierKey>("fedex");
  const [showManual, setShowManual] = useState(false);
  const [manualCourier, setManualCourier] = useState<ManualBookingCourierChoice>("other");
  const lookupFormRef = useRef<HTMLFormElement>(null);
  const autoSubmitted = useRef(false);

  const order = lookupState.order;
  const combinedIdsField = order?.combinedOrderIds.join(",") ?? "";

  // Auto-submit the lookup exactly once when arriving pre-filled from
  // Pending Orders, instead of making the employee retype/resubmit.
  useEffect(() => {
    if (bookPrefill?.refNo && !autoSubmitted.current) {
      autoSubmitted.current = true;
      lookupFormRef.current?.requestSubmit();
    }
  }, [bookPrefill]);

  return (
    <div className="space-y-4">
      <form ref={lookupFormRef} action={lookupAction} className="flex items-end gap-2">
        <div className="flex-1">
          <label className={labelClass}>Order Ref No.</label>
          <input name="ref_no" required defaultValue={bookPrefill?.refNo ?? ""} placeholder="e.g. PO-0123" className={inputClass} />
        </div>
        <input type="hidden" name="combined_order_ids" value={bookPrefill?.combinedOrderIds ?? ""} />
        <button
          type="submit"
          disabled={lookupPending}
          className="rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
        >
          {lookupPending ? "Looking up..." : "Load Order"}
        </button>
      </form>
      {lookupState.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{lookupState.error}</p>}

      {order && order.combinedOrderIds.length > 0 && (
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-800">
          Combining {order.combinedOrderIds.length + 1} orders into ONE shipment: {order.refNo}, {order.combinedRefNos.join(", ")}.
          Declared value below is the combined total — package weight/dimensions still need the actual combined-package
          weight/measurements typed in below.
        </p>
      )}

      {order && (
        <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
          <div>
            <label className={labelClass}>Courier</label>
            <select
              value={courier}
              onChange={(e) => setCourier(e.target.value as CourierKey)}
              className={inputClass}
            >
              {COURIERS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label} {order.alreadyBooked[c.key] ? "— already booked for this order" : ""}
                </option>
              ))}
            </select>
            {order.alreadyBooked[courier] && (
              <p className="mt-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                A {courier} shipment already exists for this order. Submitting again overwrites that record — only do this if the
                previous attempt failed.
              </p>
            )}
          </div>

          {courier === "fedex" && (
            <form action={fedexAction} className="space-y-4">
              <input type="hidden" name="order_id" value={order.id} />
              <input type="hidden" name="ref_no" value={order.refNo} />
              <input type="hidden" name="combined_order_ids" value={combinedIdsField} />
              <ResultBanner state={fedexState} />
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <div>
                  <label className={labelClass}>FedEx Account Number *</label>
                  <input
                    name="fedex_account_number"
                    required
                    defaultValue={prefill?.fedex?.account_number ?? ""}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Service Type</label>
                  <input name="service_code" placeholder="INTERNATIONAL_PRIORITY" defaultValue="INTERNATIONAL_PRIORITY" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Duty Payer</label>
                  <select name="ddp_ddu" defaultValue="DDU" className={inputClass}>
                    <option value="DDU">DDU (buyer pays duty)</option>
                    <option value="DDP">DDP (we pay duty)</option>
                  </select>
                </div>
              </div>
              <SharedShipmentFields order={order} />
              <button
                type="submit"
                disabled={fedexPending}
                className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
              >
                {fedexPending ? "Booking with FedEx..." : "Create FedEx Shipment"}
              </button>
            </form>
          )}

          {courier === "ups" && (
            <form action={upsAction} className="space-y-4">
              <input type="hidden" name="order_id" value={order.id} />
              <input type="hidden" name="ref_no" value={order.refNo} />
              <input type="hidden" name="combined_order_ids" value={combinedIdsField} />
              <ResultBanner state={upsState} />
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <div>
                  <label className={labelClass}>UPS Shipper Number *</label>
                  <input
                    name="ups_shipper_number"
                    required
                    defaultValue={prefill?.ups?.shipper_number ?? ""}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Service Code</label>
                  <input name="service_code" placeholder="07 = Express" defaultValue="07" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Duty Payer</label>
                  <select name="ddp_ddu" defaultValue="DDU" className={inputClass}>
                    <option value="DDU">DDU / DAP (buyer pays duty)</option>
                    <option value="DDP">DDP (we pay duty)</option>
                  </select>
                </div>
              </div>
              <SharedShipmentFields order={order} />
              <button
                type="submit"
                disabled={upsPending}
                className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
              >
                {upsPending ? "Booking with UPS..." : "Create UPS Shipment"}
              </button>
            </form>
          )}

          {courier === "aramex" && (
            <form action={aramexAction} className="space-y-4">
              <input type="hidden" name="order_id" value={order.id} />
              <input type="hidden" name="ref_no" value={order.refNo} />
              <input type="hidden" name="combined_order_ids" value={combinedIdsField} />
              <ResultBanner state={aramexState} />
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div>
                  <label className={labelClass}>Aramex Account Number *</label>
                  <input
                    name="aramex_account_number"
                    required
                    defaultValue={prefill?.aramex?.account_number ?? ""}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Product Group</label>
                  <select name="product_group" defaultValue="EXP" className={inputClass}>
                    <option value="EXP">EXP (Express/international)</option>
                    <option value="DOM">DOM (Domestic)</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Product Type</label>
                  <input name="service_code" placeholder="PPX" defaultValue="PPX" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Duty Payer (best-effort — see report)</label>
                  <select name="ddp_ddu" defaultValue="DDU" className={inputClass}>
                    <option value="DDU">DDU (buyer pays / Collect)</option>
                    <option value="DDP">DDP (we pay / Prepaid)</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Number of Pieces</label>
                  <input name="number_of_pieces" type="number" min={1} defaultValue={1} className={inputClass} />
                </div>
              </div>
              <SharedShipmentFields order={order} />
              <button
                type="submit"
                disabled={aramexPending}
                className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
              >
                {aramexPending ? "Booking with Aramex..." : "Create Aramex Shipment"}
              </button>
            </form>
          )}

          {courier === "delhivery" && (
            <form action={delhiveryAction} className="space-y-4">
              <input type="hidden" name="order_id" value={order.id} />
              <input type="hidden" name="ref_no" value={order.refNo} />
              <input type="hidden" name="combined_order_ids" value={combinedIdsField} />
              <ResultBanner state={delhiveryState} />
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Delhivery ships within India only — no customs/duty fields apply.
              </p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <div>
                  <label className={labelClass}>Pickup Location Name *</label>
                  <input
                    name="pickup_location_name"
                    required
                    placeholder="registered on Delhivery dashboard"
                    defaultValue={prefill?.delhivery?.pickup_location_name ?? ""}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Payment Mode</label>
                  <select name="payment_mode" defaultValue="Prepaid" className={inputClass}>
                    <option value="Prepaid">Prepaid</option>
                    <option value="COD">COD</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>COD Amount (if COD)</label>
                  <input name="cod_amount" type="number" step="0.01" className={inputClass} />
                </div>
              </div>
              <SharedShipmentFields order={order} />
              <button
                type="submit"
                disabled={delhiveryPending}
                className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
              >
                {delhiveryPending ? "Booking with Delhivery..." : "Create Delhivery Shipment"}
              </button>
            </form>
          )}

          {courier === "shiprocket" && (
            <form action={shiprocketAction} className="space-y-4">
              <input type="hidden" name="order_id" value={order.id} />
              <input type="hidden" name="ref_no" value={order.refNo} />
              <input type="hidden" name="combined_order_ids" value={combinedIdsField} />
              <ResultBanner state={shiprocketState} />
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Single unified order-create flow — works for domestic and international destinations alike (Shiprocket has no
                separate international endpoint). Whether an international AWB actually assigns still depends on the connected
                Shiprocket account having international couriers enabled/serviceable on Shiprocket&apos;s own dashboard — if
                not, the error below will say so.
              </p>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <div>
                  <label className={labelClass}>Pickup Location Name *</label>
                  <input
                    name="pickup_location_name"
                    required
                    placeholder="registered on Shiprocket dashboard"
                    defaultValue={prefill?.shiprocket?.pickup_location_name ?? ""}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Payment Mode</label>
                  <select name="payment_mode" defaultValue="Prepaid" className={inputClass}>
                    <option value="Prepaid">Prepaid</option>
                    <option value="COD">COD</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Item SKU</label>
                  <input name="item_sku" defaultValue={order.skuLabel ?? ""} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>HSN Code (customs, optional)</label>
                  <input name="item_hsn_code" defaultValue={order.hsnNo ?? ""} className={inputClass} />
                </div>
              </div>
              <SharedShipmentFields order={order} />
              <button
                type="submit"
                disabled={shiprocketPending}
                className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
              >
                {shiprocketPending ? "Booking with Shiprocket..." : "Create Shiprocket Shipment"}
              </button>
            </form>
          )}
          {courier === "dhl" && (
            <form action={dhlAction} className="space-y-4">
              <input type="hidden" name="order_id" value={order.id} />
              <input type="hidden" name="ref_no" value={order.refNo} />
              <input type="hidden" name="combined_order_ids" value={combinedIdsField} />
              <ResultBanner state={dhlState} />
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div>
                  <label className={labelClass}>DHL Account Number *</label>
                  <input
                    name="dhl_account_number"
                    required
                    defaultValue={prefill?.dhl?.account_number ?? ""}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Product Code</label>
                  <input name="service_code" placeholder="P = Express Worldwide" defaultValue="P" className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Duty Payer (DHL Incoterm)</label>
                  <select name="ddp_ddu" defaultValue="DDU" className={inputClass}>
                    <option value="DDU">DDU / DAP (buyer pays duty)</option>
                    <option value="DDP">DDP (we pay duty)</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Number of Pieces</label>
                  <input name="number_of_pieces" type="number" min={1} defaultValue={1} className={inputClass} />
                </div>
              </div>
              <SharedShipmentFields order={order} />
              <button
                type="submit"
                disabled={dhlPending}
                className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
              >
                {dhlPending ? "Booking with DHL..." : "Create DHL Shipment"}
              </button>
            </form>
          )}

          <div className="border-t border-slate-200 pt-4">
            <button
              type="button"
              onClick={() => setShowManual((v) => !v)}
              className="text-sm font-medium text-slate-600 hover:text-slate-900"
            >
              {showManual ? "▾" : "▸"} ➕ Manual Entry (Booked Outside) — already booked with a courier/process outside this app
            </button>
            <p className="mt-1 text-xs text-slate-400">
              For a shipment that&apos;s already booked elsewhere (a courier not in the list above, or booked directly on a
              courier&apos;s own site) — no API call is made here, this just records the weight/dims/charges so the cost shows up
              in Track Shipments and the Freight Bill reconciliation.
            </p>

            {showManual && (
              <form action={manualAction} className="mt-3 space-y-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4">
                <input type="hidden" name="order_id" value={order.id} />
                {manualState.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{manualState.error}</p>}
                {manualState.success && (
                  <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
                    Manual shipment recorded{manualState.awbNo ? ` — AWB ${manualState.awbNo}` : " (no AWB on file yet)"}.
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  <div>
                    <label className={labelClass}>Courier *</label>
                    <select
                      name="manual_courier_choice"
                      value={manualCourier}
                      onChange={(e) => setManualCourier(e.target.value as ManualBookingCourierChoice)}
                      className={inputClass}
                    >
                      {MANUAL_BOOKING_COURIERS.map((c) => (
                        <option key={c.value} value={c.value}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                    {manualCourier === "delhivery" && (
                      <p className="mt-1 text-xs text-amber-700">
                        For Delhivery International: no public API exists for this (it&apos;s created directly on Delhivery&apos;s
                        own dashboard) — pick &quot;Other&quot; instead and type &quot;Delhivery International&quot; below, so it
                        doesn&apos;t collide with a real domestic Delhivery API booking on this order.
                      </p>
                    )}
                  </div>
                  {manualCourier === "other" && (
                    <div>
                      <label className={labelClass}>Courier / Process Name *</label>
                      <input name="manual_courier_name" required placeholder="e.g. Local hand-carry, XPS Cargo" className={inputClass} />
                    </div>
                  )}
                  <div>
                    <label className={labelClass}>AWB / Tracking No. (if known)</label>
                    <input name="awb_no" className={inputClass} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  <div>
                    <label className={labelClass}>Weight (kg) *</label>
                    <input
                      name="package_weight_kg"
                      type="number"
                      step="0.001"
                      required
                      defaultValue={order.shippingWeightKg ?? ""}
                      className={inputClass}
                    />
                  </div>
                  <div>
                    <label className={labelClass}>Length (cm) *</label>
                    <input name="package_length_cm" type="number" required defaultValue={order.lengthCm ?? ""} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Width (cm) *</label>
                    <input name="package_width_cm" type="number" required defaultValue={order.widthCm ?? ""} className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Height (cm) *</label>
                    <input name="package_height_cm" type="number" required defaultValue={order.heightCm ?? ""} className={inputClass} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                  <div>
                    <label className={labelClass}>Courier Charges Amount *</label>
                    <input name="booked_amt" type="number" step="0.01" required className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Currency</label>
                    <input name="booked_currency" defaultValue="INR" className={inputClass} />
                  </div>
                  <div>
                    <label className={labelClass}>Note (optional)</label>
                    <input name="remark" className={inputClass} />
                  </div>
                </div>
                <button
                  type="submit"
                  disabled={manualPending}
                  className="rounded-lg bg-slate-700 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-50"
                >
                  {manualPending ? "Saving..." : "Save Manual Entry"}
                </button>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
