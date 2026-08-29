"use client";

import { useActionState, useMemo, useState } from "react";
import { saveCreditNote, type DocFormState, type OrderLookup, type BillSearchHit } from "./actions";
import { OrderLookupBox } from "./order-lookup-box";
import { BillLookupSelect } from "./bill-lookup-select";
import { PartyBillPicker } from "./party-bill-picker";
import { groupPartyOptions, type PartyOption } from "./party-options";

const initialState: DocFormState = { error: null, success: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

const REFUND_TYPES = ["PARTIAL REFUND", "FULL REFUND", "A TO Z CLAIM", "NO REFUND", "CUSTOM TAX"];

export function CreditNoteForm({
  companies,
  stores,
  parties,
}: {
  companies: { id: string; name: string }[];
  stores: { id: string; name: string; company_id: string }[];
  parties: PartyOption[];
}) {
  const partyGroups = groupPartyOptions(parties);
  const [state, formAction, pending] = useActionState(saveCreditNote, initialState);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [orderId, setOrderId] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceUsd, setInvoiceUsd] = useState("");
  const [invoiceInr, setInvoiceInr] = useState("");
  const [debitNoteOptions, setDebitNoteOptions] = useState<{ id: string; debit_note_no: string | null }[]>([]);

  // 2026-08-27 (later same day) — "esa hi credite note me karo esa hi
  // courior ke credit note debit note me karo": vendor-side link, same
  // Company+Party -> bill dropdown (incl. specific item on a multi-item
  // invoice) as Debit Note, now on Credit Note too — e.g. a courier's own
  // credit note reducing what we owe them. All optional: the original
  // sales/buyer-refund fields below are untouched and still work with no
  // party selected at all.
  const [partyId, setPartyId] = useState("");
  const [raisedAgainstBillId, setRaisedAgainstBillId] = useState("");
  const [applyAdjustment, setApplyAdjustment] = useState(false);
  const [adjustTargetBill, setAdjustTargetBill] = useState<BillSearchHit | null>(null);
  const [adjustAmount, setAdjustAmount] = useState("");

  // 2026-08-29 — "ab esa system credit note ke liye bhi banao": same Rate
  // Difference Calculator as Debit Note (see debit-note-form.tsx's fuller
  // comment on the same pattern) — e.g. a courier/purchase party's own
  // credit note undercharging relative to what was agreed/PO'd. Scoped to
  // ONLY the vendor-side (Party) flow above, per the user's own boundary
  // ("credit note po ke against me rahega ye vala, lekin agar kisi party ko
  // bhi issue karna pad gaya to uske hisab se sahi se banao") — the
  // calculator only renders once a Party is selected, and Refund Amount
  // stays a plain manual field for the original sales/buyer-refund flow.
  const [qtyInput, setQtyInput] = useState("");
  const [poRateInput, setPoRateInput] = useState("");
  const [billedRateInput, setBilledRateInput] = useState("");
  const [refundAmountManual, setRefundAmountManual] = useState("");
  const [refundAmountTouched, setRefundAmountTouched] = useState(false);
  const rateDiff = useMemo(() => {
    const po = Number(poRateInput);
    const billed = Number(billedRateInput);
    return poRateInput !== "" && billedRateInput !== "" ? billed - po : null;
  }, [poRateInput, billedRateInput]);
  const rateDiffAmount = useMemo(() => {
    const qty = Number(qtyInput);
    return rateDiff != null && qty > 0 ? rateDiff * qty : null;
  }, [rateDiff, qtyInput]);
  // Refund Amount shown/submitted is derived at render time, not synced via
  // an effect — same reasoning as debit-note-form.tsx's debitAmountInput:
  // the calculator's suggestion drives it until the user types into the
  // field themselves, after which their own entry always wins.
  const refundAmountInput = refundAmountTouched
    ? refundAmountManual
    : partyId && rateDiffAmount != null
      ? rateDiffAmount.toFixed(2)
      : "";

  function handleFound(r: OrderLookup) {
    if (!r.order) return;
    setCompanyId(r.order.company_id);
    setOrderId(r.order.id);
    setBuyerName(r.order.buyer_name_address ?? "");
    setInvoiceNo(r.invoice?.invoice_no ?? "");
    setInvoiceUsd(r.order.order_value_usd != null ? String(r.order.order_value_usd) : "");
    setInvoiceInr(r.order.order_value_inr != null ? String(r.order.order_value_inr) : "");
    setDebitNoteOptions(r.debitNotes.map((d) => ({ id: d.id, debit_note_no: d.debit_note_no })));
  }

  if (state.success) {
    return <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Credit Note created — <strong>{state.success.docNo}</strong>.</p>;
  }

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      <input type="hidden" name="order_id" value={orderId} />
      <input type="hidden" name="party_id" value={partyId} />
      <input type="hidden" name="bill_pass_register_id" value={raisedAgainstBillId} />
      <input type="hidden" name="adjust_target_bill_pass_register_id" value={applyAdjustment ? adjustTargetBill?.primaryBillId ?? "" : ""} />
      <input type="hidden" name="adjust_amount" value={applyAdjustment ? adjustAmount : ""} />

      <OrderLookupBox onFound={handleFound} />

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
        <p className="text-xs font-medium text-slate-600">
          Vendor-side credit note (optional) — e.g. a courier or purchase party&apos;s own credit note against their bill
        </p>
        <div>
          <label className={labelClass} htmlFor="cn_party">Party (Vendor)</label>
          <select id="cn_party" value={partyId} onChange={(e) => setPartyId(e.target.value)} className={inputClass}>
            <option value="">— Not vendor-related —</option>
            {partyGroups.map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.parties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <PartyBillPicker
          label="Raised against bill/invoice"
          companyId={companyId}
          partyId={partyId}
          selectedBillId={raisedAgainstBillId}
          onSelect={setRaisedAgainstBillId}
        />

        {partyId && (
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
            <p className="mb-2 text-xs font-semibold text-slate-700">Rate Difference Calculator (optional)</p>
            <p className="mb-2 text-[11px] text-slate-500">
              If the party&apos;s own credit note is for a rate difference — e.g. undercharged/overcharged relative to
              agreed/PO — fill Qty and both rates here; Refund Amount fills in automatically as (Billed − PO Rate) × Qty.
            </p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className={labelClass} htmlFor="cn_qty">Qty</label>
                <input
                  id="cn_qty"
                  name="qty"
                  type="number"
                  value={qtyInput}
                  onChange={(e) => setQtyInput(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="cn_po_rate">Agreed / PO Rate (per unit)</label>
                <input
                  id="cn_po_rate"
                  name="po_rate"
                  type="number"
                  step="0.01"
                  value={poRateInput}
                  onChange={(e) => setPoRateInput(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className={labelClass} htmlFor="cn_billed_rate">Billed/Credited Rate (per unit)</label>
                <input
                  id="cn_billed_rate"
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
                    {refundAmountTouched && Number(refundAmountInput) !== rateDiffAmount && (
                      <span className="ml-1 text-amber-600">(Refund Amount was edited manually — not auto-filled)</span>
                    )}
                  </>
                )}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="cn_company">Company *</label>
          <select id="cn_company" name="company_id" required value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={inputClass}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="cn_store">Store / Portal</label>
          <select id="cn_store" name="store_id" defaultValue="" className={inputClass}>
            <option value="">—</option>
            {stores.filter((s) => s.company_id === companyId).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="cn_date">Credit Note Date *</label>
          <input id="cn_date" name="credit_note_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cn_refund_date">Refund Date</label>
          <input id="cn_refund_date" name="refund_date" type="date" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cn_buyer">Buyer Name</label>
          <input id="cn_buyer" name="buyer_name" value={buyerName} onChange={(e) => setBuyerName(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cn_item_id">Item ID (marketplace line item)</label>
          <input id="cn_item_id" name="item_id" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cn_item_name">Item Name</label>
          <input id="cn_item_name" name="item_name" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cn_item_price">Item Price</label>
          <input id="cn_item_price" name="item_price" type="number" step="0.01" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cn_invoice_no">Invoice No.</label>
          <input id="cn_invoice_no" name="invoice_no" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cn_refund_type">Refund Type</label>
          <select id="cn_refund_type" name="refund_type" defaultValue="" className={inputClass}>
            <option value="">—</option>
            {REFUND_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="cn_invoice_usd">Invoice Value (USD)</label>
          <input id="cn_invoice_usd" name="invoice_value_usd" type="number" step="0.01" value={invoiceUsd} onChange={(e) => setInvoiceUsd(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cn_invoice_inr">Invoice Value (INR)</label>
          <input id="cn_invoice_inr" name="invoice_value_inr" type="number" step="0.01" value={invoiceInr} onChange={(e) => setInvoiceInr(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cn_refund_amount">Refund Amount *</label>
          <input
            id="cn_refund_amount"
            name="refund_amount"
            type="number"
            step="0.01"
            required
            value={refundAmountInput}
            onChange={(e) => {
              setRefundAmountTouched(true);
              setRefundAmountManual(e.target.value);
            }}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="cn_refund_usd">Refund Amt (USD)</label>
          <input id="cn_refund_usd" name="refund_amt_usd" type="number" step="0.01" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cn_refund_inr">Refund Amt (INR)</label>
          <input id="cn_refund_inr" name="refund_amt_inr" type="number" step="0.01" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="cn_status">Credit Note Status</label>
          <input id="cn_status" name="credit_note_status" className={inputClass} />
        </div>
        {debitNoteOptions.length > 0 && (
          <div>
            <label className={labelClass} htmlFor="cn_debit_note">Link to Debit Note (if any)</label>
            <select id="cn_debit_note" name="debit_note_id" defaultValue="" className={inputClass}>
              <option value="">—</option>
              {debitNoteOptions.map((d) => (
                <option key={d.id} value={d.id}>{d.debit_note_no ?? "—"}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <label className={labelClass} htmlFor="cn_remark">Remark</label>
        <input id="cn_remark" name="remark" className={inputClass} />
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
          <input type="checkbox" checked={applyAdjustment} onChange={(e) => setApplyAdjustment(e.target.checked)} />
          Apply this Credit Note&apos;s amount as an adjustment against an invoice (reduces what&apos;s payable there — can be a
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
        {pending ? "Saving..." : "Save Credit Note"}
      </button>
    </form>
  );
}
