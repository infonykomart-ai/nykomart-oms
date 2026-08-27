"use client";

import { useActionState, useState } from "react";
import { groupBillIds, groupBills, type BillGroup } from "@/lib/bill-grouping";
import { approveLevel1, approveLevel2, rejectBill, type ApprovalActionState } from "./actions";

const initialState: ApprovalActionState = { error: null, success: false };

export type ApprovalBillRow = {
  id: string;
  company_id: string;
  company_name: string;
  invoice_no: string | null;
  vendor_invoice_no: string | null;
  invoice_type: string | null;
  party_id: string | null;
  party_name: string | null;
  source: string | null;
  total_amt: number;
  to_be_pay: number;
  prepared_by_name: string | null;
  created_at: string;
  approved_l1_by_name?: string | null;
  approved_l1_at?: string | null;
  // Item-level detail, present only for source='purchase_bill' rows (joined
  // from purchase_bills via source_id) — shown in the expandable breakdown
  // for a grouped (multi-item/multi-order) invoice.
  item_description?: string | null;
  item_qty?: number | null;
  item_qty_unit?: string | null;
  item_unit_rate?: number | null;
};

export function ApprovalList({ bills, level }: { bills: ApprovalBillRow[]; level: 1 | 2 }) {
  const groups = groupBills(bills);

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
            {groups.length === 0 && (
              <tr>
                <td colSpan={level === 2 ? 8 : 7} className="px-3 py-6 text-center text-slate-400">
                  Nothing waiting on your approval. 🎉
                </td>
              </tr>
            )}
            {groups.map((g) => (
              <GroupRow key={g.key} group={g} level={level} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupRow({ group, level }: { group: BillGroup<ApprovalBillRow>; level: 1 | 2 }) {
  const [expanded, setExpanded] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const approveAction = level === 1 ? approveLevel1 : approveLevel2;
  const [approveState, approveFormAction, approvePending] = useActionState(approveAction, initialState);
  const [rejectState, rejectFormAction, rejectPending] = useActionState(rejectBill, initialState);

  const first = group.bills[0];
  const totalAmt = group.bills.reduce((sum, b) => sum + b.total_amt, 0);
  const toBePay = group.bills.reduce((sum, b) => sum + b.to_be_pay, 0);
  const colSpan = level === 2 ? 8 : 7;

  return (
    <>
      <tr className={group.isGroup ? "bg-amber-50/40" : undefined}>
        <td className="whitespace-nowrap px-3 py-2 text-slate-700">{first.company_name}</td>
        <td className="whitespace-nowrap px-3 py-2 font-medium text-slate-800">
          <div className="flex items-center gap-1.5">
            {group.isGroup && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="rounded border border-slate-300 px-1 text-[10px] text-slate-500 hover:bg-slate-100"
                aria-label={expanded ? "Collapse items" : "Expand items"}
              >
                {expanded ? "▾" : "▸"}
              </button>
            )}
            <span>{first.invoice_no || first.vendor_invoice_no || "—"}</span>
            {group.isGroup && (
              <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                {group.bills.length} items · 1 invoice
              </span>
            )}
          </div>
        </td>
        <td className="whitespace-nowrap px-3 py-2 text-slate-600">{first.invoice_type ?? "—"}</td>
        <td className="whitespace-nowrap px-3 py-2 text-slate-600">{first.party_name ?? "—"}</td>
        <td className="whitespace-nowrap px-3 py-2 text-right font-semibold text-slate-900">{toBePay.toFixed(2)}</td>
        <td className="whitespace-nowrap px-3 py-2 text-slate-600">{first.prepared_by_name ?? "—"}</td>
        {level === 2 && <td className="whitespace-nowrap px-3 py-2 text-slate-600">{first.approved_l1_by_name ?? "—"}</td>}
        <td className="whitespace-nowrap px-3 py-2 text-right">
          <div className="flex items-center justify-end gap-2">
            <form action={approveFormAction}>
              <input type="hidden" name="bill_ids" value={groupBillIds(group)} />
              <button
                type="submit"
                disabled={approvePending}
                className="rounded-lg bg-green-600 px-3 py-1 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {approvePending ? "..." : group.isGroup ? `Approve L${level} (whole invoice)` : `Approve L${level}`}
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
      {expanded && group.isGroup && (
        <tr>
          <td colSpan={colSpan} className="bg-slate-50 px-3 py-2">
            <div className="rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-400">
                    <th className="px-2 py-1 text-left font-medium">Item / Work</th>
                    <th className="px-2 py-1 text-right font-medium">Qty</th>
                    <th className="px-2 py-1 text-right font-medium">Rate</th>
                    <th className="px-2 py-1 text-right font-medium">Amount (Payable)</th>
                  </tr>
                </thead>
                <tbody>
                  {group.bills.map((b) => (
                    <tr key={b.id} className="border-b border-slate-50 last:border-0">
                      <td className="px-2 py-1 text-slate-700">{b.item_description || "—"}</td>
                      <td className="px-2 py-1 text-right text-slate-600">
                        {b.item_qty != null ? `${b.item_qty} ${b.item_qty_unit ?? ""}`.trim() : "—"}
                      </td>
                      <td className="px-2 py-1 text-right text-slate-600">{b.item_unit_rate != null ? b.item_unit_rate.toFixed(2) : "—"}</td>
                      <td className="px-2 py-1 text-right font-medium text-slate-800">{b.to_be_pay.toFixed(2)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={3} className="px-2 py-1 text-right font-semibold text-slate-500">
                      Invoice total
                    </td>
                    <td className="px-2 py-1 text-right font-semibold text-slate-900">{totalAmt.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
      {rejecting && (
        <tr>
          <td colSpan={colSpan} className="bg-red-50 px-3 py-3">
            <form action={rejectFormAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="bill_ids" value={groupBillIds(group)} />
              <input type="hidden" name="level" value={level} />
              {rejectState.error && <p className="w-full text-xs text-red-800">{rejectState.error}</p>}
              <div className="flex-1">
                <label className="mb-0.5 block text-[11px] text-slate-500">
                  Rejection reason {group.isGroup ? "(applies to the whole invoice)" : ""} *
                </label>
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
