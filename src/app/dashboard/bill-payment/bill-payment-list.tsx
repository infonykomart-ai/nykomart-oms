"use client";

// 2026-08-17 — bulk payment selection added: "FEDEX KE YA UPS KE 5 BILL EK
// SATH PAYMENT KIYA HAI UN SABHI KO SELECT KAR KE EK SATH PAYMENT
// REFRANCE UPDATE KAR SAKE" — checkbox per row (+ a "select all for this
// party" shortcut, matching the FedEx/UPS example directly) feeds a
// bottom bar where payment date/mode/reference/remark are entered ONCE
// and applied to every selected bill; each bill's own amount defaults to
// its balance due but stays editable. See actions.ts's
// recordBulkBillPayment. The original single-row "Record Payment" inline
// form is unchanged for the common one-bill-at-a-time case.
import { useActionState, useEffect, useMemo, useState } from "react";
import {
  recordBillPayment,
  recordBulkBillPayment,
  updateBillPassRegisterEntry,
  type RecordPaymentState,
  type BulkPaymentState,
  type EditBillState,
} from "./actions";
import { groupPartyOptions, type PartyOption } from "../documents/party-options";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-0.5 block text-[11px] text-slate-400";
const initialState: RecordPaymentState = { error: null, success: false };
const initialBulkState: BulkPaymentState = { error: null, success: null };
const initialEditState: EditBillState = { error: null, success: false };

export type PayableBillRow = {
  id: string;
  company_name: string;
  invoice_no: string | null;
  vendor_invoice_no: string | null;
  invoice_type: string | null;
  invoice_date: string | null;
  invoice_recv_date: string | null;
  party_id: string | null;
  party_name: string | null;
  party_type: string | null;
  source: string | null;
  due_date: string | null;
  total_amt: number;
  credit_note_amt: number;
  to_be_pay: number;
  total_paid: number;
  balance_due: number;
  remark: string | null;
};

