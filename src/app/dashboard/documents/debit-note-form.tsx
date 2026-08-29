"use client";

import { useActionState, useMemo, useState } from "react";
import { saveDebitNote, type DocFormState, type OrderLookup, type BillSearchHit } from "./actions";
import { OrderLookupBox } from "./order-lookup-box";
import { BillLookupSelect } from "./bill-lookup-select";
import { PartyBillPicker } from "./party-bill-picker";
import { groupPartyOptions, type PartyOption } from "./party-options";

const initialState: DocFormState = { error: null, success: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export function DebitNoteForm({ companies, parties }: { companies: { id: string; name: string }[]; parties: PartyOption[] }) {
  const partyGroups = groupPartyOptions(parties);
  const [state, formAction, pending] = useActionState(saveDebitNote, initialState);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [partyId, setPartyId] = useState("");
  const [orderId, setOrderId] = useState("");

  // 2026-08-27 — "credite note ya debit note agar us invoice se related ho
  // to vaha dikhna cahiye sath hi link bhi hona chahiye", follow-up:
  // "party select karte hi uske invocie no drop down aajaye us invoice me
  // kya itme hai ya kis item par debit lagana ahi" — raisedAgainstBillId is
  // the real bill_pass_register link, now populated from a plain dropdown
  // (PartyBillPicker) scoped to the selected Company+Party, with a second
  // dropdown for WHICH item on a multi-item invoice, instead of a
  // free-typed search. The pre-existing free-text "Against Invoice/Bill
  // No." field stays too, for a bill that doesn't exist in the system yet
  // — it's supplementary now, not the link.
  const [raisedAgainstBillId, setRaisedAgainstBillId] = useState("");

  // "kisi bill me agar credit debit adjust karna pade kisi dusre invocie me
  // to vo bhi hona chahiye" — optional: apply this note's amount to REDUCE
  // a different (or the same) invoice's payable.
  const [applyAdjustment, setApplyAdjustment] = useState(false);
  const [adjustTargetBill, setAdjustTargetBill] = useState<BillSearchHit | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");

  // PCS-aware Qty × Rate live helper — parallel to the Sq.Ft × Rate pattern
  // used elsewhere (e.g. PurchaseBillRateHelper); Debit Amount stays its
  // own required field (a debit note isn't always a pure qty*rate charge),
  // this is just a computed suggestion the user can copy in.
  const [qtyInput, setQtyInput] = useState("");
  const [rateInput, setRateInput] = useState("");
  const computedAmount = useMemo(() => {
    const qty = Number(qtyInput);
    const rate = Number(rateInput);
    return qty > 0 && rate > 0 ? qty * rate : null;
  }, [qtyInput, rateInput]);

  // 2026-08-29 — "20 pcs liye 260 ki rate se lekin usne 270 ki rate se
  // lagaya hai to matlab 1 pcs par 10 rupes+gst jyada liya hai": the most
  // common real Debit Note is exactly this — vendor billed at a higher
  // per-unit rate than what was agreed/PO'd. Previously there was no field
  // for this at all; the user had to work out (billed − agreed) × qty by
  // hand and type the result straight into Debit Amount, with nothing on
  // the saved record or the printout explaining where that number came
  // from. This block auto-computes it and auto-fills Debit Amount (still
  // editable/overridable) — po_rate/billed_rate are saved alongside so the
  // printed report can show the breakup too (see report/page.tsx).
  const [poRateInput, setPoRateInput] = useState("");
  const [billedRateInput, setBilledRateInput] = useState("");
  const [debitAmountManual, setDebitAmountManual] = useState("");
  const [debitAmountTouched, setDebitAmountTouched] = useState(false);
  const rateDiff = useMemo(() => {
    const po = Number(poRateInput);
    const billed = Number(billedRateInput);
    return poRateInput !== "" && billedRateInput !== "" ? billed - po : null;
  }, [poRateInput, billedRateInput]);
  const rateDiffAmount = useMemo(() => {
    const qty = Number(qtyInput);
    return rateDiff != null && qty > 0 ? rateDiff * qty : null;
  }, [rateDiff, qtyInput]);

  // Debit Amount shown/submitted is derived at render time, not synced via
  // an effect: the calculator's suggestion drives it right up until the
  // user types into the field themselves, after which their own entry
  // always wins (never silently overwrite a manual value).
  const debitAmountInput = debitAmountTouched ? debitAmountManual : rateDiffAmount != null ? rateDiffAmount.toFixed(2) : "";

  function handleFound(r: OrderLookup) {
    if (!r.order) return;
    setCompanyId(r.order.company_id);
    setOrderId(r.order.id);
  }

  if (state.success) {
    return <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Debit Note created — <strong>{state.success.docNo}</strong>.</p>;
  }

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="bill_pass_register_id" value={raisedAgainstBillId} />
      <input type="hidden" name="adjust_target_bill_pass_register_id" value={applyAdjustment ? adjustTargetBill?.primaryBillId ?? "" : ""} />
      <input type="hidden" name="adjust_amount" value={applyAdjustment ? adjustAmount : ""} />

      <OrderLookupBox label="Find order by PO/RF/RG No. (optional)" onFound={handleFound} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="dn_company">Company *</label>
          <select id="dn_company" name="company_id" required value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={inputClass}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="dn_party">Party (Vendor) *</label>
          <select id="dn_party" name="party_id" required value={partyId} onChange={(e) => setPartyId(e.target.value)} className={inputClass}>
            <option value="" disabled>Select party</option>
            {partyGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.parties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      {/* 2026-08-27 (follow-up) — auto-populated the instant Company+Party
          are picked above, no typing needed; shows item-by-item on a
          multi-item invoice so this note attaches to the specific item. */}
      <PartyBillPicker
        label="Raised against bill/invoice (optional)"
        companyId={companyId}
        partyId={partyId}
        selectedBillId={raisedAgainstBillId}
        onSelect={setRaisedAgainstBillId}
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="dn_date">Debit Note Date *</label>
          <input id="dn_date" name="debit_note_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="dn_against">Against Invoice/Bill No. (free text note)</label>
          <input id="dn_against" name="against_invoice_bill_no" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="dn_bill_no">Bill No.</label>
          <input id="dn_bill_no" name="bill_no" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="dn_bill_date">Bill Date</label>
          <input id="dn_bill_date" name="bill_date" type="date" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="dn_sqft">Sq. Ft</label>
          <input id="dn_sqft" name="sq_ft" type="number" step="0.01" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="dn_qty">Qty</label>
          <input id="dn_qty" name="qty" type="number" value={qtyInput} onChange={(e) => setQtyInput(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="dn_rate">Rate (per pc/unit)</label>
          <input id="dn_rate" name="rate" type="number" step="0.01" value={rateInput} onChange={(e) => setRateInput(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="dn_amount">Debit Amount *</label>
          <input
            id="dn_amount"
            name="debit_amount"
            type="number"
            step="0.01"
            required
            value={debitAmountInput}
            onChange={(e) => {
              setDebitAmountTouched(true);
              setDebitAmountManual(e.target.value);
            }}
            className={inputClass}
          />
        </div>
      </div>

      {computedAmount != null && (
        <p className="rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
          Qty × Rate = <strong className="text-slate-700">{computedAmount.toFixed(2)}</strong> — copy this into Debit Amount if it&apos;s a straight
          piece-count/unit charge.
        </p>
      )}

      {/* 2026-08-29 — "20 pcs liye 260 ki rate se lekin usne 270 ki rate se
          lagaya hai" — see the poRateInput/billedRateInput comment above.
          Optional: leave both blank for a flat/non-rate Debit Amount, same
          as before. */}
      <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
        <p className="mb-2 text-xs font-semibold text-slate-700">Rate Difference Calculator (optional)</p>
        <p className="mb-2 text-[11px] text-slate-500">
          If the vendor billed at a higher rate than agreed/PO — e.g. 20 pcs at ₹260 agreed, billed at ₹270 — fill Qty above plus
          both rates here; Debit Amount fills in automatically as (Billed − PO Rate) × Qty, and the printed Debit Note will show
          this breakup instead of a bare amount.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="dn_po_rate">Agreed / PO Rate (per unit)</label>
            <input
              id="dn_po_rate"
              name="po_rate"
              type="number"
              step="0.01"
              value={poRateInput}
              onChange={(e) => setPoRateInput(e.target.value)}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="dn_billed_rate">Billed Rate (vendor charged, per unit)</label>
            <input
              id="dn_billed_rate"
              name="billed_rate"
              type="number"
              step="0.01"
              value={billedRateInput}
              onChange={(e) => setBilledRateInput(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>
        {rateDiff != null && (
          <p className="mt-2 text-xs text-slate-600">
            Difference: <strong>₹{rateDiff.toFixed(2)}</strong> / unit
            {rateDiffAmount != null && (
              <>
                {" "}× Qty {qtyInput} = <strong className="text-slate-800">₹{rateDiffAmount.toFixed(2)}</strong>
                {debitAmountTouched && Number(debitAmountInput) !== rateDiffAmount && (
                  <span className="ml-1 text-amber-600">(Debit Amount was edited manually — not auto-filled)</span>
                )}
              </>
            )}
          </p>
        )}
      </div>

      <div>
        <label className={labelClass} htmlFor="dn_particulars">Particulars</label>
        <input id="dn_particulars" name="particulars" className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor="dn_remark">Remark</label>
        <input id="dn_remark" name="remark" className={inputClass} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          <input type="checkbox" checked={applyAdjustment} onChange={(e) => setApplyAdjustment(e.target.checked)} />
          Apply this Debit Note&apos;s amount as an adjustment against an invoice (reduces what&apos;s payable there — can be a
          DIFFERENT invoice than the one above)
        </label>
        {applyAdjustment && (
          <div className="mt-2 space-y-2">
            <BillLookupSelect
              label="Invoice to adjust"
              selected={adjustTargetBill}
              onSelect={setAdjustTargetBill}
              onClear={() => setAdjustTargetBill(null)}
            />
            <div>
              <label className={labelClass}>Adjustment amount *</label>
              <input
                type="number"
                step="0.01"
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(e.target.value)}
                className={inputClass}
                required={applyAdjustment}
              />
            </div>
            <div>
              <label className={labelClass}>Adjustment remark</label>
              <input name="adjust_remark" className={inputClass} />
            </div>
            {adjustTargetBill && Number(adjustAmount) > adjustTargetBill.balanceDue && (
              <p className="text-[11px] text-amber-600">
                Amount exceeds that invoice&apos;s current balance due (₹{adjustTargetBill.balanceDue.toFixed(2)}) — still allowed, but double-check.
              </p>
            )}
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save Debit Note"}
      </button>
    </form>
  );
}
