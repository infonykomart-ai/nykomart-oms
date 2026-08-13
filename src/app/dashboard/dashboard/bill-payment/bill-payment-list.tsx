"use client";

import { useActionState, useEffect, useState } from "react";
import { recordBillPayment, type RecordPaymentState } from "./actions";

const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const initialState: RecordPaymentState = { error: null, success: false };

export type PayableBillRow = {
  id: string;
  company_name: string;
  invoice_no: string | null;
  vendor_invoice_no: string | null;
  invoice_type: string | null;
  party_name: string | null;
  due_date: string | null;
  total_amt: number;
  credit_note_amt: number;
  to_be_pay: number;
  total_paid: number;
  balance_due: number;
};

export function BillPaymentList({ bills }: { bills: PayableBillRow[] }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
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
                <td colSpan={9} className="px-3 py-6 text-center text-slate-400">No outstanding bills. 🎉</td>
              </tr>
            )}
            {bills.map((b) => (
              <BillRow key={b.id} bill={b} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BillRow({ bill }: { bill: PayableBillRow }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(recordBillPayment, initialState);

  useEffect(() => {
    if (state.success) {
      const t = setTimeout(() => setOpen(false), 1200);
      return () => clearTimeout(t);
    }
  }, [state.success]);

  const overdue = bill.due_date && new Date(bill.due_date) < new Date();

  return (
    <>
      <tr>
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
        <td className="whitespace-nowrap px-3 py-2 text-right">
          <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-semibold text-amber-600 hover:underline">
            {open ? "Cancel" : "Record Payment"}
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} className="bg-slate-50 px-3 py-3">
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
