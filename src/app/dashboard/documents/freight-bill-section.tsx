"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import {
  saveFreightBill,
  deleteFreightBill,
  assignFreightAwb,
  deleteFreightAwbAssignment,
  lookupOrderForReconciliation,
  bulkAssignFreightAwbs,
  updateFreightAwbAssignmentNotes,
  sendFreightBillToFinance,
  sendDutyBillToFinance,
  type DocFormState,
  type ReconciliationLookup,
  type SimpleResult,
  type BulkAwbResult,
} from "./actions";

const initialFormState: DocFormState = { error: null, success: null };
const initialSimple: SimpleResult = { error: null, success: false };
const inputClass =
  "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-900 outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type FreightBillAssignment = {
  id: string;
  order_ref_no: string;
  bill_weight_kg: number | null;
  dimensional_weight_kg: number | null;
  difference_amt: number | null;
  credit_note_no: string | null;
  credit_note_date: string | null;
  credit_note_amt: number | null;
  debit_note_no: string | null;
  debit_note_date: string | null;
  debit_note_amt: number | null;
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
  sentToFinance: boolean;
};

// Courier Bill (freight_bills) — an invoice-level header covering MANY
// AWBs/orders at once (can span all 3 companies — see actions.ts's header
// comment), so this is NOT a flat create-form like the other doc types:
// it's a header create-form + a list of headers, each expandable to
// assign AWBs (one at a time, or in bulk — 2026-08-12 round 10) and to
// see/remove its already-assigned AWBs, plus (round 10) send the whole
// bill to the Finance ledger once reviewed.
export function FreightBillSection({ bills, companies }: { bills: FreightBillRow[]; companies: { id: string; name: string }[] }) {
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
          <div className="mb-1.5 text-xs font-medium text-amber-800">Courier Credit Note (if any) — whole-invoice level</div>
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
          <FreightBillCard key={b.id} bill={b} companies={companies} />
        ))}
        {bills.length === 0 && <p className="text-xs text-slate-400">None created yet.</p>}
      </div>
    </div>
  );
}

