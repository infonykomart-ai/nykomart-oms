"use client";

import { useActionState, useState } from "react";
import { approveLevel1, approveLevel2, rejectBill, type ApprovalActionState } from "./actions";

const initialState: ApprovalActionState = { error: null, success: false };

export type ApprovalBillRow = {
  id: string;
  company_name: string;
  invoice_no: string | null;
  vendor_invoice_no: string | null;
  invoice_type: string | null;
  party_name: string | null;
  total_amt: number;
  to_be_pay: number;
  prepared_by_name: string | null;
  created_at: string;
  approved_l1_by_name?: string | null;
  approved_l1_at?: string | null;
};

export function ApprovalList({ bills, level }: { bills: ApprovalBillRow[]; level: 1 | 2 }) {
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
              <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">To Be Pay</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Prepared By</th>
              {level === 2 && <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">L1 Approved By</th>}
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {bills.length === 0 && (
              <tr>
                <td colSpan={level === 2 ? 8 : 7} className="px-3 py-6 text-center text-slate-400">
                  Nothing waiting on your approval. 🎉
                </td>
              </tr>
            )}
            {bills.map((b) => (
              <BillRow key={b.id} bill={b} level={level} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BillRow({ bill, level }: { bill: ApprovalBillRow; level: 1 | 2 }) {
  const [rejecting, setRejecting] = useState(false);
  const approveAction = level === 1 ? approveLevel1 : approveLevel2;
  const [approveState, approveFormAction, approvePending] = useActionState(approveAction, initialState);
  const [rejectState, rejectFormAction, rejectPending] = useActionState(rejectBill, initialState);

  return (
    <>
      <tr>
        <td className="whitespace-nowrap px-3 py-2 text-slate-700">{bill.company_name}</td>
        <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">{bill.invoice_no || bill.vendor_invoice_no || "—"}</td>
        <td className="whitespace-nowrap px-3 py-2 text-slate-600">{bill.invoice_type ?? "—"}</td>
        <td className="whitespace-nowrap px-3 py-2 text-slate-600">{bill.party_name ?? "—"}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-900">{bill.to_be_pay.toFixed(2)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-slate-600">{bill.prepared_by_name ?? "—"}</td>
        {level === 2 && <td className="whitespace-nowrap px-3 py-2 text-slate-600">{bill.approved_l1_by_name ?? "—"}</td>}
        <td className="whitespace-nowrap px-3 py-2 text-right">
          <div className="flex items-center justify-end gap-2">
            <form action={approveFormAction}>
              <input type="hidden" name="bill_id" value={bill.id} />
              <button
                type="submit"
                disabled={approvePending}
                className="rounded-lg bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {approvePending ? "..." : `Approve L${level}`}
              </button>
            </form>
            <button
              type="button"
              onClick={() => setRejecting((v) => !v)}
              className="rounded-lg border border-red-300 px-3 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
            >
              Reject
            </button>
          </div>
          {approveState.error && <p className="mt-1 text-right text-xs text-red-600">{approveState.error}</p>}
        </td>
      </tr>
      {rejecting && (
        <tr>
          <td colSpan={level === 2 ? 8 : 7} className="bg-red-50 px-3 py-3">
            <form action={rejectFormAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="bill_id" value={bill.id} />
              <input type="hidden" name="level" value={level} />
              {rejectState.error && <p className="w-full text-xs text-red-800">{rejectState.error}</p>}
              <div className="flex-1">
                <label className="mb-0.5 block text-[11px] text-slate-500">Rejection reason *</label>
                <input
                  name="reason"
                  required
                  className="w-full rounded-lg border border-red-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-red-500 focus:ring-1 focus:ring-red-500"
                />
              </div>
              <button
                type="submit"
                disabled={rejectPending}
                className="rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              >
                {rejectPending ? "..." : "Confirm Reject"}
              </button>
              <button type="button" onClick={() => setRejecting(false)} className="text-xs text-slate-400 hover:underline">
                Cancel
              </button>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
