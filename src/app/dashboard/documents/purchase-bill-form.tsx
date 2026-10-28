"use client";

import { useState } from "react";
import { useActionState } from "react";
import { savePurchaseBill, type DocFormState, type OrderLookup } from "./actions";
import { OrderLookupBox } from "./order-lookup-box";
import { groupPartyOptions, type PartyOption } from "./party-options";
import { PurchaseQtyUnitSelect } from "@/components/purchase-qty-unit-select";
import { areaToSqFt, type LengthUnit, type PurchaseQtyUnit } from "@/lib/length-units";
import { GstSelect, type GstType } from "@/components/gst-select";
import { PurchaseBillRateHelper } from "@/components/purchase-bill-rate-helper";
import { RoundOffField } from "./round-off-field";

const initialState: DocFormState = { error: null, success: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

// Purchase Bill (vendor's own bill for job-work/purchases) — same flat-form
// + order-lookup pattern as Washing Entry. 2026-08-08: "YE LINK HONA
// CHAHIYE... SABHI CHEJE LINK RAHEGI" made the order link REQUIRED: every
// purchase tied to the PO/RF/RG it was bought for, so "which party did
// this order's item come from" is answerable — see the reverse lookup on
// the Orders hub. 2026-08-17: "KACHA MAAL... GENERAL STOCK KE LIYE — KOI
// FIXED PO NAHI" — raw-material vendor purchases aren't for one specific
// order, so the link is optional again (see actions.ts's
// savePurchaseBillCore comment for how company scoping still works
// without one).
export function PurchaseBillForm({
  parties,
  billKind = "purchase",
}: {
  parties: PartyOption[];
  /**
   * 2026-10-24b — "COTTON KI DHURRI KE PO KE ORDER KA PRINTING KA BILL AATA
   * HAI ... USKI ENTRY KAHA HOGI": a printing bill has exactly this shape
   * (vendor invoice, PO link, qty × rate, GST, round off), so the Printing
   * Bill tab reuses this form and only tags the saved row bill_kind =
   * 'printing' so it lands in the ledger's Printing bucket and the Printing
   * register.
   */
  billKind?: "purchase" | "printing";
}) {
  const [state, formAction, pending] = useActionState(savePurchaseBill, initialState);
  const [orderId, setOrderId] = useState("");
  // 2026-08-20 — Gap 2: pre-filled (not locked) from the looked-up order's
  // "planned" vendor (orders.vendor_party_id), if it has one. Still a
  // plain controlled <select> the user can freely change — this is only a
  // convenience default, since the real vendor is only actually confirmed
  // once their bill is in hand.
  const [vendorPartyId, setVendorPartyId] = useState("");
  const partyGroups = groupPartyOptions(parties);

  // 2026-08-17 — "FT/MTR/INCH/YARD/CM SABHI KA FOURMULA KAAM KARNA CHAHIYE"
  // — vendor can bill raw material in whichever unit. 2026-08-17 (later,
  // real bug found live): the value is saved AS ENTERED, in whichever unit
  // is picked — NOT converted to feet — because Unit Rate is always the
  // rate the vendor quoted per THAT unit (e.g. ₹21.03/MTR); converting the
  // quantity to feet first and then multiplying by a per-MTR rate silently
  // inflated the total by the conversion factor. The feet-equivalent below
  // is shown purely as a reference conversion, not what gets saved or
  // priced. See db/2026-08-17-purchase-bills-qty-unit.sql and
  // src/lib/length-units.ts.
  const [sqFeetInput, setSqFeetInput] = useState("");
  const [sqFeetUnit, setSqFeetUnit] = useState<PurchaseQtyUnit>("FT");
  const isPcs = sqFeetUnit === "PCS";
  // 2026-10-24b — "AGAR KISI VENDOR NE MTR ME LINEAR METRES BILL KIYA HAI TO
  // US NUMBER KO AREA MAAN KAR SQUARE KARNA MEANING NAHI RAKHTA": the
  // Sq. Ft normalisation assumes the number is an AREA. Fabric rolls are
  // billed as a LENGTH, so the entry now says which one it is instead of the
  // sheet guessing. 'area' is the default and changes nothing for FT bills.
  const [sizeMode, setSizeMode] = useState<"area" | "as_billed">("area");
  // 2026-08-27 — "AGAR PURCHASE PCS ME KIYA JATA HAI TO US PCS KI RATE KYA
  // HOGI": PCS has no feet-equivalent (it's a piece count, not a length),
  // so the reference conversion line below only makes sense for the
  // original 5 length units.
  //
  // 2026-10-24 — this used to call toFeet(), i.e. the LINEAR factor, while
  // labelling the result "Sq. Feet equivalent". The number entered here is an
  // AREA in the chosen unit (9 with MTR = 9 sq m), so the squared factor is
  // the correct one: 9 sq m = 9 × 3.28084² = 96.88 sq ft, not 29.53. Fixed
  // via areaToSqFt so the reference line can't understate the area 3.28x.
  const sqFeetConverted =
    sqFeetInput && !isPcs ? areaToSqFt(Number(sqFeetInput) || 0, sqFeetUnit as LengthUnit) : 0;

  // 2026-08-26 — controlled (not defaultValue) so the rate-from-size helper
  // below can fill both in directly; still freely editable by hand same as
  // before.
  const [qtyInput, setQtyInput] = useState("1");
  const [unitRateInput, setUnitRateInput] = useState("");

  const [gstRatePct, setGstRatePct] = useState<number | null>(null);
  const [gstType, setGstType] = useState<GstType>("CGST_SGST");
  // Payable BEFORE round-off, exactly as g_total_plus_gst computes it
  // (qty × sq_feet × rate + GST), so the offered round figures are the ones
  // the vendor's invoice actually lands on. Passed to the shared round-off
  // control, which owns the round_off_amt value itself.
  const preRoundAmount =
    (Number(qtyInput) || 0) * (Number(sqFeetInput) || 0) * (Number(unitRateInput) || 0);
  const totalGstPct = gstRatePct == null ? 5 : gstType === "IGST" ? gstRatePct : gstRatePct * 2;
  const preRoundPayable = preRoundAmount + Math.round(preRoundAmount * totalGstPct) / 100;

  function handleFound(r: OrderLookup) {
    setOrderId(r.order?.id ?? "");
    // Only pre-fill when the order actually has a planned vendor — never
    // clear a vendor the user already picked just because a subsequent
    // lookup's order happens to have none set.
    if (r.order?.vendor_party_id) setVendorPartyId(r.order.vendor_party_id);
  }

  if (state.success) {
    return (
      <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
        Purchase Bill saved — <strong>{state.success.docNo}</strong>.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="bill_kind" value={billKind} />

      <OrderLookupBox label="Link to an order by PO/RF/RG No. (optional)" onFound={handleFound} />
      {!orderId && (
        <p className="-mt-1 text-xs text-slate-400">
          Optional — leave blank for a general-stock raw-material purchase not tied to one specific order.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="pb_party">Vendor Party *</label>
          <select
            id="pb_party"
            name="vendor_party_id"
            required
            value={vendorPartyId}
            onChange={(e) => setVendorPartyId(e.target.value)}
            className={inputClass}
          >
            <option value="" disabled>Select vendor</option>
            {partyGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.parties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="pb_inv_no">Vendor Invoice No. *</label>
          <input id="pb_inv_no" name="vendor_invoice_no" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="pb_inv_date">Vendor Invoice Date</label>
          <input id="pb_inv_date" name="vendor_invoice_date" type="date" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="pb_qty">Qty {isPcs && <span className="text-slate-400">(Pcs)</span>}</label>
          <input
            id="pb_qty"
            name="qty"
            type="number"
            value={qtyInput}
            onChange={(e) => setQtyInput(e.target.value)}
            className={inputClass}
          />
        </div>
        {/* 2026-08-27 — hidden in PCS mode: this helper works out a per-sq-ft
            rate from an item's size (e.g. "3X90 FT"), which doesn't apply to
            a piece-count purchase — a PCS bill already states its rate per
            piece directly (e.g. "16 PCS @ Rs.260/pc"), nothing to derive. */}
        {!isPcs && (
          <PurchaseBillRateHelper
            qty={Number(qtyInput) || 0}
            unitIsFt={sqFeetUnit === "FT"}
            onApply={(sqFeet, unitRate) => {
              setSqFeetInput(String(sqFeet));
              setUnitRateInput(String(unitRate));
            }}
            idPrefix="pb"
          />
        )}
        <div>
          <label className={labelClass} htmlFor="pb_sqfeet">{isPcs ? "Unit" : "Sq. Feet"}</label>
          <div className="flex gap-1.5">
            {!isPcs && (
              <input
                id="pb_sqfeet"
                type="number"
                step="0.01"
                value={sqFeetInput}
                onChange={(e) => setSqFeetInput(e.target.value)}
                className={inputClass}
              />
            )}
            <PurchaseQtyUnitSelect value={sqFeetUnit} onChange={setSqFeetUnit} />
          </div>
          {!isPcs && sqFeetUnit !== "FT" && sqFeetInput && sizeMode === "area" && (
            <p className="mt-0.5 text-[11px] text-slate-400">
              ≈ {sqFeetConverted.toFixed(2)} Sq. Ft (area) — reference only, saved as entered in {sqFeetUnit}
            </p>
          )}
          {!isPcs && sqFeetUnit !== "FT" && (
            <label className="mt-1 flex items-start gap-1.5 text-[11px] text-slate-500">
              <input
                type="checkbox"
                checked={sizeMode === "as_billed"}
                onChange={(e) => setSizeMode(e.target.checked ? "as_billed" : "area")}
                className="mt-0.5"
              />
              <span>
                Vendor billed a <strong>linear length</strong> (e.g. fabric roll 524.20 {sqFeetUnit} @ per-{sqFeetUnit} rate) — show it as billed, do
                not convert it to Sq Ft.
              </span>
            </label>
          )}
          <input type="hidden" name="size_mode" value={sizeMode} />
          {isPcs && (
            <p className="mt-0.5 text-[11px] text-slate-400">Purchased by piece count — Qty × Rate per Pcs is used directly, no size needed.</p>
          )}
          <input type="hidden" name="sq_feet" value={isPcs ? "1" : sqFeetInput} />
          <input type="hidden" name="qty_unit" value={sqFeetUnit} />
        </div>
        <div>
          <label className={labelClass} htmlFor="pb_rate">{isPcs ? "Rate per Pcs" : "Unit Rate"} {!isPcs && sqFeetUnit !== "FT" && <span className="text-slate-400">(per {sqFeetUnit})</span>}</label>
          <input
            id="pb_rate"
            name="unit_rate"
            type="number"
            step="0.01"
            value={unitRateInput}
            onChange={(e) => setUnitRateInput(e.target.value)}
            className={inputClass}
          />
        </div>
        <div className="col-span-2">
          <label className={labelClass} htmlFor="pb_desc">Work Description</label>
          <input id="pb_desc" name="work_description" className={inputClass} />
        </div>
        <div className="col-span-2">
          <label className={labelClass} htmlFor="pb_gst_rate">GST</label>
          <GstSelect ratePct={gstRatePct} onRateChange={setGstRatePct} gstType={gstType} onTypeChange={setGstType} idPrefix="pb" />
          <input type="hidden" name="gst_rate_pct" value={gstRatePct ?? ""} />
          <input type="hidden" name="gst_type" value={gstRatePct != null ? gstType : ""} />
        </div>
        <div>
          {/* 2026-08-17: manual adjustment so the saved total can match a
              vendor invoice that itself rounds off by a few paise (e.g.
              AF/145: CGST 904.25 + SGST 904.25, then "Round Off (-)0.30"
              on the vendor's own bill) — see
              db/2026-08-17-purchase-bills-round-off.sql.
              2026-10-24b / 2026-10-28: the shared +/− control with the
              round-figure shortcuts, identical to every other bill form. */}
          <RoundOffField id="pb_round_off" payable={preRoundPayable} />
        </div>
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving..." : billKind === "printing" ? "Save Printing Bill" : "Save Purchase Bill"}
      </button>
    </form>
  );
}
