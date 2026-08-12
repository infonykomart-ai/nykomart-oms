"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  saveFreightBill,
  deleteFreightBill,
  assignFreightAwb,
  deleteFreightAwbAssignment,
  lookupOrderForReconciliation,
  type DocFormState,
  type ReconciliationLookup,
} from "./actions";

const initialFormState: DocFormState = { error: null, success: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type FreightBillAssignment = {
  id: string;
  order_ref_no: string;
  bill_weight_kg: number | null;
  difference_amt: number | null;
  remark: string | null;
};

export type FreightBillRow = {
  id: string;
  invoice_no: string;
  invoice_date: string | null;
  bill_weight_kg: number | null;
  freight_amt: number;
  fuel_amt: number;
  other_charges: number;
  total_amt: number | null;
  gst_18pct_amt: number | null;
  gross_total_amt: number | null;
  credit_note_no: string | null;
  credit_note_date: string | null;
  credit_note_amt: number;
  assignments: FreightBillAssignment[];
};

// Courier Bill (freight_bills) — an invoice-level header covering MANY
// AWBs/orders at once (can span all 3 companies — see actions.ts's header
// comment), so this is NOT a flat create-form like the other doc types:
// it's a header create-form + a list of headers, each expandable to
// "assign an AWB" (lookupOrderForReconciliation by PO/RF/RG or AWB no.,
// then assignFreightAwb) and to see/remove its already-assigned AWBs.
// No edit action exists for the header or an assignment — only delete +
// re-create, since a bill's numbers rarely change once posted.
export function FreightBillSection({ bills }: { bills: FreightBillRow[] }) {
  const [state, formAction, pending] = useActionState(saveFreightBill, initialFormState);

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">New Courier Bill</h3>
        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
        {state.success && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
            Courier Bill saved — <strong>{state.success.docNo}</strong>.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="fb_inv_no">Invoice No. *</label>
            <input id="fb_inv_no" name="invoice_no" required className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="fb_inv_date">Invoice Date</label>
            <input id="fb_inv_date" name="invoice_date" type="date" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="fb_weight">Bill Weight (kg)</label>
            <input id="fb_weight" name="bill_weight_kg" type="number" step="0.01" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="fb_freight">Freight Amt</label>
            <input id="fb_freight" name="freight_amt" type="number" step="0.01" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="fb_fuel">Fuel Amt</label>
            <input id="fb_fuel" name="fuel_amt" type="number" step="0.01" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="fb_other">Other Charges</label>
            <input id="fb_other" name="other_charges" type="number" step="0.01" className={inputClass} />
          </div>
        </div>

        {/* 2026-08-12: "shipment ke against me courier ka credit note
            aagya" — optional, only fill in if the courier actually issued
            one against this invoice. */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="mb-1.5 text-xs font-medium text-amber-800">Courier Credit Note (if any)</div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelClass} htmlFor="fb_cn_no">Credit Note No.</label>
              <input id="fb_cn_no" name="credit_note_no" className={inputClass} placeholder="optional" />
            </div>
            <div>
              <label className={labelClass} htmlFor="fb_cn_date">Credit Note Date</label>
              <input id="fb_cn_date" name="credit_note_date" type="date" className={inputClass} />
            </div>
            <div>
              <label className={labelClass} htmlFor="fb_cn_amt">Credit Note Amt</label>
              <input id="fb_cn_amt" name="credit_note_amt" type="number" step="0.01" className={inputClass} placeholder="0" />
            </div>
          </div>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save Courier Bill"}
        </button>
      </form>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-700">Recent Courier Bills</h3>
        {bills.map((b) => (
          <FreightBillCard key={b.id} bill={b} />
        ))}
        {bills.length === 0 && <p className="text-xs text-slate-400">None created yet.</p>}
      </div>
    </div>
  );
}

function FreightBillCard({ bill }: { bill: FreightBillRow }) {
  const [expanded, setExpanded] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleDeleteBill() {
    if (!window.confirm(`Delete Courier Bill "${bill.invoice_no}"? This cannot be undone.`)) return;
    setDeleteError("");
    startTransition(async () => {
      const result = await deleteFreightBill(bill.id);
      if (result.error) setDeleteError(result.error);
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-medium text-slate-900">{bill.invoice_no}</div>
          <div className="text-slate-400">
            {bill.invoice_date ?? "—"} · {bill.assignments.length} AWB(s) assigned
          </div>
        </div>
        <div className="text-right">
          <div className="text-slate-700">₹{bill.gross_total_amt ?? bill.total_amt ?? 0}</div>
          <div className="text-slate-400">
            Freight ₹{bill.freight_amt} + Fuel ₹{bill.fuel_amt} + Other ₹{bill.other_charges}
          </div>
          {bill.credit_note_amt > 0 && (
            <div className="text-purple-700">
              CN {bill.credit_note_no ?? "—"} · −₹{bill.credit_note_amt}
            </div>
          )}
        </div>
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
        <p className="text-red-600">{deleteError}</p>
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
          >
            {expanded ? "Hide AWBs" : "Assign / View AWBs"}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={handleDeleteBill}
            className="rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
          >
            Delete
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <AssignAwbForm freightBillId={bill.id} />
          <div className="space-y-1.5">
            {bill.assignments.map((a) => (
              <AssignmentRow key={a.id} assignment={a} />
            ))}
            {bill.assignments.length === 0 && <p className="text-slate-400">No AWBs assigned yet.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function AssignAwbForm({ freightBillId }: { freightBillId: string }) {
  const [state, formAction, pending] = useActionState(assignFreightAwb, initialFormState);
  const [query, setQuery] = useState("");
  const [lookup, setLookup] = useState<ReconciliationLookup | null>(null);
  const [isLooking, startLookup] = useTransition();

  useEffect(() => {
    if (state.success) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery("");
      setLookup(null);
    }
  }, [state.success]);

  function handleLookup() {
    startLookup(async () => {
      const r = await lookupOrderForReconciliation(query, "freight");
      setLookup(r);
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <label className={labelClass}>Find order by PO/RF/RG or AWB No.</label>
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), handleLookup())}
          placeholder="e.g. PO-0001 or AWB123456"
          className={inputClass}
        />
        <button
          type="button"
          onClick={handleLookup}
          disabled={isLooking}
          className="shrink-0 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
        >
          {isLooking ? "..." : "Find"}
        </button>
      </div>

      {lookup?.error && <p className="mt-2 text-xs text-red-600">{lookup.error}</p>}

      {lookup?.order && (
        <div className="mt-2 space-y-1 rounded-lg bg-white p-2 text-xs text-slate-600">
          <p>
            <strong className="text-slate-900">{lookup.order.ref_no}</strong>
          </p>
          {lookup.dispatch ? (
            <p>
              AWB: {lookup.dispatch.awb_no ?? "—"} · {lookup.dispatch.courier_name ?? "—"} · {lookup.dispatch.buyer_country ?? "—"} ·{" "}
              {lookup.dispatch.shipping_weight_kg ?? "—"} kg
            </p>
          ) : (
            <p className="text-slate-400">No dispatch record found for this order yet.</p>
          )}
          {lookup.alreadyAssigned && <p className="text-amber-600">⚠ Already assigned to a Courier Bill.</p>}
        </div>
      )}

      {lookup?.order && !lookup.alreadyAssigned && (
        <form action={formAction} className="mt-3 space-y-2 border-t border-slate-200 pt-3">
          <input type="hidden" name="freight_bill_id" value={freightBillId} />
          <input type="hidden" name="order_id" value={lookup.order.id} />
          {state.error && <p className="rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Bill Weight (kg)</label>
              <input
                name="bill_weight_kg"
                type="number"
                step="0.01"
                defaultValue={lookup.dispatch?.shipping_weight_kg ?? ""}
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>Difference Amt</label>
              <input name="difference_amt" type="number" step="0.01" className={inputClass} />
            </div>
          </div>
          <div>
            <label className={labelClass}>Remark</label>
            <input name="remark" className={inputClass} />
          </div>
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
          >
            {pending ? "Assigning..." : "Assign to this Bill"}
          </button>
        </form>
      )}
    </div>
  );
}

function AssignmentRow({ assignment }: { assignment: FreightBillAssignment }) {
  const [deleteError, setDeleteError] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!window.confirm(`Remove AWB "${assignment.order_ref_no}" from this bill?`)) return;
    setDeleteError("");
    startTransition(async () => {
      const result = await deleteFreightAwbAssignment(assignment.id);
      if (result.error) setDeleteError(result.error);
    });
  }

  return (
    <div className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-2 py-1.5">
      <div>
        <span className="font-medium text-slate-900">{assignment.order_ref_no}</span>
        <span className="ml-2 text-slate-400">
          {assignment.bill_weight_kg ?? "—"} kg · Diff ₹{assignment.difference_amt ?? 0}
        </span>
        {assignment.remark && <span className="ml-2 text-slate-400">· {assignment.remark}</span>}
      </div>
      <div className="flex items-center gap-2">
        <p className="text-red-600">{deleteError}</p>
        <button
          type="button"
          disabled={isPending}
          onClick={handleDelete}
          className="rounded border border-red-200 bg-red-50 px-2 py-0.5 font-medium text-red-600 hover:bg-red-100 disabled:opacity-50"
        >
          Remove
        </button>
      </div>
    </div>
  );
}
