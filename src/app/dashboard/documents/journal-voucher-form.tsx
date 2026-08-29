"use client";

// 2026-08-29 (evening) — manual Journal Voucher entry. Most JVs auto-
// generate the instant a bill lands in Bill Pass Register (see actions.ts's
// createJournalVoucherForBill, called from savePurchaseBillCore /
// sendFreightBillToFinance / sendDutyBillToFinance) — but the user asked
// for a manual option too ("JV no automatic ke sath sath manual option bhi
// hona chahiye"), for a JV that doesn't map to one of those 3 automatic
// paths. Linking to an existing bill here is optional — PartyBillPicker
// (same component Debit Note's "Raised against bill/invoice" uses) lets
// you attach it to a real bill_pass_register row if there is one, or leave
// it blank for a fully free-standing JV.
import { useActionState, useMemo, useState } from "react";
import { saveJournalVoucher, type DocFormState } from "./actions";
import { PartyBillPicker } from "./party-bill-picker";
import { groupPartyOptions, type PartyOption } from "./party-options";

const initialState: DocFormState = { error: null, success: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export function JournalVoucherForm({ companies, parties }: { companies: { id: string; name: string }[]; parties: PartyOption[] }) {
  const partyGroups = groupPartyOptions(parties);
  const [state, formAction, pending] = useActionState(saveJournalVoucher, initialState);
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [partyId, setPartyId] = useState("");
  const [billPassRegisterId, setBillPassRegisterId] = useState("");

  // Passed Amount defaults to Debit Amount (the common case — nothing to
  // adjust yet) but stays freely editable, same derived-at-render-time
  // pattern as the Rate Difference Calculator elsewhere in this file —
  // never synced via an effect.
  const [debitAmount, setDebitAmount] = useState("");
  const [passedAmountManual, setPassedAmountManual] = useState("");
  const [passedAmountTouched, setPassedAmountTouched] = useState(false);
  const passedAmountInput = useMemo(
    () => (passedAmountTouched ? passedAmountManual : debitAmount),
    [passedAmountTouched, passedAmountManual, debitAmount]
  );

  if (state.success) {
    return <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">Journal Voucher created — <strong>{state.success.docNo}</strong>.</p>;
  }

  return (
    <form action={formAction} className="space-y-3">
      {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
      <input type="hidden" name="bill_pass_register_id" value={billPassRegisterId} />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="jv_company">Company *</label>
          <select id="jv_company" name="company_id" required value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={inputClass}>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass} htmlFor="jv_party">Vendor *</label>
          <select id="jv_party" name="party_id" required value={partyId} onChange={(e) => setPartyId(e.target.value)} className={inputClass}>
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

      <PartyBillPicker
        label="Link to an existing bill (optional)"
        companyId={companyId}
        partyId={partyId}
        selectedBillId={billPassRegisterId}
        onSelect={setBillPassRegisterId}
      />

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className={labelClass} htmlFor="jv_date">JV Date *</label>
          <input id="jv_date" name="jv_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="jv_invoice_no">Invoice No.</label>
          <input id="jv_invoice_no" name="vendor_invoice_no" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="jv_invoice_date">Invoice Date</label>
          <input id="jv_invoice_date" name="invoice_date" type="date" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="jv_debit_amount">Debit Amount *</label>
          <input
            id="jv_debit_amount"
            name="debit_amount"
            type="number"
            step="0.01"
            required
            value={debitAmount}
            onChange={(e) => setDebitAmount(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="jv_item_details">Item Details</label>
          <input id="jv_item_details" name="item_details" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="jv_passed_amount">Passed Amount</label>
          <input
            id="jv_passed_amount"
            name="passed_amount"
            type="number"
            step="0.01"
            value={passedAmountInput}
            onChange={(e) => {
              setPassedAmountTouched(true);
              setPassedAmountManual(e.target.value);
            }}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass} htmlFor="jv_qty">Qty</label>
          <input id="jv_qty" name="qty" type="number" step="0.01" className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="jv_qty_unit">Qty Unit</label>
          <input id="jv_qty_unit" name="qty_unit" placeholder="FT / PCS / etc." className={inputClass} />
        </div>
        <div>
          <label className={labelClass} htmlFor="jv_qlty">Qlty</label>
          <input id="jv_qlty" name="qlty" className={inputClass} />
        </div>
      </div>

      <div>
        <label className={labelClass} htmlFor="jv_particulars">Particulars</label>
        <input id="jv_particulars" name="particulars" className={inputClass} />
      </div>
      <div>
        <label className={labelClass} htmlFor="jv_remark">Remarks</label>
        <input id="jv_remark" name="remark" className={inputClass} />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save Journal Voucher"}
      </button>
    </form>
  );
}
