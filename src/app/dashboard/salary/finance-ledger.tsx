"use client";

// 2026-08-12 (round 7): "jitni sellery debit hoyegi account se to uska
// bhi konse section me jayegi finance ke" — this IS that section:
// bill_pass_register (the old "NYKO MART/RUG ARA — ALL BILLS" master
// payable ledger, schema already existed but had NO UI until now) shown
// here for the selected company, mixing manually-typed vendor bills with
// the auto-inserted Salary/Advance rows from submitSalaryPayment/
// giveAdvance (tagged with a "Salary"/"Advance" badge so the two kinds
// are visually distinct at a glance, even though they're one list).
//
// Courier Bill / Duty & Tax Bill / Purchase Bill already have their own
// dedicated forms at /dashboard/documents (with AWB-assignment flows
// those need) — the manual-entry form here is deliberately the general
// fallback for everything else (Printing/Washing/Disbursement FEE/
// Service/JOB WORK), matching what the old Bill Pass Register format
// itself always allowed alongside those.
import { useActionState, useState } from "react";
import { addBillPassEntry, type FinanceActionState } from "./actions";

const initialState: FinanceActionState = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

const MANUAL_INVOICE_TYPES = ["DUTY TAX", "Purchase", "FREIGHT INVOICE", "Printing", "Washing", "Disbursement FEE", "Service", "JOB WORK"];

export type LedgerRow = {
  id: string;
  invoice_type: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  who: string; // party name or employee name, whichever this row is for
  total_amt: number;
  credit_note_amt: number;
  to_be_pay: number;
  total_paid: number;
  balance_due: number;
  due_date: string | null;
  source: string | null; // null = manual, 'salary_payment' | 'employee_advance' = auto
  remark: string | null;
};

export function FinanceLedger({
  companyId,
  parties,
  rows,
}: {
  companyId: string;
  parties: { id: string; name: string }[];
  rows: LedgerRow[];
}) {
  const [state, formAction, pending] = useActionState(addBillPassEntry, initialState);
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700">🧾 Finance — Bill Pass Register</h2>
        <button
          type="button"
          onClick={() => setShowForm((v) => !v)}
          className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        >
          {showForm ? "Close" : "+ Add Bill Pass Entry"}
        </button>
      </div>

      {showForm && (
        <form action={formAction} className="mb-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <input type="hidden" name="company_id" value={companyId} />
          {state.error && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
          {state.success && state.message && <p className="rounded bg-green-50 px-2 py-1.5 text-xs text-green-800">{state.message}</p>}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div>
              <label className={labelClass}>Party</label>
              <select name="party_id" defaultValue="" className={inputClass}>
                <option value="">— none —</option>
                {parties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Invoice Type</label>
              <select name="invoice_type" defaultValue="" className={inputClass}>
                <option value="">—</option>
                {MANUAL_INVOICE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Invoice No.</label>
              <input name="invoice_no" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Vendor Invoice No.</label>
              <input name="vendor_invoice_no" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Invoice Date</label>
              <input name="invoice_date" type="date" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Invoice Recv. Date</label>
              <input name="invoice_recv_date" type="date" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Total Amt *</label>
              <input name="total_amt" type="number" step="0.01" required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Credit Note Amt</label>
              <input name="credit_note_amt" type="number" step="0.01" placeholder="0" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Total Paid</label>
              <input name="total_paid" type="number" step="0.01" placeholder="0" className={inputClass} />
            </div>
          </div>
          <div>
            <label className={labelClass}>Remark</label>
            <input name="remark" className={inputClass} />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {pending ? "Saving..." : "Save Entry"}
          </button>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-slate-400">
              <th className="py-1 pr-3">Date</th>
              <th className="px-2">Type</th>
              <th className="px-2">Party / Employee</th>
              <th className="px-2">Invoice No.</th>
              <th className="px-2">Total Amt</th>
              <th className="px-2">Credit Note</th>
              <th className="px-2">To Be Pay</th>
              <th className="px-2">Total Paid</th>
              <th className="px-2">Balance Due</th>
              <th className="px-2">Due Date</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-1.5 pr-3">{r.invoice_date ?? "—"}</td>
                <td className="px-2">
                  <span className="font-medium text-slate-800">{r.invoice_type ?? "—"}</span>
                  {r.source && (
                    <span className="ml-1 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700">Auto</span>
                  )}
                </td>
                <td className="px-2 text-slate-600">{r.who}</td>
                <td className="px-2 text-slate-500">{r.invoice_no ?? "—"}</td>
                <td className="px-2">{r.total_amt.toFixed(2)}</td>
                <td className="px-2 text-purple-700">{r.credit_note_amt ? `−${r.credit_note_amt.toFixed(2)}` : "—"}</td>
                <td className="px-2">{r.to_be_pay.toFixed(2)}</td>
                <td className="px-2 text-green-700">{r.total_paid.toFixed(2)}</td>
                <td className={`px-2 font-medium ${r.balance_due > 0 ? "text-red-700" : "text-green-700"}`}>{r.balance_due.toFixed(2)}</td>
                <td className="px-2 text-slate-400">{r.due_date ?? "—"}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={10} className="py-3 text-center text-slate-400">No Bill Pass entries for this company yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
