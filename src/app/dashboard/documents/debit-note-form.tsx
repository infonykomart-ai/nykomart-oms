"use client";

import { useActionState, useMemo, useState } from "react";
import { saveDebitNote, type DocFormState, type OrderLookup, type BillSearchHit } from "./actions";
import { OrderLookupBox } from "./order-lookup-box";
import { BillLookupSelect } from "./bill-lookup-select";
import { groupPartyOptions, type PartyOption } from "./party-options";

const initialState: DocFormState = { error: null, success: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export function DebitNoteForm({ companies, parties }: { companies: { id: string; name: string }[]; parties: PartyOption[] }) {
  const partyGroups = groupPartyOptions(parties);
  const [state, formAction, pending] = useActionState(saveDebitNote, initialState);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [orderId, setOrderId] = useState("");

  // 2026-08-27 — "credite note ya debit note agar us invoice se related ho
  // to vaha dikhna cahiye sath hi link bhi hona chahiye": raisedAgainstBill
  // is the real bill_pass_register link (dropdown, per user's confirmed
  // choice — see BillLookupSelect/searchBillsForNote). The pre-existing
  // free-text "Against Invoice/Bill No." field stays too, for a bill that
  // doesn't exist in the system yet — it's supplementary now, not the link.
  const [raisedAgainstBill, setRaisedAgainstBill] = useState<BillSearchHit | null>(null);

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
      <input type="hidden" name="bill_pass_register_id" value={raisedAgainstBill?.primaryBillId ?? ""} />
      <input type="hidden" name="adjust_target_bill_pass_register_id" value={applyAdjustment ? adjustTargetBill?.primaryBillId ?? "" : ""} />
      <input type="hidden" name="adjust_amount" value={applyAdjustment ? adjustAmount : ""} />

      <OrderLookupBox label="Find order by PO/RF/RG No. (optional)" onFound={handleFound} />

      <div>
        <label className={labelClass}>Raised against bill/invoice (optional — search by vendor/invoice no.)</label>
        <BillLookupSelect
          label=""
          selected={raisedAgainstBill}
          onSelect={setRaisedAgainstBill}
          onClear={() => setRaisedAgainstBill(null)}
        />
      </div>

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
          <select id="dn_party" name="party_id" required defaultValue="" className={inputClass}>
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
          <input id="dn_amount" name="debit_amount" type="number" step="0.01" required className={inputClass} />
        </div>
      </div>

      {computedAmount != null && (
        <p className="rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-500">
          Qty × Rate = <strong className="text-slate-700">{computedAmount.toFixed(2)}</strong> — copy this into Debit Amount if it&apos;s a straight
          piece-count/unit charge.
        </p>
      )}

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