export function BillPaymentList({ bills, parties }: { bills: PayableBillRow[]; parties: PartyOption[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [partyFilter, setPartyFilter] = useState("");

  const partyNames = useMemo(
    () => Array.from(new Set(bills.map((b) => b.party_name).filter((n): n is string => !!n))).sort(),
    [bills]
  );

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === bills.length ? new Set() : new Set(bills.map((b) => b.id))));
  }

  function selectAllForParty() {
    if (!partyFilter) return;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const b of bills) if (b.party_name === partyFilter) next.add(b.id);
      return next;
    });
  }

  const selectedBills = bills.filter((b) => selected.has(b.id));

  return (
    <div>
      {partyNames.length > 0 && (
        <div className="mb-2 flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-2">
          <span className="text-xs text-slate-500">Quick select:</span>
          <select
            value={partyFilter}
            onChange={(e) => setPartyFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
          >
            <option value="">Choose a party...</option>
            {partyNames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={selectAllForParty}
            disabled={!partyFilter}
            className="rounded-lg bg-slate-800 px-2.5 py-1 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
          >
            Select all bills for this party
          </button>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="ml-auto text-xs font-medium text-slate-500 hover:underline"
            >
              Clear selection ({selected.size})
            </button>
          )}
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left">
                  <input
                    type="checkbox"
                    checked={bills.length > 0 && selected.size === bills.length}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Company</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Invoice No.</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Type</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Party</th>
                <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Due Date</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">To Be Pay</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Paid</th>
                <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Balance Due</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {bills.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-6 text-center text-slate-400">No outstanding bills. 🎉</td>
                </tr>
              )}
              {bills.map((b) => (
                <BillRow key={b.id} bill={b} parties={parties} checked={selected.has(b.id)} onToggle={() => toggle(b.id)} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedBills.length > 0 && (
        <BulkPaymentBar bills={selectedBills} onDone={() => setSelected(new Set())} />
      )}
    </div>
  );
}

function BillRow({
  bill,
  parties,
  checked,
  onToggle,
}: {
  bill: PayableBillRow;
  parties: PartyOption[];
  checked: boolean;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [state, formAction, pending] = useActionState(recordBillPayment, initialState);
  const [editState, editFormAction, editPending] = useActionState(updateBillPassRegisterEntry, initialEditState);

  useEffect(() => {
    if (state.success) {
      const t = setTimeout(() => setOpen(false), 1200);
      return () => clearTimeout(t);
    }
  }, [state.success]);

  useEffect(() => {
    if (editState.success) {
      const t = setTimeout(() => setEditOpen(false), 1200);
      return () => clearTimeout(t);
    }
  }, [editState.success]);

  const overdue = bill.due_date && new Date(bill.due_date) < new Date();
  // 2026-08-17: only manually-entered/imported rows (source IS NULL) are
  // safe to edit directly here — see actions.ts's comment on
  // updateBillPassRegisterEntry for why auto-mirrored rows aren't.
  const editable = !bill.source;
  const partyGroups = groupPartyOptions(parties);

  return (
    <>
      <tr>
        <td className="px-3 py-2">
          <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Select ${bill.invoice_no ?? bill.id}`} />
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-slate-700">{bill.company_name}</td>
        <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">{bill.invoice_no || bill.vendor_invoice_no || "—"}</td>
        <td className="whitespace-nowrap px-3 py-2 text-slate-600">{bill.invoice_type ?? "—"}</td>
        <td className="whitespace-nowrap px-3 py-2 text-slate-600">{bill.party_name ?? "—"}</td>
        <td className={`whitespace-nowrap px-3 py-2 ${overdue ? "font-semibold text-red-600" : "text-slate-600"}`}>
          {bill.due_date ?? "—"}
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">{bill.to_be_pay.toFixed(2)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right text-slate-700">{bill.total_paid.toFixed(2)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-900">{bill.balance_due.toFixed(2)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right space-x-2">
          {editable ? (
            <button type="button" onClick={() => setEditOpen((v) => !v)} className="text-xs font-semibold text-slate-600 hover:underline">
              {editOpen ? "Cancel" : "✏️ Edit"}
            </button>
          ) : (
            <span className="text-[11px] text-slate-400" title={`Auto-linked from ${bill.source?.replace("_", " ")} — edit it there`}>
              (auto-linked)
            </span>
          )}
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-semibold text-amber-600 hover:underline">
            {open ? "Cancel" : "Record Payment"}
          </button>
        </td>
      </tr>
      {editOpen && editable && (
        <tr>
          <td colSpan={10} className="bg-indigo-50 px-3 py-3">
            <form action={editFormAction} className="space-y-2">
              <input type="hidden" name="bill_pass_register_id" value={bill.id} />
              {editState.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{editState.error}</p>}
              {editState.success && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Bill updated.</p>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div>
                  <label className={labelClass}>Invoice No.</label>
                  <input name="invoice_no" defaultValue={bill.invoice_no ?? ""} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Vendor Invoice No.</label>
                  <input name="vendor_invoice_no" defaultValue={bill.vendor_invoice_no ?? ""} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Invoice Date</label>
                  <input name="invoice_date" type="date" defaultValue={bill.invoice_date ?? ""} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Invoice Recv. Date</label>
                  <input name="invoice_recv_date" type="date" defaultValue={bill.invoice_recv_date ?? ""} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Party</label>
                  <select name="party_id" defaultValue={bill.party_id ?? ""} className={inputClass}>
                    <option value="">— No party —</option>
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
                  <label className={labelClass}>Party Type</label>
                  <input name="party_type" defaultValue={bill.party_type ?? ""} placeholder="Purchase / Courier / ..." className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Total Amt *</label>
                  <input name="total_amt" type="number" step="0.01" required defaultValue={bill.total_amt} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>Credit Note Amt</label>
                  <input name="credit_note_amt" type="number" step="0.01" defaultValue={bill.credit_note_amt} className={inputClass} />
                </div>
              </div>
              <div>
                <label className={labelClass}>Remark</label>
                <input name="remark" defaultValue={bill.remark ?? ""} className={inputClass} />
              </div>
              <p className="text-[11px] text-slate-400">
                Total Paid isn&apos;t editable here — it&apos;s tracked only through Record Payment above, so it never drifts from the payment ledger.
              </p>
              <button
                type="submit"
                disabled={editPending}
                className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {editPending ? "Saving..." : "Save Changes"}
              </button>
            </form>
          </td>
        </tr>
      )}
      {open && (
        <tr>
          <td colSpan={10} className="bg-slate-50 px-3 py-3">
            <form action={formAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="bill_pass_register_id" value={bill.id} />
              {state.error && <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
              {state.success && <p className="w-full rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">✓ Payment recorded.</p>}
              <div>
                <label className="mb-0.5 block text-[11px] text-slate-400">Amount * (balance: {bill.balance_due.toFixed(2)})</label>
                <input name="amount" type="number" step="0.01" max={bill.balance_due} required className={inputClass} />
              </div>
              <div>
                <label className="mb-0.5 block text-[11px] text-slate-400">Payment Date *</label>
                <input name="payment_date" type="date" required className={inputClass} />
              </div>
              <div>
                <label className="mb-0.5 block text-[11px] text-slate-400">Mode</label>
                <input name="payment_mode" placeholder="NEFT / Cheque / Cash" className={inputClass} />
              </div>
              <div>
                <label className="mb-0.5 block text-[11px] text-slate-400">Reference No.</label>
                <input name="reference_no" className={inputClass} />
              </div>
              <div>
                <label className="mb-0.5 block text-[11px] text-slate-400">Remark</label>
                <input name="remark" className={inputClass} />
              </div>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
              >
                {pending ? "Saving..." : "Save Payment"}
              </button>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

function BulkPaymentBar({ bills, onDone }: { bills: PayableBillRow[]; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(recordBulkBillPayment, initialBulkState);

  return (
    <div className="sticky bottom-3 mt-3 rounded-xl border border-amber-300 bg-white p-3 shadow-lg">
      <form action={formAction} className="space-y-2">
        <input type="hidden" name="bill_ids_json" value={JSON.stringify(bills.map((b) => b.id))} />

        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-slate-800">
            {bills.length} bill{bills.length === 1 ? "" : "s"} selected — ₹{bills.reduce((s, b) => s + b.balance_due, 0).toFixed(2)} total
          </p>
          <button type="button" onClick={onDone} className="text-xs font-medium text-slate-500 hover:underline">
            Clear selection
          </button>
        </div>

        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
        {state.success && (
          <div className="space-y-1 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
            {state.success.results.map((r) => (
              <p key={r.billId} className={r.ok ? "text-green-700" : "text-red-700"}>
                {r.ok ? "✓" : "✗"} {r.label} {r.error ? `— ${r.error}` : ""}
              </p>
            ))}
            <button type="button" onClick={onDone} className="mt-1 rounded border border-green-300 bg-white px-2 py-0.5 font-medium text-green-700 hover:bg-green-50">
              Done
            </button>
          </div>
        )}

        <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
          {bills.map((b) => (
            <div key={b.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-600">
                {b.invoice_no || b.vendor_invoice_no || "—"} <span className="text-slate-400">· {b.party_name ?? "—"} (balance {b.balance_due.toFixed(2)})</span>
              </span>
              <input
                name={`amount_${b.id}`}
                type="number"
                step="0.01"
                max={b.balance_due}
                defaultValue={b.balance_due.toFixed(2)}
                className="w-28 rounded border border-slate-300 bg-white px-2 py-1 text-right text-xs"
              />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-0.5 block text-[11px] text-slate-400">Payment Date *</label>
            <input name="payment_date" type="date" required className={inputClass} />
          </div>
          <div>
            <label className="mb-0.5 block text-[11px] text-slate-400">Mode</label>
            <input name="payment_mode" placeholder="NEFT / Cheque / Cash" className={inputClass} />
          </div>
          <div>
            <label className="mb-0.5 block text-[11px] text-slate-400">Reference No.</label>
            <input name="reference_no" className={inputClass} />
          </div>
          <div>
            <label className="mb-0.5 block text-[11px] text-slate-400">Remark</label>
            <input name="remark" className={inputClass} />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {pending ? "Saving..." : `Save Payment for ${bills.length} bill${bills.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </form>
    </div>
  );
}
