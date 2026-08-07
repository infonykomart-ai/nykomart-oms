"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import {
  saveDutyBill,
  deleteDutyBill,
  assignDutyAwb,
  deleteDutyAwbAssignment,
  lookupOrderForReconciliation,
  type DocFormState,
  type ReconciliationLookup,
} from "./actions";

const initialFormState: DocFormState = { error: null, success: null };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type DutyBillAssignment = {
  id: string;
  order_ref_no: string;
  duty_tax_amt_usd: number | null;
  duty_tax_amt_inr: number | null;
  other_charge: number | null;
  gst_18pct: number | null;
  remark: string | null;
};

export type DutyBillRow = {
  id: string;
  invoice_no: string;
  invoice_date: string | null;
  duty_tax_amt_usd: number | null;
  duty_tax_amt_inr: number;
  gst_18pct_amt: number;
  gross_total_amt: number | null;
  assignments: DutyBillAssignment[];
};

// Duty & Tax Bill (duty_tax_bills) — exact mirror of Courier Bill's shape:
// invoice-level header covering many AWBs/orders, header create + delete
// only (no edit), assignments create + delete only. See
// freight-bill-section.tsx and actions.ts's header comment for the "why".
export function DutyBillSection({ bills }: { bills: DutyBillRow[] }) {
  const [state, formAction, pending] = useActionState(saveDutyBill, initialFormState);

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold text-slate-900">New Duty &amp; Tax Bill</h3>
        {state.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{state.error}</p>}
        {state.success && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">
            Duty &amp; Tax Bill saved — <strong>{state.success.docNo}</strong>.
          </p>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass} htmlFor="db_inv_no">Invoice No. *</label>
            <input id="db_inv_no" name="invoice_no" required className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="db_inv_date">Invoice Date</label>
            <input id="db_inv_date" name="invoice_date" type="date" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="db_usd">Duty/Tax Amt (USD)</label>
            <input id="db_usd" name="duty_tax_amt_usd" type="number" step="0.01" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="db_inr">Duty/Tax Amt (INR)</label>
            <input id="db_inr" name="duty_tax_amt_inr" type="number" step="0.01" className={inputClass} />
          </div>
          <div>
            <label className={labelClass} htmlFor="db_gst">GST @18% Amt</label>
            <input id="db_gst" name="gst_18pct_amt" type="number" step="0.01" className={inputClass} />
          </div>
        </div>
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
        >
          {pending ? "Saving..." : "Save Duty & Tax Bill"}
        </button>
      </form>

      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-700">Recent Duty &amp; Tax Bills</h3>
        {bills.map((b) => (
          <DutyBillCard key={b.id} bill={b} />
        ))}
        {bills.length === 0 && <p className="text-xs text-slate-400">None created yet.</p>}
      </div>
    </div>
  );
}

function DutyBillCard({ bill }: { bill: DutyBillRow }) {
  const [expanded, setExpanded] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleDeleteBill() {
    if (!window.confirm(`Delete Duty & Tax Bill "${bill.invoice_no}"? This cannot be undone.`)) return;
    setDeleteError("");
    startTransition(async () => {
      const result = await deleteDutyBill(bill.id);
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
          <div className="text-slate-700">₹{bill.gross_total_amt ?? bill.duty_tax_amt_inr}</div>
          <div className="text-slate-400">
            Duty ₹{bill.duty_tax_amt_inr} + GST ₹{bill.gst_18pct_amt}
            {bill.duty_tax_amt_usd ? ` (≈ $${bill.duty_tax_amt_usd})` : ""}
          </div>
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
          <AssignAwbForm dutyTaxBillId={bill.id} />
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

function AssignAwbForm({ dutyTaxBillId }: { dutyTaxBillId: string }) {
  const [state, formAction, pending] = useActionState(assignDutyAwb, initialFormState);
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
      const r = await lookupOrderForReconciliation(query, "duty");
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
              {lookup.dispatch.org_sale_amt_inr ?? "—"}
            </p>
          ) : (
            <p className="text-slate-400">No dispatch record found for this order yet.</p>
          )}
          {lookup.alreadyAssigned && <p className="text-amber-600">⚠ Already assigned to a Duty & Tax Bill.</p>}
        </div>
      )}

      {lookup?.order && !lookup.alreadyAssigned && (
        <form action={formAction} className="mt-3 space-y-2 border-t border-slate-200 pt-3">
          <input type="hidden" name="duty_tax_bill_id" value={dutyTaxBillId} />
          <input type="hidden" name="order_id" value={lookup.order.id} />
          {state.error && <p className="rounded-lg bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Duty/Tax Amt (USD)</label>
              <input name="duty_tax_amt_usd" type="number" step="0.01" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Duty/Tax Amt (INR)</label>
              <input name="duty_tax_amt_inr" type="number" step="0.01" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Other Charge</label>
              <input name="other_charge" type="number" step="0.01" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>GST @18%</label>
              <input name="gst_18pct" type="number" step="0.01" className={inputClass} />
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

function AssignmentRow({ assignment }: { assignment: DutyBillAssignment }) {
  const [deleteError, setDeleteError] = useState("");
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    if (!window.confirm(`Remove AWB "${assignment.order_ref_no}" from this bill?`)) return;
    setDeleteError("");
    startTransition(async () => {
      const result = await deleteDutyAwbAssignment(assignment.id);
      if (result.error) setDeleteError(result.error);
    });
  }

  return (
    <div className="flex items-center justify-between rounded border border-slate-100 bg-slate-50 px-2 py-1.5">
      <div>
        <span className="font-medium text-slate-900">{assignment.order_ref_no}</span>
        <span className="ml-2 text-slate-400">
          ₹{assignment.duty_tax_amt_inr ?? 0}
          {assignment.duty_tax_amt_usd ? ` ($${assignment.duty_tax_amt_usd})` : ""} · GST ₹{assignment.gst_18pct ?? 0} · Other ₹
          {assignment.other_charge ?? 0}
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