function FreightBillCard({ bill, companies }: { bill: FreightBillRow; companies: { id: string; name: string }[] }) {
  const [expanded, setExpanded] = useState(false);
  const [bulkMode, setBulkMode] = useState(false);
  const [financeMode, setFinanceMode] = useState(false);
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
            {bill.sentToFinance && <span className="ml-1 text-green-700">· ✓ in Bill Pass Register</span>}
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
      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-1.5">
        <p className="text-red-600">{deleteError}</p>
        <div className="flex shrink-0 flex-wrap gap-1.5">
          <Link
            href={`/dashboard/documents/freight-bills/${bill.id}/report`}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
          >
            📄 Report / PDF
          </Link>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50"
          >
            {expanded ? "Hide AWBs" : "Assign / View AWBs"}
          </button>
          {!bill.sentToFinance && (
            <button
              type="button"
              onClick={() => setFinanceMode((v) => !v)}
              className="rounded border border-green-200 bg-green-50 px-2 py-0.5 font-medium text-green-700 hover:bg-green-100"
            >
              💰 Send to Bill Pass Register
            </button>
          )}
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

      {financeMode && (
        <SendToFinanceForm
          billId={bill.id}
          kind="freight"
          companies={companies}
          defaultAmt={Number(bill.gross_total_amt ?? bill.total_amt ?? 0) - Number(bill.credit_note_amt ?? 0)}
          onDone={() => setFinanceMode(false)}
        />
      )}

      {expanded && (
        <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setBulkMode(false)}
              className={`rounded-full px-2.5 py-1 font-medium ${!bulkMode ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              One at a time
            </button>
            <button
              type="button"
              onClick={() => setBulkMode(true)}
              className={`rounded-full px-2.5 py-1 font-medium ${bulkMode ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-600"}`}
            >
              Bulk (many AWBs at once)
            </button>
          </div>
          {bulkMode ? <BulkAssignAwbForm freightBillId={bill.id} /> : <AssignAwbForm freightBillId={bill.id} />}
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

/**
 * "Send to Bill Pass Register" — shared by Courier Bill and Duty & Tax
 * Bill cards. Explicit + reviewed (not automatic on save): these headers
 * have no company_id of their own since one invoice can span AWBs across
 * multiple companies with no stored split — see actions.ts's comment on
 * sendFreightBillToFinance/sendDutyBillToFinance.
 */
export function SendToFinanceForm({
  billId,
  kind,
  companies,
  defaultAmt,
  onDone,
}: {
  billId: string;
  kind: "freight" | "duty";
  companies: { id: string; name: string }[];
  defaultAmt: number;
  onDone: () => void;
}) {
  const action = kind === "freight" ? sendFreightBillToFinance : sendDutyBillToFinance;
  const [state, formAction, pending] = useActionState(action, initialSimple);

  useEffect(() => {
    if (state.success) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.success]);

  return (
    <form action={formAction} className="mt-2 space-y-2 rounded-lg border border-green-200 bg-green-50 p-3">
      <input type="hidden" name={kind === "freight" ? "freight_bill_id" : "duty_tax_bill_id"} value={billId} />
      {state.error && <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-800">{state.error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className={labelClass}>Company *</label>
          <select name="company_id" required defaultValue="" className={inputClass}>
            <option value="" disabled>Select company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Amount</label>
          <input name="total_amt" type="number" step="0.01" defaultValue={defaultAmt.toFixed(2)} className={inputClass} />
        </div>
      </div>
      <div>
        <label className={labelClass}>Remark</label>
        <input name="remark" className={inputClass} placeholder="optional" />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
      >
        {pending ? "Sending..." : "Confirm — Send to Finance"}
      </button>
    </form>
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
              <label className={labelClass}>Dimensional Weight (kg)</label>
              <input name="dimensional_weight_kg" type="number" step="0.01" className={inputClass} />
            </div>
          </div>
          <div>
            <label className={labelClass}>Difference Amt</label>
            <input name="difference_amt" type="number" step="0.01" className={inputClass} />
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

/**
 * 2026-08-12 (round 10): "SUPOSE KARO PICHLE MAHINE 200 SHIPMENT GAYI...
 * AWB TRACKING NO KO SELECT KARNE KA OPTION HO PHIR UNKE AGAINST ME DETAIL
 * DALNE KA OPTION HO" — paste many PO/RF/RG-or-AWB numbers at once, look
 * them all up, fill in per-row figures, assign all in one submit.
 * Individual bad rows don't block the rest (bulkAssignFreightAwbs is
 * partial-failure-tolerant).
 */
function BulkAssignAwbForm({ freightBillId }: { freightBillId: string }) {
  const [raw, setRaw] = useState("");
  const [rows, setRows] = useState<
    { query: string; billWeightKg: string; dimensionalWeightKg: string; differenceAmt: string; remark: string }[]
  >([]);
  const [results, setResults] = useState<BulkAwbResult[] | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleParse() {
    const queries = raw
      .split(/\r?\n|,/)
      .map((s) => s.trim())
      .filter(Boolean);
    setRows(queries.map((q) => ({ query: q, billWeightKg: "", dimensionalWeightKg: "", differenceAmt: "", remark: "" })));
    setResults(null);
  }

  function updateRow(i: number, patch: Partial<(typeof rows)[number]>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function handleAssignAll() {
    startTransition(async () => {
      const r = await bulkAssignFreightAwbs(
        freightBillId,
        rows.map((r) => ({
          query: r.query,
          billWeightKg: r.billWeightKg ? Number(r.billWeightKg) : null,
          dimensionalWeightKg: r.dimensionalWeightKg ? Number(r.dimensionalWeightKg) : null,
          differenceAmt: r.differenceAmt ? Number(r.differenceAmt) : null,
          remark: r.remark || null,
        }))
      );
      setResults(r.results);
      // Match by position, not by query text — bulkAssignFreightAwbs
      // returns results in the same order it received rows, so this is
      // exact even when the same PO/AWB was pasted twice (a text match
      // would incorrectly drop BOTH duplicate rows the moment either one
      // succeeded).
      setRows((prev) => prev.filter((_, i) => !r.results[i]?.ok));
    });
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <label className={labelClass}>Paste PO/RF/RG or AWB numbers — one per line (or comma-separated)</label>
      <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={3} className={inputClass} placeholder={"PO-0001\nPO-0002\nAWB123456"} />
      <button
        type="button"
        onClick={handleParse}
        className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700"
      >
        Look Up All
      </button>

      {results && (
        <div className="mt-2 space-y-1">
          {results.map((r, i) => (
            <p key={i} className={r.ok ? "text-green-700" : "text-red-700"}>
              {r.ok ? "✓" : "✗"} {r.refNo ?? r.query} — {r.ok ? "assigned" : r.error}
            </p>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-3 space-y-2">
          {rows.map((r, i) => (
            <div key={r.query + i} className="grid grid-cols-5 items-end gap-1.5 rounded border border-slate-200 bg-white p-1.5">
              <div className="col-span-1 font-medium text-slate-800">{r.query}</div>
              <input
                value={r.billWeightKg}
                onChange={(e) => updateRow(i, { billWeightKg: e.target.value })}
                placeholder="Bill kg"
                className={inputClass}
              />
              <input
                value={r.dimensionalWeightKg}
                onChange={(e) => updateRow(i, { dimensionalWeightKg: e.target.value })}
                placeholder="Dim. kg"
                className={inputClass}
              />
              <input
                value={r.differenceAmt}
                onChange={(e) => updateRow(i, { differenceAmt: e.target.value })}
                placeholder="Diff ₹"
                className={inputClass}
              />
              <input value={r.remark} onChange={(e) => updateRow(i, { remark: e.target.value })} placeholder="Remark" className={inputClass} />
            </div>
          ))}
          <button
            type="button"
            disabled={isPending}
            onClick={handleAssignAll}
            className="w-full rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {isPending ? "Assigning..." : `Assign All (${rows.length})`}
          </button>
        </div>
      )}
    </div>
  );
}

function AssignmentRow({ assignment }: { assignment: FreightBillAssignment }) {
  const [deleteError, setDeleteError] = useState("");
  const [noteMode, setNoteMode] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [noteState, noteAction, notePending] = useActionState(updateFreightAwbAssignmentNotes, initialSimple);

  useEffect(() => {
    if (noteState.success) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNoteMode(false);
    }
  }, [noteState.success]);

  function handleDelete() {
    if (!window.confirm(`Remove AWB "${assignment.order_ref_no}" from this bill?`)) return;
    setDeleteError("");
    startTransition(async () => {
      const result = await deleteFreightAwbAssignment(assignment.id);
      if (result.error) setDeleteError(result.error);
    });
  }

  return (
    <div className="rounded border border-slate-100 bg-slate-50 px-2 py-1.5">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium text-slate-900">{assignment.order_ref_no}</span>
          <span className="ml-2 text-slate-400">
            Bill {assignment.bill_weight_kg ?? "—"} kg
            {assignment.dimensional_weight_kg != null && ` · Dim ${assignment.dimensional_weight_kg} kg`} · Diff ₹{assignment.difference_amt ?? 0}
          </span>
          {assignment.remark && <span className="ml-2 text-slate-400">· {assignment.remark}</span>}
        </div>
        <div className="flex items-center gap-2">
          <p className="text-red-600">{deleteError}</p>
          <button type="button" onClick={() => setNoteMode((v) => !v)} className="rounded border border-slate-300 bg-white px-2 py-0.5 font-medium text-slate-600 hover:bg-slate-50">
            {noteMode ? "Cancel" : "+ Note"}
          </button>
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
      {(assignment.credit_note_no || assignment.debit_note_no) && (
        <div className="mt-1 space-x-3 text-purple-700">
          {assignment.credit_note_no && <span>CN {assignment.credit_note_no} · −₹{assignment.credit_note_amt ?? 0}</span>}
          {assignment.debit_note_no && <span>DN {assignment.debit_note_no} · +₹{assignment.debit_note_amt ?? 0}</span>}
        </div>
      )}
      {noteMode && (
        <form action={noteAction} className="mt-2 space-y-1.5 rounded border border-purple-200 bg-purple-50 p-2">
          <input type="hidden" name="id" value={assignment.id} />
          {noteState.error && <p className="rounded bg-red-50 px-2 py-1 text-red-800">{noteState.error}</p>}
          <p className="font-medium text-purple-800">Credit / Debit Note — against this AWB specifically</p>
          <div className="grid grid-cols-3 gap-1.5">
            <input name="credit_note_no" defaultValue={assignment.credit_note_no ?? ""} placeholder="Credit Note No." className={inputClass} />
            <input name="credit_note_date" type="date" defaultValue={assignment.credit_note_date ?? ""} className={inputClass} />
            <input name="credit_note_amt" type="number" step="0.01" defaultValue={assignment.credit_note_amt ?? ""} placeholder="Amt" className={inputClass} />
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <input name="debit_note_no" defaultValue={assignment.debit_note_no ?? ""} placeholder="Debit Note No." className={inputClass} />
            <input name="debit_note_date" type="date" defaultValue={assignment.debit_note_date ?? ""} className={inputClass} />
            <input name="debit_note_amt" type="number" step="0.01" defaultValue={assignment.debit_note_amt ?? ""} placeholder="Amt" className={inputClass} />
          </div>
          <button type="submit" disabled={notePending} className="rounded bg-purple-600 px-2 py-1 font-semibold text-white hover:bg-purple-700 disabled:opacity-50">
            {notePending ? "Saving..." : "Save Note"}
          </button>
        </form>
      )}
    </div>
  );
}
